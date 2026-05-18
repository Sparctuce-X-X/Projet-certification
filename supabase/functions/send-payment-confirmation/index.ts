// Edge Function — send-payment-confirmation
//
// Génère un reçu PDF Niqo et l'envoie par email à l'utilisateur après qu'un
// paiement passe au statut `completed` (boost, vérification d'identité, etc.).
//
// FLOW
//   1. Vérifier le secret NIQO_INTERNAL_KEY (Bearer, constant-time)
//   2. Lire le body { paiement_id: string } — valider UUID
//   3. Fetch paiement (avec join users) depuis paiements_niqo WHERE statut='completed'
//   4. Si type='boost' && target_id : fetch titre annonce (best-effort)
//   5. Générer le PDF reçu Niqo (pdf-lib, A4 portrait, design coral)
//   6. Upload PDF dans Storage `paiements-receipts/{user_id}/{paiement_id}.pdf`
//   7. Créer une signed URL 90 jours pour le téléchargement
//   8. Envoyer l'email via sendNiqoEmail (Resend) avec PDF en pièce jointe
//   9. Instrumenter : logEvent + captureException si erreur
//
// AUTH
//   NIQO_INTERNAL_KEY (Bearer) — secret partagé stocké côté Vault + Edge Secrets.
//   Même clé que send-push-notification, send-welcome-email, send-admin-notification.
//   Comparaison constant-time pour éviter les timing attacks.
//
// SECRETS REQUIS (Supabase Edge Functions → Secrets)
//   - RESEND_API_KEY                  (Resend API)
//   - NIQO_INTERNAL_KEY               (secret partagé Vault + EF)
//   - SUPABASE_URL                    (auto)
//   - SUPABASE_SERVICE_ROLE_KEY       (auto)
//
// BUCKET REQUIS
//   `paiements-receipts` — privé, créé par mig 126.
//
// Déploiement :
//   supabase functions deploy send-payment-confirmation

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { captureException } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";
import { sendNiqoEmail } from "../_shared/email.ts";
import {
  getNiqoLegalFooterHtml,
  getNiqoLegalFooterText,
  NIQO_LEGAL_NAME,
  NIQO_RDB_TIN,
  NIQO_LEGAL_FORM,
  NIQO_HQ_ADDRESS,
  NIQO_CAPITAL,
  NIQO_SUPPORT_EMAIL,
  NIQO_WEBSITE_URL,
} from "../_shared/niqo-legal.ts";
import { formatCountryDateTime } from "../_shared/date-format.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "paiements-receipts";

// ── CORS (pattern send-admin-notification) ────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// ── Auth : NIQO_INTERNAL_KEY (même clé que les autres EF internes) ────────────

