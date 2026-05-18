// Edge Function — moderate-image
//
// Couche enforcement images (cf. docs/backend/moderation.md §Images).
//
// Wraps AWS Rekognition DetectModerationLabels pour classifier une image
// avant publication d'annonce. Bloquant sur 6 catégories "hard no" :
// Explicit Nudity, Suggestive, Violence, Visually Disturbing,
// Drugs & Tobacco Paraphernalia & Use, Hate Symbols.
//
// SURFACE D'APPEL
//   - annonce.create  (lib/moderation.ts moderateImage → step photos wizard)
//
// COMPLÉMENTAIRE À mots_interdits (texte)
//   - Couche 1 texte : substring DB triggers (non-bypassable) sur titre +
//     description annonce + content messages.
//   - Couche 2 texte : Edge Function moderate-text (OpenAI Moderation API).
//   - Couche 3 image (CE FICHIER) : AWS Rekognition appelée AVANT upload
//     Storage + INSERT annonces → aucune image NSFW jamais persistée.
//
// FAIL-OPEN STRATEGY
//   Si AWS Rekognition timeout/5xx → return ok:true (laisse passer) + log
//   warning. Justification : F08 signalements communauté rattrape les ratés ;
//   un user honnête en zone réseau instable ne doit pas être bloqué par une
//   panne AWS externe.
//
// AUTH
//   JWT user via Authorization header (verify_jwt=true gateway + manual
//   userClient.auth.getUser() check). Refuse anon — anti-DDoS + anti-cost
//   burning (Rekognition coûte ~1$/1000 images après free tier).
//
// SECRETS REQUIS (Supabase Edge Functions Secrets)
//   - AWS_ACCESS_KEY_ID         : IAM user niqo-rekognition
//   - AWS_SECRET_ACCESS_KEY     : (afficheonceonly à la création)
//   - AWS_REGION                : default eu-west-1 (RGPD UE, l'Afrique
//                                 francophone n'a pas de région Rekognition,
//                                 af-south-1 ne supporte pas)
//
// DÉPLOIEMENT
//   npm run deploy:moderate-image    # script avec pre-deploy live tests
//   ou (bypass) :
//   supabase functions deploy moderate-image
//   supabase secrets set AWS_ACCESS_KEY_ID=AKIA...
//   supabase secrets set AWS_SECRET_ACCESS_KEY=...
//   supabase secrets set AWS_REGION=eu-west-1

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  DetectModerationLabelsCommand,
  RekognitionClient,
} from "npm:@aws-sdk/client-rekognition@3.668.0";
import { captureException, captureMessage } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const AWS_REGION = Deno.env.get("AWS_REGION") ?? "eu-west-1";

const REKOGNITION_TIMEOUT_MS = 5_000;
const MIN_CONFIDENCE = 75; // 0-100 ; 75 = recall correct sans trop de FP
// Body Edge Function ≈ 6 MB max (Supabase). Base64 = ~1.33× la taille
// binaire → on cap à 4 500 000 chars (image binaire ≈ 3.4 MB). Le client
// resize à 1280px max avant envoi (cf. lib/moderation.ts moderateImage).
const MAX_BASE64_CHARS = 4_500_000;

type Surface = "annonce.create";

// Redact tout ce qui ressemble à un secret AWS dans un message d'erreur
// avant de le logger dans niqo_event_log. Cas couvert : AWS SDK qui inclut
// la "faulty credential" dans son message → leak du secret dans la DB en
// cas de misconfiguration des secrets (cf. incident 2026-05-12).
function sanitizeErrorMessage(msg: string): string {
  return msg
    // AWS Access Key IDs : AKIA + 16 chars
    .replace(/AKIA[A-Z0-9]{16}/g, "<REDACTED_AKID>")
    // Suite alphanumérique + / + base64-ish de 30+ chars (cible le format
    // des AWS secret access keys, qui font 40 chars avec / et +)
    .replace(/[A-Za-z0-9/+=]{30,}/g, "<REDACTED_SECRET>")
    .slice(0, 200);
}

interface ModerateRequest {
  photo_base64: string;
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

// ── Catégories Rekognition → décision Niqo ─────────────────────────────
// Labels top-level retournés par DetectModerationLabels. On bloque sur le
// TOP-LEVEL : "Explicit Nudity", "Suggestive", "Violence", "Visually Disturbing",
// "Drugs & Tobacco", "Hate Symbols". Cohérent avec mig 118 (suggestive bloqué
// sur texte aussi). Match exact case-sensitive (AWS retourne ces strings
// stables, c'est leur taxonomy publique).
const BLOCK_LABELS: Record<string, { hint: string; critical?: boolean }> = {
  "Explicit Nudity": {
    hint: "L'image contient de la nudité explicite, ce qui est interdit.",
  },
  "Explicit": {
    hint: "L'image contient du contenu explicite, ce qui est interdit.",
  },
  "Non-Explicit Nudity of Intimate parts and Kissing": {
    hint: "L'image contient du contenu intime non autorisé.",
  },
  "Suggestive": {
    hint: "L'image contient du contenu suggestif à caractère sexuel, ce qui est interdit.",
  },
  "Violence": {
    hint: "L'image contient du contenu violent, ce qui est interdit.",
  },
  "Visually Disturbing": {
    hint: "L'image contient du contenu visuellement perturbant, ce qui est interdit.",
  },
  "Drugs & Tobacco": {
    hint: "L'image contient des drogues ou du tabac, ce qui est interdit.",
  },
  "Drugs & Tobacco Paraphernalia & Use": {
    hint: "L'image contient des objets liés à la drogue ou son usage, ce qui est interdit.",
  },
  "Hate Symbols": {
    hint:
      "L'image contient des symboles haineux. Cette tentative est enregistrée.",
    critical: true,
  },
};

interface RekognitionLabel {
  Name?: string;
  Confidence?: number;
  ParentName?: string;
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

