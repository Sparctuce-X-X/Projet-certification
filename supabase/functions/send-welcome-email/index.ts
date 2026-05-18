// Edge Function — send-welcome-email
//
// Envoie l'email de bienvenue automatiquement après l'inscription d'un user.
// Déclenché par la trigger DB `tg_welcome_email` (mig 124) via pg_net.http_post.
//
// FLOW
//   1. Vérifier le secret NIQO_INTERNAL_KEY (même pattern que send-push-notification)
//   2. Lire le body { user_id: string }
//   3. Fetch public.users → { email, prenom, is_admin, created_at }
//   4. Skip si user introuvable (404) ou is_admin = true
//   5. Rendre le template welcome (HTML + text)
//   6. Appeler sendNiqoEmail (Resend via _shared/email.ts)
//   7. Instrumenter : logEvent + captureException si erreur
//
// AUTH
//   NIQO_INTERNAL_KEY (Bearer) — secret partagé stocké côté Vault + Edge Secrets.
//   Même clé que send-push-notification (cf. mig 65 §Architecture sécurité).
//   Comparaison constant-time pour éviter les timing attacks.
//
// SECRETS REQUIS (Supabase Edge Functions → Secrets)
//   - RESEND_API_KEY            (Resend API)
//   - NIQO_INTERNAL_KEY         (secret partagé Vault + EF)
//   - SUPABASE_URL              (auto)
//   - SUPABASE_SERVICE_ROLE_KEY (auto)
//
// Déploiement :
//   supabase functions deploy send-welcome-email

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";
import { sendNiqoEmail } from "../_shared/email.ts";
import { getNiqoLegalFooterHtml, getNiqoLegalFooterText } from "../_shared/niqo-legal.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── CORS (pattern generate-compta-pdf) ───────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// ── Auth : NIQO_INTERNAL_KEY (même clé que send-push-notification) ───────────
// Le gateway Supabase réécrit les headers Authorization quand pg_net appelle
// une Edge Function — impossible de matcher SUPABASE_SERVICE_ROLE_KEY côté
// caller. Solution : secret custom NIQO_INTERNAL_KEY stocké aux 2 endroits.
// Voir send-push-notification/index.ts §Secret partagé Niqo pour la doc complète.

function getAcceptedAdminKeys(): string[] {
  const keys: string[] = [];
  const internalKey = Deno.env.get("NIQO_INTERNAL_KEY");
  if (internalKey) keys.push(internalKey);
  return keys;
}