function getAcceptedKeys(): string[] {
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

// ── UUID validation ───────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// ── Helpers formatage ─────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formate une date ISO en format lisible FR (heure locale du pays user).
 * ex: "14/05/2026 10:30" (Africa/Abidjan pour CI, Africa/Brazzaville pour CG)
 */
function formatDateLong(isoString: string, pays: "CI" | "CG"): string {
  try {
    return formatCountryDateTime(isoString, pays);
  } catch {
    return isoString;
  }
}

/**
 * Formate une date ISO en format court pour PDF (heure locale du pays user).
 * ex: "14/05/2026 10:30" (Africa/Abidjan pour CI, Africa/Brazzaville pour CG)
 */
function fmtDate(isoString: string, pays: "CI" | "CG"): string {
  try {
    return formatCountryDateTime(isoString, pays);
  } catch {
    return isoString;
  }
}

/**
 * Formate un montant FCFA avec séparateur de milliers ASCII.
 * Évite les NARROW NO-BREAK SPACE (U+202F) de toLocaleString("fr-FR")
 * qui ne sont pas dans WinAnsi et feraient crasher pdf-lib.
 */
function fmtMoney(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Sanitise une string pour pdf-lib (StandardFonts = WinAnsi / Latin-1 uniquement).
 * Préserve les accents français (é è à ô ç, dans CP1252).
 * Remplace tout caractère hors Latin-1 par "?".
 */
function safe(s: string): string {
  return s
    .replace(/[  ]/g, " ")  // nbsp + narrow-nbsp → space
    .replace(/[→←]/g, "->")           // arrows → ASCII
    .replace(/[…]/g, "...")            // ellipsis → ASCII
    .replace(/[≈]/g, "~")             // approximation → ~
    .replace(/[^\x00-\xFF]/g, "?");   // hors Latin-1 → ?
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PaiementType = "verification" | "boost" | "pro_subscription" | "vedette" | "unsuspend";
type PaysPaiement = "CI" | "CG";

interface PaiementRow {
  id: string;
  user_id: string;
  type: PaiementType;
  target_id: string | null;
  montant_fcfa: number;
  pawapay_deposit_id: string | null;
  completed_at: string;
  users: {
    email: string;
    prenom: string;
    nom: string;
    pays: PaysPaiement;
  };
}

// ── Helpers métier ────────────────────────────────────────────────────────────

function getDevise(pays: PaysPaiement): string {
  return pays === "CI" ? "XOF" : "XAF";
}

function getTypeLabel(type: PaiementType, montant: number): string {
  switch (type) {
    case "verification":
      return "Verification d'identite (CNI + selfie)";
    case "boost":
      return montant === 1000 ? "Boost annonce 7 jours" : "Boost annonce 30 jours";
    case "unsuspend":
      return "Levee de suspension";
    case "pro_subscription":
      return "Pack Vendeur Pro (1 mois)";
    case "vedette":
      return "Annonce vedette homepage (1 semaine)";
    default:
      return type;
  }
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

// ── Génération PDF reçu Niqo ──────────────────────────────────────────────────

async function generateReceiptPdf(params: {
  paiement: PaiementRow;
  titrAnnonce: string | null;
  typeLabel: string;
  devise: string;
}): Promise<Uint8Array> {
  const { paiement, titrAnnonce, typeLabel, devise } = params;
  const { users: user } = paiement;

  // Couleurs Niqo
  const coral = rgb(0xD8 / 255, 0x5A / 255, 0x30 / 255);   // #D85A30
  const niqoBlack = rgb(0x1A / 255, 0x1A / 255, 0x1A / 255); // #1A1A1A
  const gray = rgb(0x5A / 255, 0x5A / 255, 0x57 / 255);      // #5A5A57
  const lightGray = rgb(0.85, 0.85, 0.85);                    // séparateurs

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  // A4 portrait : 595 × 842 points
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 48;
  const contentWidth = pageWidth - 2 * margin;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // ── Header coral ─────────────────────────────────────────────────────────────
  // Bande coral en haut
  page.drawRectangle({
    x: 0,
    y: pageHeight - 72,
    width: pageWidth,
    height: 72,
    color: coral,
  });

  // Wordmark "niqo." dans le header
  page.drawText("niqo.", {
    x: margin,
    y: pageHeight - 48,
    size: 28,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Sous-titre "Recu de paiement" à droite dans le header
  page.drawText("Recu de paiement", {
    x: pageWidth - margin - 110,
    y: pageHeight - 44,
    size: 10,
    font: fontRegular,
    color: rgb(1, 0.85, 0.78),
  });

  let y = pageHeight - 96;

  // ── Titre + date ──────────────────────────────────────────────────────────────
  const shortId = paiement.id.slice(0, 8).toUpperCase();
  page.drawText(`RECU N° ${shortId}`, {
    x: margin,
    y,
    size: 18,
    font: fontBold,
    color: niqoBlack,
  });
  y -= 20;

  page.drawText(`Emis le ${fmtDate(paiement.completed_at, paiement.users.pays)}`, {
    x: margin,
    y,
    size: 10,
    font: fontRegular,
    color: gray,
  });
  y -= 32;

  // ── Section EMETTEUR ─────────────────────────────────────────────────────────
  // Bandeau coral léger pour le titre de section
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: contentWidth,
    height: 18,
    color: rgb(0xFF / 255, 0xF0 / 255, 0xEB / 255),
  });
  page.drawText("EMETTEUR", {
    x: margin + 6,
    y: y + 2,
    size: 9,
    font: fontBold,
    color: coral,
  });
  y -= 20;

  const emetteurLines = [
    NIQO_LEGAL_NAME,
    `TIN ${NIQO_RDB_TIN} · ${safe(NIQO_LEGAL_FORM.split(" — ")[0] ?? NIQO_LEGAL_FORM)}`,
    safe(NIQO_HQ_ADDRESS),
    `Capital social : ${NIQO_CAPITAL}`,
    `Contact : ${NIQO_SUPPORT_EMAIL}`,
  ];

  for (let i = 0; i < emetteurLines.length; i++) {
    const line = emetteurLines[i]!;
    page.drawText(safe(line), {
      x: margin + 6,
      y,
      size: i === 0 ? 10 : 9,
      font: i === 0 ? fontBold : fontRegular,
      color: i === 0 ? niqoBlack : gray,
    });
    y -= 14;
  }
  y -= 12;

  // ── Section CLIENT ────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: contentWidth,
    height: 18,
    color: rgb(0xFFF0 / 0xFFFF, 0xEB / 255, 0xE0 / 255),
  });
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: contentWidth,
    height: 18,
    color: rgb(0xF5 / 255, 0xF5 / 255, 0xF5 / 255),
  });
  page.drawText("CLIENT", {
    x: margin + 6,
    y: y + 2,
    size: 9,
    font: fontBold,
    color: gray,
  });
  y -= 20;

  const clientPrenom = safe(`${user.prenom} ${user.nom}`.trim() || "Utilisateur Niqo");
  const clientPays = user.pays === "CI" ? "Cote d'Ivoire (CI)" : "Congo Brazzaville (CG)";

  page.drawText(clientPrenom, {
    x: margin + 6,
    y,
    size: 10,
    font: fontBold,
    color: niqoBlack,
  });
  y -= 14;

  page.drawText(safe(user.email), {
    x: margin + 6,
    y,
    size: 9,
    font: fontRegular,
    color: gray,
  });
  y -= 14;

  page.drawText(`Pays : ${safe(clientPays)}`, {
    x: margin + 6,
    y,
    size: 9,
    font: fontRegular,
    color: gray,
  });
  y -= 28;

  // ── Section DETAIL DU PAIEMENT ────────────────────────────────────────────────
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: contentWidth,
    height: 18,
    color: rgb(0xF5 / 255, 0xF0 / 255, 0xEE / 255),
  });
  page.drawText("DETAIL DU PAIEMENT", {
    x: margin + 6,
    y: y + 2,
    size: 9,
    font: fontBold,
    color: coral,
  });
  y -= 24;

  // Ligne séparateur
  page.drawLine({
    start: { x: margin, y: y + 8 },
    end: { x: margin + contentWidth, y: y + 8 },
    thickness: 0.5,
    color: lightGray,
  });

  // Grille 2 colonnes : label (120pt) | valeur
  const labelX = margin + 6;
  const valueX = margin + 120;

  function drawRow(label: string, value: string, opts?: { bold?: boolean; mono?: boolean; color?: ReturnType<typeof rgb>; large?: boolean }) {
    const font = opts?.mono ? fontMono : opts?.bold ? fontBold : fontRegular;
    const size = opts?.large ? 14 : 9;
    const color = opts?.color ?? niqoBlack;
    page.drawText(safe(label) + " :", {
      x: labelX,
      y,
      size: 9,
      font: fontRegular,
      color: gray,
    });
    page.drawText(safe(value), {
      x: valueX,
      y,
      size,
      font,
      color,
    });
    y -= opts?.large ? 22 : 16;
  }

  drawRow("Type", typeLabel);

  if (paiement.type === "boost" && titrAnnonce) {
    drawRow("Annonce", titrAnnonce);
  }

  // Montant : grand, bold, coral
  drawRow(
    "Montant",
    `${fmtMoney(paiement.montant_fcfa)} ${devise}`,
    { bold: true, color: coral, large: true },
  );

  const refValue = paiement.pawapay_deposit_id ?? paiement.id;
  drawRow("Reference", refValue, { mono: true });

  drawRow("Date paiement", fmtDate(paiement.completed_at, paiement.users.pays));

  y -= 16;

  // ── Ligne de séparation ───────────────────────────────────────────────────────
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + contentWidth, y },
    thickness: 0.5,
    color: lightGray,
  });
  y -= 20;

  // ── Mentions légales ──────────────────────────────────────────────────────────
  page.drawText("MENTIONS LEGALES", {
    x: margin,
    y,
    size: 8,
    font: fontBold,
    color: gray,
  });
  y -= 14;

  const mentionsLines = [
    "Document genere conformement a l'article 23 de la Law N 007/2021 du 05/02/2021",
    "regissant les societes au Rwanda. Ce recu atteste du paiement effectue aupres",
    `de ${NIQO_LEGAL_NAME} (TIN ${NIQO_RDB_TIN}). A conserver pour vos archives`,
    "comptables (duree legale : 10 ans — art. 34 Code de Commerce CI/CG).",
  ];

  for (const line of mentionsLines) {
    page.drawText(safe(line), {
      x: margin,
      y,
      size: 8,
      font: fontRegular,
      color: gray,
    });
    y -= 12;
  }

  y -= 20;

  // ── Footer coral fin ──────────────────────────────────────────────────────────
  // Bande coral fine en bas de page
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: 36,
    color: coral,
  });

  page.drawText(`${NIQO_WEBSITE_URL}  ·  ${NIQO_SUPPORT_EMAIL}`, {
    x: margin,
    y: 12,
    size: 9,
    font: fontRegular,
    color: rgb(1, 0.9, 0.85),
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// ── Template email ────────────────────────────────────────────────────────────

function renderPaymentConfirmationEmail(params: {
  prenom: string;
  typeLabel: string;
  montantFormate: string;
  devise: string;
  titrAnnonce: string | null;
  dateStr: string;
  reference: string;
  signedUrl: string | null;
  paiementId: string;
}): { subject: string; html: string; text: string } {
  const {
    prenom,
    typeLabel,
    montantFormate,
    devise,
    titrAnnonce,
    dateStr,
    reference,
    signedUrl,
    paiementId,
  } = params;

  const subject = `Votre recu Niqo - ${montantFormate} ${devise}`;
  const shortId = paiementId.slice(0, 8).toUpperCase();

  // ── Text fallback ────────────────────────────────────────────────────────────
  const text = [
    `Bonjour ${prenom},`,
    "",
    `Votre paiement Niqo a ete confirme. Voici votre recu.`,
    "",
    `Recu N°     : ${shortId}`,
    `Type        : ${typeLabel}`,
    titrAnnonce ? `Annonce     : ${titrAnnonce}` : null,
    `Montant     : ${montantFormate} ${devise}`,
    `Reference   : ${reference}`,
    `Date        : ${dateStr}`,
    "",
    signedUrl
      ? `Telecharger le recu PDF : ${signedUrl}`
      : "Le recu PDF est joint a cet email.",
    "",
    "Conservez ce recu pour vos archives (duree legale 10 ans).",
    "",
    getNiqoLegalFooterText(),
  ]
    .filter((l) => l !== null)
    .join("\n");

  // ── HTML ─────────────────────────────────────────────────────────────────────
  const annonceRow = titrAnnonce
    ? `<tr>
          <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;width:110px;vertical-align:top;">Annonce</td>
          <td style="padding:0 0 12px 0;font-size:13px;color:#1A1A1A;font-weight:600;">${escapeHtml(titrAnnonce)}</td>
        </tr>`
    : "";

  const ctaBlock = signedUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
        <tr>
          <td align="center" style="background-color:#D85A30;border-radius:12px;">
            <a href="${escapeHtml(signedUrl)}" target="_blank" rel="noopener" style="display:block;padding:14px 32px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;line-height:1.2;">
              Telecharger le recu PDF
            </a>
          </td>
        </tr>
      </table>`
    : `<p style="margin:0 0 24px 0;font-size:13px;color:#5A5A57;">
        Le recu PDF est joint a cet email.
      </p>`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="format-detection" content="telephone=no,address=no,email=no">
  <meta name="x-apple-disable-message-reformatting">
  <title>Recu Niqo</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF9;font-family:Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAF9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;">

          <!-- Header coral -->
          <tr>
            <td style="background-color:#D85A30;padding:24px;">
              <p style="margin:0;font-size:28px;font-weight:700;color:#FFFFFF;letter-spacing:-0.5px;">
                niqo<span style="color:#FFD9C8;">.</span>
              </p>
              <p style="margin:4px 0 0 0;font-size:12px;color:#FFD9C8;">Recu de paiement</p>
            </td>
          </tr>

          <!-- Corps -->
          <tr>
            <td style="padding:32px 24px;">

              <!-- Intro -->
              <p style="margin:0 0 8px 0;font-size:18px;font-weight:700;color:#1A1A1A;">
                Paiement confirme
              </p>
              <p style="margin:0 0 24px 0;font-size:14px;color:#5A5A57;">
                Bonjour ${escapeHtml(prenom)}, votre paiement a bien ete enregistre.
              </p>

              <!-- Tableau recapitulatif -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFF7F4;border-radius:12px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 16px 0;font-size:11px;font-weight:700;color:#D85A30;text-transform:uppercase;letter-spacing:0.5px;">
                      Recu N° ${escapeHtml(shortId)}
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;width:110px;vertical-align:top;">Type</td>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#1A1A1A;font-weight:600;">${escapeHtml(typeLabel)}</td>
                      </tr>
                      ${annonceRow}
                      <tr>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;vertical-align:top;">Montant</td>
                        <td style="padding:0 0 12px 0;vertical-align:top;">
                          <span style="font-size:22px;font-weight:700;color:#D85A30;">${escapeHtml(montantFormate)}</span>
                          <span style="font-size:14px;font-weight:600;color:#D85A30;margin-left:4px;">${escapeHtml(devise)}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 12px 0;font-size:13px;color:#5A5A57;vertical-align:top;">Reference</td>
                        <td style="padding:0 0 12px 0;font-size:11px;color:#5A5A57;font-family:monospace;">${escapeHtml(reference)}</td>
                      </tr>
                      <tr>
                        <td style="padding:0;font-size:13px;color:#5A5A57;vertical-align:top;">Date</td>
                        <td style="padding:0;font-size:13px;color:#1A1A1A;">${escapeHtml(dateStr)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA PDF ou info pj -->
              ${ctaBlock}

              <!-- Note archive -->
              <p style="margin:0 0 24px 0;font-size:12px;line-height:1.5;color:#5A5A57;">
                Le recu PDF est joint a cet email. Conservez-le pour vos archives comptables (duree legale : 10 ans).
              </p>

              <!-- Footer signature -->
              <p style="margin:0 0 24px 0;font-size:13px;line-height:1.5;color:#5A5A57;">
                L'equipe Niqo<br>
                <a href="mailto:${escapeHtml(NIQO_SUPPORT_EMAIL)}" style="color:#5A5A57;text-decoration:underline;">${escapeHtml(NIQO_SUPPORT_EMAIL)}</a>
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
  const accepted = getAcceptedKeys();
  if (!token || accepted.length === 0 || !anyConstantTimeMatch(token, accepted)) {
    return new Response("Unauthorized", { status: 403, headers: CORS_HEADERS });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { paiement_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  const paiementId = body.paiement_id;
  if (!paiementId || typeof paiementId !== "string" || !isValidUuid(paiementId)) {
    return jsonError("INVALID_PAIEMENT_ID", 400);
  }

  // ── Client Supabase service_role ──────────────────────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Fetch paiement ────────────────────────────────────────────────────────
  const { data: rawPaiement, error: paiementErr } = await adminClient
    .from("paiements_niqo")
    .select(`
      id,
      user_id,
      type,
      target_id,
      montant_fcfa,
      pawapay_deposit_id,
      completed_at,
      users!inner(id, email, prenom, nom, pays)
    `)
    .eq("id", paiementId)
    .eq("statut", "completed")
    .single();

  if (paiementErr || !rawPaiement) {
    console.warn(`[payment-confirmation] paiement not found or not completed: ${paiementId}`);
    logEvent(
      adminClient,
      "payment-confirmation",
      "payment_confirmation.not_found",
      "warning",
      { paiement_id: paiementId },
      null,
    );
    return jsonOk({ ok: false, reason: "paiement_not_found_or_not_completed" });
  }

  // Typage correct : Supabase infère array sur FK même unique
  const rawUsers = (rawPaiement as unknown as {
    users: Array<{ id: string; email: string; prenom: string; nom: string; pays: string }> |
           { id: string; email: string; prenom: string; nom: string; pays: string } | null;
  }).users;

  const userObj = Array.isArray(rawUsers) ? rawUsers[0] : rawUsers;
  if (!userObj) {
    console.error(`[payment-confirmation] user not found for paiement ${paiementId}`);
    logEvent(
      adminClient,
      "payment-confirmation",
      "payment_confirmation.user_not_found",
      "error",
      { paiement_id: paiementId },
      null,
    );
    return jsonOk({ ok: false, reason: "user_not_found" });
  }

  const paiement: PaiementRow = {
    id: (rawPaiement as { id: string }).id,
    user_id: (rawPaiement as { user_id: string }).user_id,
    type: (rawPaiement as { type: PaiementType }).type,
    target_id: (rawPaiement as { target_id: string | null }).target_id,
    montant_fcfa: (rawPaiement as { montant_fcfa: number }).montant_fcfa,
    pawapay_deposit_id: (rawPaiement as { pawapay_deposit_id: string | null }).pawapay_deposit_id,
    completed_at: (rawPaiement as { completed_at: string }).completed_at,
    users: {
      email: userObj.email ?? "",
      prenom: userObj.prenom ?? "Utilisateur",
      nom: userObj.nom ?? "",
      pays: (userObj.pays as PaysPaiement) ?? "CI",
    },
  };

  // ── Fetch annonce (best-effort, type=boost uniquement) ────────────────────
  let titrAnnonce: string | null = null;
  if (paiement.type === "boost" && paiement.target_id) {
    const { data: annonceData } = await adminClient
      .from("annonces")
      .select("titre")
      .eq("id", paiement.target_id)
      .single();
    titrAnnonce = (annonceData as { titre: string } | null)?.titre ?? null;
  }

  // ── Métadonnées formatées ─────────────────────────────────────────────────
  const devise = getDevise(paiement.users.pays);
  const typeLabel = getTypeLabel(paiement.type, paiement.montant_fcfa);
  const montantFormate = fmtMoney(paiement.montant_fcfa);
  const dateStr = formatDateLong(paiement.completed_at, paiement.users.pays);
  const reference = paiement.pawapay_deposit_id ?? paiement.id;

  // ── Génération PDF ────────────────────────────────────────────────────────
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateReceiptPdf({ paiement, titrAnnonce, typeLabel, devise });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[payment-confirmation] PDF generation failed: ${msg}`);
    captureException(
      new Error(`PDF generation failed: ${msg}`),
      { tags: { step: "generate-pdf", paiement_id: paiementId } },
      "payment-confirmation",
    );
    logEvent(
      adminClient,
      "payment-confirmation",
      "payment_confirmation.pdf_failed",
      "error",
      { paiement_id: paiementId, reason: msg },
      paiement.user_id,
    );
    return jsonError("PDF_GENERATION_FAILED", 500);
  }

  // ── Upload Storage ────────────────────────────────────────────────────────
  const storagePath = `${paiement.user_id}/${paiement.id}.pdf`;

  const { error: uploadErr } = await adminClient.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,  // idempotent en cas de retry trigger
    });

  if (uploadErr) {
    console.error(`[payment-confirmation] Storage upload failed: ${uploadErr.message}`);
    captureException(
      new Error(`Storage upload failed: ${uploadErr.message}`),
      { tags: { step: "upload-storage", paiement_id: paiementId } },
      "payment-confirmation",
    );
    logEvent(
      adminClient,
      "payment-confirmation",
      "payment_confirmation.upload_failed",
      "error",
      { paiement_id: paiementId, reason: uploadErr.message },
      paiement.user_id,
    );
    // Continuer quand même : envoyer l'email sans lien PDF (le PDF est en PJ)
    console.warn("[payment-confirmation] Continuing without signed URL after upload failure");
  }

  // ── Signed URL 90 jours ───────────────────────────────────────────────────
  let signedUrl: string | null = null;
  if (!uploadErr) {
    const { data: signed } = await adminClient.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 90);  // 90 jours
    signedUrl = signed?.signedUrl ?? null;
  }

  // ── Envoi email avec PDF en pièce jointe ──────────────────────────────────
  // Resend attend le contenu de la PJ en base64 (string).
  // Conversion Uint8Array → base64 via btoa + fromCharCode.
  const pdfBase64 = btoa(
    Array.from(pdfBytes, (b) => String.fromCharCode(b)).join(""),
  );

  const { subject, html, text } = renderPaymentConfirmationEmail({
    prenom: paiement.users.prenom,
    typeLabel,
    montantFormate,
    devise,
    titrAnnonce,
    dateStr,
    reference,
    signedUrl,
    paiementId: paiement.id,
  });

  const emailResult = await sendNiqoEmail({
    to: paiement.users.email,
    subject,
    html,
    text,
    category: "payment-confirmation",
    logContext: "payment-confirmation",
    attachments: [
      {
        filename: `recu-niqo-${paiement.id.slice(0, 8).toLowerCase()}.pdf`,
        content: pdfBase64,
      },
    ],
  });

  if (!emailResult.ok) {
    console.error(
      `[payment-confirmation] email send failed for user ${paiement.user_id}: ${emailResult.reason}`,
    );
    captureException(
      new Error(`email send failed: ${emailResult.reason}`),
      {
        tags: { step: "send-email", paiement_id: paiementId },
        extra: { reason: emailResult.reason, user_id: paiement.user_id },
      },
      "payment-confirmation",
    );
    logEvent(
      adminClient,
      "payment-confirmation",
      "payment_confirmation.email_failed",
      "error",
      { paiement_id: paiementId, reason: emailResult.reason ?? null },
      paiement.user_id,
    );
    return jsonOk({ ok: false, reason: "email_send_failed" });
  }

  // ── Succès ────────────────────────────────────────────────────────────────
  logEvent(
    adminClient,
    "payment-confirmation",
    "payment_confirmation.sent",
    "info",
    {
      paiement_id: paiementId,
      type: paiement.type,
      montant_fcfa: paiement.montant_fcfa,
      devise,
      pdf_bytes: pdfBytes.length,
      has_signed_url: signedUrl !== null,
    },
    paiement.user_id,
  );

  return jsonOk({
    ok: true,
    paiement_id: paiementId,
    email_sent_to: paiement.users.email,
    pdf_bytes: pdfBytes.length,
    has_signed_url: signedUrl !== null,
  });
});
