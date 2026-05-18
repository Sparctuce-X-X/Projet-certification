// Edge Function — moderate-text
//
// Couche 2 de la modération automatique v4.0 (cf. docs/backend/moderation.md).
//
// Wraps l'API OpenAI Moderation (omni-moderation-latest, gratuit) pour
// classifier un texte selon 11 catégories. Bloquant sur 10 catégories
// "hard no" (sexual, sexual/minors, violence, violence/graphic, hate,
// hate/threatening, self-harm, self-harm/intent, illicit, illicit/violent,
// harassment/threatening). Non-bloquant sur `harassment` seul (trop
// contextuel en négociation marketplace).
//
// SURFACE D'APPEL
//   - annonce.create  (lib/annonces.ts createAnnonce → titre+description)
//   - annonce.update  (lib/annonces.ts updateAnnonce → titre / description)
//   - message (Phase 2 étape 4) — non câblé pour l'instant
//
// COMPLÉMENTAIRE À mots_interdits (mig 29+117)
//   La couche 1 (DB triggers + substring) reste enforced au niveau DB et n'est
//   PAS contournable. Cette Edge Function ajoute une couche contextuelle ML :
//   plus permissive sur les phrases ambiguës mais qui détecte hate/violence/
//   sexual_minors sans pattern préalable.
//
// FAIL-OPEN STRATEGY
//   Si OpenAI API timeout/5xx → return ok:true (laisse passer) + log warning.
//   Justification : la couche 1 mots_interdits couvre les pires patterns au
//   niveau DB. Un user honnête ne doit pas être bloqué par une panne OpenAI
//   externe. Les contenus borderline qui passeraient en cas de panne seront
//   rattrapés par F08 (signalements communauté → auto-suspend score≥3).
//
// AUTH
//   JWT user via Authorization header (auto par client.functions.invoke).
//   Refuse anon — anti-DDoS gratuit et anti-cost burning (l'API est gratuite
//   mais a des rate limits par compte OpenAI).
//
// SECRETS REQUIS (Supabase Edge Functions Secrets)
//   - OPENAI_API_KEY : key OpenAI standard (le projet Niqo a son propre compte)
//   - Optionnel : OPENAI_MODERATION_MODEL (default omni-moderation-latest)
//
// DÉPLOIEMENT
//   supabase functions deploy moderate-text
//   supabase secrets set OPENAI_API_KEY=sk-...

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException, captureMessage } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODERATION_MODEL =
  Deno.env.get("OPENAI_MODERATION_MODEL") ?? "omni-moderation-latest";

const OPENAI_TIMEOUT_MS = 5_000;
const MAX_INPUT_CHARS = 4_000;

type Surface = "annonce.create" | "annonce.update" | "message";

// Redact ce qui ressemble à un secret API dans un message d'erreur. Garde
// le payload niqo_event_log safe en cas de misconfig (cf. incident
// 2026-05-12 sur moderate-image qui leakait l'AWS secret).
function sanitizeErrorMessage(msg: string): string {
  return msg
    // OpenAI keys : sk-... 40+ chars
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "<REDACTED_OAI_KEY>")
    // Pattern AWS access key (au cas où)
    .replace(/AKIA[A-Z0-9]{16}/g, "<REDACTED_AKID>")
    // Suite alphanumérique base64-ish 30+ chars (secret-like)
    .replace(/[A-Za-z0-9/+=]{30,}/g, "<REDACTED_SECRET>")
    .slice(0, 200);
}

interface ModerateRequest {
  texte: string;
  surface: Surface;
}

interface ModerateResponse {
  ok: boolean;
  reason?: string;
  hint?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info",
};

// ── Catégories OpenAI Moderation → décision Niqo ───────────────────────────
// 10 catégories bloquantes + 1 critique (alerte admin immédiate sur minors).
// harassment seul = non-bloquant (gray zone). self-harm/instructions = ignoré
// (cas marketplace ~jamais rencontré).
const BLOCK_CATEGORIES: Record<string, { hint: string; critical?: boolean }> = {
  "sexual": {
    hint: "Le texte contient du contenu à caractère sexuel non autorisé.",
  },
  "sexual/minors": {
    hint:
      "Le texte a été détecté comme contenant du contenu impliquant des mineurs. Cette tentative est enregistrée.",
    critical: true,
  },
  "violence": {
    hint: "Le texte contient du contenu violent non autorisé.",
  },
  "violence/graphic": {
    hint: "Le texte contient du contenu violent explicite non autorisé.",
  },
  "hate": {
    hint: "Le texte contient des propos haineux non autorisés.",
  },
  "hate/threatening": {
    hint: "Le texte contient des menaces à caractère haineux non autorisées.",
  },
  "self-harm": {
    hint: "Le texte contient du contenu lié à l'automutilation.",
  },
  "self-harm/intent": {
    hint: "Le texte contient l'expression d'une intention d'automutilation.",
  },
  "harassment/threatening": {
    hint: "Le texte contient des menaces non autorisées.",
  },
  "illicit": {
    hint: "Le texte décrit une activité illicite.",
  },
  "illicit/violent": {
    hint: "Le texte décrit une activité illicite à caractère violent.",
  },
};