  const photoBase64 =
    typeof body.photo_base64 === "string" ? body.photo_base64.trim() : "";
  const surface = body.surface;

  if (!photoBase64) {
    return jsonError("EMPTY_IMAGE", 400);
  }
  if (surface !== "annonce.create") {
    return jsonError("INVALID_SURFACE", 400);
  }
  if (photoBase64.length > MAX_BASE64_CHARS) {
    return jsonError("IMAGE_TOO_LARGE", 413);
  }

  // Décoder base64 → bytes binaires pour Rekognition (qui prend Bytes, pas
  // base64). On strippe le préfixe data URL "data:image/jpeg;base64," si
  // présent (les clients comme expo-file-system retournent du base64 brut
  // mais certains paths web ajoutent le préfixe).
  const cleanBase64 = photoBase64.replace(/^data:image\/[a-z]+;base64,/i, "");
  let imageBytes: Uint8Array;
  try {
    imageBytes = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
  } catch {
    return jsonError("INVALID_BASE64", 400);
  }

  // Sanity check : Rekognition refuse les images < 1KB ou > 5MB (en binaire).
  if (imageBytes.byteLength < 1024) {
    return jsonError("IMAGE_TOO_SMALL", 400);
  }
  if (imageBytes.byteLength > 5 * 1024 * 1024) {
    return jsonError("IMAGE_TOO_LARGE", 413);
  }

  // ── Admin client pour logEvent (service_role) ─────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Fail-open si pas de credentials AWS (dev local sans secret) ───────
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    await logEvent(
      adminClient,
      "moderate-image",
      "moderation.image.api_disabled",
      "warning",
      {
        surface,
        image_bytes: imageBytes.byteLength,
        reason: "no_aws_credentials",
      },
      user.id,
    );
    return jsonOk({ ok: true });
  }

  // ── Appel AWS Rekognition ─────────────────────────────────────────────
  const rekognition = new RekognitionClient({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
    // SDK AWS v3 supporte AbortSignal via requestHandler. On utilise
    // AbortController au niveau du send().
  });

  let labels: RekognitionLabel[];
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REKOGNITION_TIMEOUT_MS);

    const command = new DetectModerationLabelsCommand({
      Image: { Bytes: imageBytes },
      MinConfidence: MIN_CONFIDENCE,
    });
    const resp = await rekognition.send(command, {
      abortSignal: controller.signal,
    });
    clearTimeout(timeoutId);

    labels = resp.ModerationLabels ?? [];
  } catch (e) {
    const err = e as Error;
    const safeMsg = sanitizeErrorMessage(err.message);
    console.warn(`[moderate-image] Rekognition failed: ${safeMsg}`);
    captureException(
      err,
      { tags: { step: "rekognition-fetch" } },
      "moderate-image",
    );
    await logEvent(
      adminClient,
      "moderate-image",
      "moderation.image.api_error",
      "warning",
      {
        surface,
        image_bytes: imageBytes.byteLength,
        error: safeMsg,
        error_name: err.name,
      },
      user.id,
    );
    // Fail-open
    return jsonOk({ ok: true });
  }

  // ── Évalue les labels ─────────────────────────────────────────────────
  // Rekognition retourne TOUS les labels matchés (parent + sous-catégories).
  // On itère et on bloque dès qu'on voit un label connu dans BLOCK_LABELS.
  // On normalise sur le label le plus spécifique d'abord (parent fallback).
  const flaggedLabels: string[] = [];
  let firstHint = "";
  let criticalLabel: string | null = null;

  for (const label of labels) {
    const name = label.Name?.trim();
    if (!name) continue;
    const rule = BLOCK_LABELS[name] ?? BLOCK_LABELS[label.ParentName?.trim() ?? ""];
    if (!rule) continue;
    flaggedLabels.push(name);
    if (!firstHint) firstHint = rule.hint;
    if (rule.critical && !criticalLabel) criticalLabel = name;
  }

  // Cas critique Hate Symbols : alerte admin (severity=error)
  if (criticalLabel) {
    captureMessage(
      `MODERATION IMAGE CRITICAL: ${criticalLabel} by user ${user.id}`,
      {
        tags: {
          step: "moderation-image-critical",
          label: criticalLabel,
          surface,
        },
        level: "error",
      },
      "moderate-image",
    );
    await logEvent(
      adminClient,
      "moderate-image",
      "moderation.image.critical_hate",
      "error",
      {
        surface,
        label: criticalLabel,
        all_labels: flaggedLabels,
        image_bytes: imageBytes.byteLength,
      },
      user.id,
    );
  }

  if (flaggedLabels.length > 0) {
    if (!criticalLabel) {
      await logEvent(
        adminClient,
        "moderate-image",
        "moderation.image.flagged",
        "warning",
        {
          surface,
          labels: flaggedLabels,
          image_bytes: imageBytes.byteLength,
        },
        user.id,
      );
    }
    return jsonOk({
      ok: false,
      reason: flaggedLabels[0],
      hint: firstHint,
    });
  }

  // ── Pass ──────────────────────────────────────────────────────────────
  await logEvent(
    adminClient,
    "moderate-image",
    "moderation.image.passed",
    "info",
    { surface, image_bytes: imageBytes.byteLength },
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
