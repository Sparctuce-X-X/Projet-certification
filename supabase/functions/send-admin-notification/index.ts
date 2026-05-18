// Edge Function — send-admin-notification
//
// Envoie une notification email aux administrateurs Niqo quand un nouveau
// signalement ou une nouvelle vérification KYC arrive.
//
// FLOW
//   1. Vérifier le secret NIQO_INTERNAL_KEY (même pattern que send-push-notification)
//   2. Lire le body { type: "signalement" | "verification", target_id: string }
//   3. Fetch public.signalements ou public.verifications_identite selon le type
//   4. Fetch tous les admins (public.users WHERE is_admin = true)
//   5. Pour chaque admin : envoyer l'email via sendNiqoEmail (Resend)
//   6. Instrumenter : logEvent + captureException si erreur
//
// AUTH
//   NIQO_INTERNAL_KEY (Bearer) — secret partagé stocké côté Vault + Edge Secrets.
//   Même clé que send-push-notification et send-welcome-email.
//   Comparaison constant-time pour éviter les timing attacks.
//
// SECRETS REQUIS (Supabase Edge Functions → Secrets)
//   - RESEND_API_KEY            (Resend API)
//   - NIQO_INTERNAL_KEY         (secret partagé Vault + EF)
//   - NIQO_ADMIN_BASE_URL       (optionnel — URL de base de l'admin web)
//   - SUPABASE_URL              (auto)
//   - SUPABASE_SERVICE_ROLE_KEY (auto)
//
// Déploiement :
//   supabase functions deploy send-admin-notification

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";
import { sendNiqoEmail } from "../_shared/email.ts";
import { getNiqoLegalFooterHtml, getNiqoLegalFooterText } from "../_shared/niqo-legal.ts";
import { formatParisDateTime } from "../_shared/date-format.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// URL de base de l'admin web — ajustable via env var (ex: niqo-admin.vercel.app)
const NIQO_ADMIN_BASE_URL = Deno.env.get("NIQO_ADMIN_BASE_URL") ?? "https://niqo.africa/admin";

// ── CORS (pattern generate-compta-pdf) ───────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// ── Auth : NIQO_INTERNAL_KEY (même clé que send-push-notification) ───────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Masque un email pour la confidentialité côté admin.
 * ex: "dominique@example.com" → "d*********@example.com"
 */
function maskEmail(email: string): string {
  const [prefix, domain] = email.split("@");
  if (!prefix || !domain) return email;
  if (prefix.length <= 1) return email;
  return prefix[0] + "*".repeat(prefix.length - 1) + "@" + domain;
}

/**
 * Formate une date ISO en format lisible FR (heure Europe/Paris).
 * ex: "2026-05-14T10:30:00Z" → "14/05/2026 12:30" (heure de Paris)
 */