interface OpenAIModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
}

interface OpenAIModerationResponse {
  id: string;
  model: string;
  results: OpenAIModerationResult[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonError("METHOD_NOT_ALLOWED", 405);
  }

  // ── Auth user ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonError("AUTH_REQUIRED", 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return jsonError("AUTH_INVALID", 401);

  // ── Parse + validation ────────────────────────────────────────────────
  let body: ModerateRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  const texte = typeof body.texte === "string" ? body.texte.trim() : "";
  const surface = body.surface;

  if (!texte) {
    return jsonError("EMPTY_TEXT", 400);
  }
  if (
    surface !== "annonce.create" &&
    surface !== "annonce.update" &&
    surface !== "message"
  ) {
    return jsonError("INVALID_SURFACE", 400);
  }
  if (texte.length > MAX_INPUT_CHARS) {
    return jsonError("TEXT_TOO_LONG", 413);
  }

  // ── Admin client pour logEvent (service_role) ─────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Fail-open si pas de clé OpenAI (dev local sans secret) ────────────
  if (!OPENAI_API_KEY) {
    await logEvent(
      adminClient,
      "moderate-text",
      "moderation.api_disabled",
      "warning",
      { surface, text_length: texte.length, reason: "no_openai_key" },
      user.id,
    );
    return jsonOk({ ok: true });
  }

  // ── Appel OpenAI Moderation ───────────────────────────────────────────
  let moderation: OpenAIModerationResponse;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    const resp = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODERATION_MODEL,
        input: texte,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(
        `[moderate-text] OpenAI HTTP ${resp.status}: ${errText.slice(0, 200)}`,
      );
      captureMessage(
        `OpenAI moderation HTTP ${resp.status}`,
        { tags: { step: "openai-http", status: String(resp.status) } },
        "moderate-text",
      );
      await logEvent(
        adminClient,
        "moderate-text",
        "moderation.api_error",
        "warning",
        { surface, http_status: resp.status, text_length: texte.length },
        user.id,
      );
      // Fail-open : laisse passer, mots_interdits couvre les pires patterns
      return jsonOk({ ok: true });
    }

    moderation = await resp.json() as OpenAIModerationResponse;
  } catch (e) {
    const err = e as Error;
    const safeMsg = sanitizeErrorMessage(err.message);
    console.warn(`[moderate-text] OpenAI fetch failed: ${safeMsg}`);
    captureException(
      err,
      { tags: { step: "openai-fetch" } },
      "moderate-text",
    );
    await logEvent(
      adminClient,
      "moderate-text",
      "moderation.api_error",
      "warning",
      { surface, text_length: texte.length, error: safeMsg, error_name: err.name },
      user.id,
    );
    // Fail-open
    return jsonOk({ ok: true });
  }

  // ── Évalue les catégories ─────────────────────────────────────────────
  const result = moderation.results?.[0];
  if (!result) {
    captureMessage(
      "OpenAI moderation returned no results",
      { tags: { step: "openai-empty" } },
      "moderate-text",
    );
    return jsonOk({ ok: true });
  }

  const categories = result.categories ?? {};
  const flaggedBlocking: string[] = [];
  let criticalReason: string | null = null;

  for (const [cat, isFlag] of Object.entries(categories)) {
    if (!isFlag) continue;
    const rule = BLOCK_CATEGORIES[cat];
    if (!rule) continue;
    flaggedBlocking.push(cat);
    if (rule.critical) criticalReason = cat;
  }

  // Cas critique sexual/minors : alerte admin immédiate (severity=error)
  // → captura Sentry + niqo_event_log → l'alert_digest mig 108 picks it up
  if (criticalReason) {
    captureMessage(
      `MODERATION CRITICAL: ${criticalReason} flagged by user ${user.id}`,
      {
        tags: { step: "moderation-critical", category: criticalReason, surface },
        level: "error",
      },
      "moderate-text",
    );
    await logEvent(
      adminClient,
      "moderate-text",
      "moderation.critical_minors",
      "error",
      {
        surface,
        category: criticalReason,
        text_length: texte.length,
        text_preview: texte.slice(0, 100),
      },
      user.id,
    );
  }

  if (flaggedBlocking.length > 0) {
    const firstCat = flaggedBlocking[0];
    const rule = BLOCK_CATEGORIES[firstCat];
    if (!criticalReason) {
      // logEvent du flag (le critique a déjà été loggé en error juste avant)
      await logEvent(
        adminClient,
        "moderate-text",
        "moderation.flagged",
        "warning",
        {
          surface,
          categories: flaggedBlocking,
          text_length: texte.length,
        },
        user.id,
      );
    }
    return jsonOk({
      ok: false,
      reason: firstCat,
      hint: rule.hint,
    });
  }

  // ── Pass ──────────────────────────────────────────────────────────────
  await logEvent(
    adminClient,
    "moderate-text",
    "moderation.passed",
    "info",
    { surface, text_length: texte.length },
    user.id,
  );
  return jsonOk({ ok: true });
});

function jsonOk(body: ModerateResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