/**
 * Comparaison constant-time entre deux strings.
 * Évite les timing attacks sur le secret partagé.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!;
  }
  return diff === 0;
}

function anyConstantTimeMatch(token: string, accepted: string[]): boolean {
  let matched = false;
  for (const candidate of accepted) {
    if (constantTimeEquals(token, candidate)) matched = true;
  }
  return matched;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WelcomeEmailRequest {
  user_id: string;
}

interface UserRow {
  email: string;
  prenom: string;
  is_admin: boolean;
  created_at: string;
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const accepted = getAcceptedAdminKeys();
  if (!token || accepted.length === 0 || !anyConstantTimeMatch(token, accepted)) {
    return new Response("Unauthorized", { status: 403, headers: CORS_HEADERS });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: WelcomeEmailRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  if (!body.user_id || typeof body.user_id !== "string") {
    return jsonError("MISSING_USER_ID", 400);
  }

  // ── Client Supabase avec service_role ─────────────────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Fetch user ────────────────────────────────────────────────────────────
  const { data: user, error: userError } = await adminClient
    .from("users")
    .select("email, prenom, is_admin, created_at")
    .eq("id", body.user_id)
    .single<UserRow>();

  if (userError || !user) {
    console.warn(`[welcome-email] user not found: ${body.user_id}`);
    return jsonOk({ ok: false, reason: "user_not_found" });
  }

  // ── Skip admins ───────────────────────────────────────────────────────────
  if (user.is_admin) {
    console.warn(`[welcome-email] skip admin user: ${body.user_id}`);
    return jsonOk({ ok: true, skipped: "admin" });
  }

  // ── Render template & envoyer ─────────────────────────────────────────────
  const { subject, html, text } = renderWelcomeEmail(user.prenom);

  const result = await sendNiqoEmail({
    to: user.email,
    subject,
    html,
    text,
    category: "welcome",
    logContext: "welcome-email",
  });

  if (!result.ok) {
    console.error(`[welcome-email] send failed for user ${body.user_id}: ${result.reason}`);

    captureException(new Error(`welcome email failed: ${result.reason}`), {
      tags: { step: "send-email", user_id: body.user_id },
      extra: { reason: result.reason },
    }, "welcome-email");

    logEvent(
      adminClient,
      "welcome-email",
      "welcome_email.failed",
      "error",
      { reason: result.reason ?? null },
      body.user_id,
    );

    return jsonOk({ ok: false, reason: result.reason });
  }

  logEvent(
    adminClient,
    "welcome-email",
    "welcome_email.sent",
    "info",
    {},
    body.user_id,
  );

  return jsonOk({ ok: true });
});

// ── Helpers HTTP ──────────────────────────────────────────────────────────────

function jsonOk(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: code }), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

// ── Template welcome ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderWelcomeEmail(prenom: string): { subject: string; html: string; text: string } {
  const subject = `Niqo — Bienvenue ${prenom} !`;

  const text = `Bienvenue ${escapeHtml(prenom)} sur Niqo

Tu rejoins la marketplace de confiance en Afrique francophone.

Ce que tu peux faire :
  · Achète & vends en toute sécurité avec d'autres particuliers
  · Système de notation post-RDV pour la confiance
  · Vérification d'identité pour booster ta crédibilité vendeur

Ouvre Niqo : https://niqo.africa

L'équipe Niqo
support@niqo.africa

---
${getNiqoLegalFooterText()}
`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,address=no,email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Niqo</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF9;font-family:Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border-radius:16px;padding:32px 24px;">
          <tr>
            <td>

              <!-- Logo -->
              <p style="margin:0 0 24px 0;font-size:28px;font-weight:700;color:#1A1A1A;letter-spacing:-0.5px;">
                niqo<span style="color:#D85A30;">.</span>
              </p>

              <!-- Hero -->
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.3;">
                Bienvenue ${escapeHtml(prenom)} sur Niqo
              </h1>
              <p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;color:#444441;">
                Tu rejoins la marketplace de confiance en Afrique francophone.
              </p>

              <!-- Box highlights -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;border-radius:12px;margin:0 0 28px 0;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 10px 0;font-size:14px;font-weight:700;color:#1A1A1A;">
                      Ce que tu peux faire :
                    </p>
                    <p style="margin:0;font-size:14px;line-height:1.7;color:#444441;">
                      &bull; Achète &amp; vends en toute sécurité avec d'autres particuliers<br>
                      &bull; Système de notation post-RDV pour la confiance<br>
                      &bull; Vérification d'identité pour booster ta crédibilité vendeur
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA — table-wrapped (anti-Outlook). URL https:// (pas niqo://) :
                   les clients email bloquent les schemes custom. Quand Universal
                   Links seront configurés (apple-app-site-association + assetlinks.json
                   sur niqo.africa), ce lien ouvrira l'app sur les devices Niqo. -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                <tr>
                  <td align="center" style="background-color:#D85A30;border-radius:12px;">
                    <a href="https://niqo.africa" target="_blank" style="display:block;padding:14px 32px;font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;line-height:1.2;">
                      Ouvrir Niqo
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Footer signature -->
              <p style="margin:0;font-size:13px;line-height:1.5;color:#5A5A57;">
                L'équipe Niqo<br>
                <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
              </p>

            </td>
          </tr>
        </table>

        <!-- Hors-card footer -->
        <p style="margin:24px 0 0 0;font-size:12px;line-height:1.5;color:#5A5A57;">
          Niqo — La marketplace de confiance en Afrique.
        </p>
        <hr style="border:none;border-top:1px solid #E5E5E0;margin:16px auto;max-width:480px;">
        <div style="max-width:480px;margin:0 auto;text-align:center;">
          ${getNiqoLegalFooterHtml()}
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