function formatDate(isoString: string): string {
  try {
    return formatParisDateTime(isoString);
  } catch {
    return isoString;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminNotifRequest {
  type: "signalement" | "verification";
  target_id: string;
}

interface AdminRow {
  email: string;
  prenom: string;
}

interface SignalementRow {
  id: string;
  target_type: string;
  target_id: string;
  motif: string;
  created_at: string;
  signaleur_prenom: string;
  signaleur_email: string;
}

interface VerificationRow {
  id: string;
  user_id: string;
  created_at: string;
  prenom: string;
  email: string;
  pays: string;
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
  let body: AdminNotifRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  if (
    !body.type ||
    !["signalement", "verification"].includes(body.type) ||
    !body.target_id ||
    typeof body.target_id !== "string"
  ) {
    return jsonError("INVALID_BODY", 400);
  }

  // ── Client Supabase avec service_role ─────────────────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Fetch target ─────────────────────────────────────────────────────────
  if (body.type === "signalement") {
    return await handleSignalement(adminClient, body.target_id);
  } else {
    return await handleVerification(adminClient, body.target_id);
  }
});

// ── Handler signalement ───────────────────────────────────────────────────────

async function handleSignalement(
  adminClient: ReturnType<typeof createClient>,
  targetId: string,
): Promise<Response> {
  // Fetch signalement avec le signaleur
  const { data: signalement, error: sigError } = await adminClient
    .from("signalements")
    .select(`
      id,
      target_type,
      target_id,
      motif,
      created_at,
      signaleur:users!signalements_signaleur_id_fkey(prenom, email)
    `)
    .eq("id", targetId)
    .single();

  if (sigError || !signalement) {
    console.warn(`[admin-notif] signalement not found: ${targetId}`);

    logEvent(
      adminClient,
      "admin-notif",
      "admin_notif.target_not_found",
      "warning",
      { type: "signalement", target_id: targetId },
      null,
    );

    return jsonOk({ ok: false, reason: "signalement_not_found" });
  }

  // Typage correct : Supabase infère l'array même sur FK unique
  const rawSignaleur = (signalement as unknown as {
    id: string;
    target_type: string;
    target_id: string;
    motif: string;
    created_at: string;
    signaleur: Array<{ prenom: string; email: string }> | { prenom: string; email: string } | null;
  });

  const signaleurObj = Array.isArray(rawSignaleur.signaleur)
    ? rawSignaleur.signaleur[0]
    : rawSignaleur.signaleur;

  const row: SignalementRow = {
    id: rawSignaleur.id,
    target_type: rawSignaleur.target_type,
    target_id: rawSignaleur.target_id,
    motif: rawSignaleur.motif,
    created_at: rawSignaleur.created_at,
    signaleur_prenom: signaleurObj?.prenom ?? "Inconnu",
    signaleur_email: signaleurObj?.email ?? "",
  };

  // Fetch admins
  const admins = await fetchAdmins(adminClient);
  if (admins.length === 0) {
    logEvent(
      adminClient,
      "admin-notif",
      "admin_notif.no_admins",
      "warning",
      { type: "signalement" },
      null,
    );
    return jsonOk({ ok: true, sent: 0, reason: "no_admins" });
  }

  // Envoyer à chaque admin
  let sentCount = 0;
  for (const admin of admins) {
    const { subject, html, text } = renderSignalementEmail(admin.prenom, row);
    const result = await sendNiqoEmail({
      to: admin.email,
      subject,
      html,
      text,
      category: "admin-notif-signalement",
      logContext: "admin-notif",
    });

    if (!result.ok) {
      console.error(
        `[admin-notif] send signalement failed for admin ${admin.email}: ${result.reason}`,
      );

      captureException(
        new Error(`admin signalement notif failed: ${result.reason}`),
        {
          tags: { step: "send-email", type: "signalement", target_id: targetId },
          extra: { reason: result.reason, admin_email: admin.email },
        },
        "admin-notif",
      );

      logEvent(
        adminClient,
        "admin-notif",
        "admin_notif.failed",
        "error",
        { type: "signalement", target_id: targetId, reason: result.reason ?? null },
        null,
      );
    } else {
      sentCount++;
    }
  }

  logEvent(
    adminClient,
    "admin-notif",
    "admin_notif.sent",
    "info",
    { type: "signalement", target_id: targetId, sent: sentCount },
    null,
  );

  return jsonOk({ ok: true, sent: sentCount });
}

// ── Handler verification ──────────────────────────────────────────────────────

async function handleVerification(
  adminClient: ReturnType<typeof createClient>,
  targetId: string,
): Promise<Response> {
  // Fetch verification avec le user
  const { data: verif, error: verifError } = await adminClient
    .from("verifications_identite")
    .select(`
      id,
      user_id,
      created_at,
      user:users!verifications_identite_user_id_fkey(prenom, email, pays)
    `)
    .eq("id", targetId)
    .single();

  if (verifError || !verif) {
    console.warn(`[admin-notif] verification not found: ${targetId}`);

    logEvent(
      adminClient,
      "admin-notif",
      "admin_notif.target_not_found",
      "warning",
      { type: "verification", target_id: targetId },
      null,
    );

    return jsonOk({ ok: false, reason: "verification_not_found" });
  }

  // Typage correct : Supabase infère l'array même sur FK unique
  const rawVerif = (verif as unknown as {
    id: string;
    user_id: string;
    created_at: string;
    user: Array<{ prenom: string; email: string; pays: string }> | { prenom: string; email: string; pays: string } | null;
  });

  const userObj = Array.isArray(rawVerif.user) ? rawVerif.user[0] : rawVerif.user;

  const row: VerificationRow = {
    id: rawVerif.id,
    user_id: rawVerif.user_id,
    created_at: rawVerif.created_at,
    prenom: userObj?.prenom ?? "Inconnu",
    email: userObj?.email ?? "",
    pays: userObj?.pays ?? "",
  };

  // Fetch admins
  const admins = await fetchAdmins(adminClient);
  if (admins.length === 0) {
    logEvent(
      adminClient,
      "admin-notif",
      "admin_notif.no_admins",
      "warning",
      { type: "verification" },
      null,
    );
    return jsonOk({ ok: true, sent: 0, reason: "no_admins" });
  }

  // Envoyer à chaque admin
  let sentCount = 0;
  for (const admin of admins) {
    const { subject, html, text } = renderVerificationEmail(admin.prenom, row);
    const result = await sendNiqoEmail({
      to: admin.email,
      subject,
      html,
      text,
      category: "admin-notif-kyc",
      logContext: "admin-notif",
    });

    if (!result.ok) {
      console.error(
        `[admin-notif] send verification failed for admin ${admin.email}: ${result.reason}`,
      );

      captureException(
        new Error(`admin verification notif failed: ${result.reason}`),
        {
          tags: { step: "send-email", type: "verification", target_id: targetId },
          extra: { reason: result.reason, admin_email: admin.email },
        },
        "admin-notif",
      );

      logEvent(
        adminClient,
        "admin-notif",
        "admin_notif.failed",
        "error",
        { type: "verification", target_id: targetId, reason: result.reason ?? null },
        null,
      );
    } else {
      sentCount++;
    }
  }

  logEvent(
    adminClient,
    "admin-notif",
    "admin_notif.sent",
    "info",
    { type: "verification", target_id: targetId, sent: sentCount },
    null,
  );

  return jsonOk({ ok: true, sent: sentCount });
}

// ── Helpers DB ────────────────────────────────────────────────────────────────

async function fetchAdmins(
  adminClient: ReturnType<typeof createClient>,
): Promise<AdminRow[]> {
  const { data, error } = await adminClient
    .from("users")
    .select("email, prenom")
    .eq("is_admin", true)
    .returns<AdminRow[]>();

  if (error) {
    console.error(`[admin-notif] fetchAdmins error: ${error.message}`);
    return [];
  }

  return data ?? [];
}

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

// ── Template signalement ──────────────────────────────────────────────────────

function renderSignalementEmail(
  adminPrenom: string,
  row: SignalementRow,
): { subject: string; html: string; text: string } {
  const subject = `Niqo Admin — Nouveau signalement (${row.target_type})`;
  const ctaUrl = `${NIQO_ADMIN_BASE_URL}/signalements/${row.id}`;

  // ID court pour affichage (8 premiers chars)
  const shortTargetId = row.target_id.slice(0, 8);
  const maskedEmail = maskEmail(row.signaleur_email);
  const dateStr = formatDate(row.created_at);

  const text = `Bonjour ${adminPrenom},

Un nouveau signalement vient d'être soumis sur Niqo.

Reporter   : ${escapeHtml(row.signaleur_prenom)} (${maskedEmail})
Cible      : ${row.target_type} — ${shortTargetId}...
Motif      : ${escapeHtml(row.motif)}
Date       : ${dateStr}

Examiner → ${ctaUrl}

${getNiqoLegalFooterText()}
`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,address=no,email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Niqo Admin</title>
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
                <span style="font-size:13px;font-weight:400;color:#5A5A57;margin-left:8px;">Admin</span>
              </p>

              <!-- Alerte -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF4F0;border-left:4px solid #D85A30;border-radius:8px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:16px;">
                    <p style="margin:0;font-size:16px;font-weight:700;color:#D85A30;">
                      Nouveau signalement
                    </p>
                    <p style="margin:4px 0 0 0;font-size:14px;color:#1A1A1A;">
                      Bonjour ${escapeHtml(adminPrenom)}, un signalement vient d'être soumis.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Grille infos -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;border-radius:12px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;width:90px;vertical-align:top;">Reporter</td>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#1A1A1A;font-weight:600;">
                          ${escapeHtml(row.signaleur_prenom)}<br>
                          <span style="font-weight:400;color:#5A5A57;">${escapeHtml(maskedEmail)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;vertical-align:top;">Cible</td>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#1A1A1A;font-weight:600;">
                          ${escapeHtml(row.target_type)}
                          <br><span style="font-weight:400;font-family:monospace;font-size:12px;color:#5A5A57;">${escapeHtml(shortTargetId)}…</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;vertical-align:top;">Motif</td>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#1A1A1A;">
                          ${escapeHtml(row.motif)}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0;font-size:13px;color:#5A5A57;vertical-align:top;">Date</td>
                        <td style="padding:0;font-size:13px;color:#1A1A1A;">${escapeHtml(dateStr)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                <tr>
                  <td align="center" style="background-color:#D85A30;border-radius:12px;">
                    <a href="${ctaUrl}" target="_blank" style="display:block;padding:14px 32px;font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;line-height:1.2;">
                      Examiner →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Footer signature -->
              <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#5A5A57;">
                L'équipe Niqo<br>
                <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
              </p>

              <!-- Footer légal -->
              ${getNiqoLegalFooterHtml()}

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

// ── Template verification KYC ─────────────────────────────────────────────────

function renderVerificationEmail(
  adminPrenom: string,
  row: VerificationRow,
): { subject: string; html: string; text: string } {
  const subject = `Niqo Admin — Nouvelle KYC à valider`;
  // Lien direct vers la page détail de la vérification (landing/src/app/admin/(admin-protected)/verifications/[id]/)
  const ctaUrl = `${NIQO_ADMIN_BASE_URL}/verifications/${row.id}`;

  const maskedEmail = maskEmail(row.email);
  const dateStr = formatDate(row.created_at);
  const paysLabel = row.pays === "CI" ? "🇨🇮 Côte d'Ivoire" : row.pays === "CG" ? "🇨🇬 Congo Brazzaville" : row.pays;

  const text = `Bonjour ${adminPrenom},

Une nouvelle demande de vérification d'identité (KYC) vient d'être soumise.

Utilisateur : ${escapeHtml(row.prenom)} (${maskedEmail})
Pays        : ${row.pays}
Date        : ${dateStr}

Examiner → ${ctaUrl}

${getNiqoLegalFooterText()}
`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,address=no,email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Niqo Admin</title>
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
                <span style="font-size:13px;font-weight:400;color:#5A5A57;margin-left:8px;">Admin</span>
              </p>

              <!-- Alerte -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0F8FF;border-left:4px solid #2D7DD2;border-radius:8px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:16px;">
                    <p style="margin:0;font-size:16px;font-weight:700;color:#2D7DD2;">
                      Nouvelle vérification KYC
                    </p>
                    <p style="margin:4px 0 0 0;font-size:14px;color:#1A1A1A;">
                      Bonjour ${escapeHtml(adminPrenom)}, une KYC est en attente de validation.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Grille infos -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;border-radius:12px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;width:90px;vertical-align:top;">Utilisateur</td>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#1A1A1A;font-weight:600;">
                          ${escapeHtml(row.prenom)}<br>
                          <span style="font-weight:400;color:#5A5A57;">${escapeHtml(maskedEmail)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;vertical-align:top;">Pays</td>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#1A1A1A;font-weight:600;">
                          ${escapeHtml(paysLabel)}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0;font-size:13px;color:#5A5A57;vertical-align:top;">Date</td>
                        <td style="padding:0;font-size:13px;color:#1A1A1A;">${escapeHtml(dateStr)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                <tr>
                  <td align="center" style="background-color:#D85A30;border-radius:12px;">
                    <a href="${ctaUrl}" target="_blank" style="display:block;padding:14px 32px;font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;line-height:1.2;">
                      Examiner →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Footer signature -->
              <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#5A5A57;">
                L'équipe Niqo<br>
                <a href="mailto:support@niqo.africa" style="color:#5A5A57;text-decoration:underline;">support@niqo.africa</a>
              </p>

              <!-- Footer légal -->
              ${getNiqoLegalFooterHtml()}

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
