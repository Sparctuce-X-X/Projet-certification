import { sendNiqoEmail } from "./_client";
import { getNiqoLegalFooterHtml, getNiqoLegalFooterText } from "@/lib/niqo-legal";

/**
 * Email transactionnel envoyé après validation/refus d'une vérification KYC.
 * Utilise le helper partagé `_client.ts` pour Resend init + replyTo + tags
 * (centralisation anti-spam, cf. doc du helper).
 */

interface SendVerificationResultArgs {
  to: string;
  userName: string;
  status: "verified" | "rejected";
  rejectReason?: string;
}

export async function sendVerificationResultEmail(
  args: SendVerificationResultArgs
): Promise<{ ok: boolean; reason?: string }> {
  const { subject, html, text } =
    args.status === "verified"
      ? renderVerifiedEmail(args.userName)
      : renderRejectedEmail(args.userName, args.rejectReason ?? "");

  return sendNiqoEmail({
    to: args.to,
    subject,
    html,
    text,
    category: args.status === "verified" ? "kyc-verified" : "kyc-rejected",
    logContext: "verification-result",
  });
}

// ── Templates ────────────────────────────────────────────────────────────────

function renderVerifiedEmail(userName: string) {
  const subject = "Niqo — Tu es désormais Vendeur Vérifié.";
  const text = `Bonjour ${userName},

Bonne nouvelle : ton dossier d'identité a été validé. Tu es désormais
Vendeur Vérifié sur Niqo.

Concrètement :
  · Le badge "Vendeur Vérifié" est affiché sur ton profil et toutes tes annonces
  · Tu peux publier autant d'annonces que tu veux (plafond de 3 levé)
  · Les acheteurs te font confiance plus rapidement → plus de contacts

Bonne vente,
L'équipe Niqo

---
Niqo — La marketplace de confiance en Afrique

${getNiqoLegalFooterText()}
`;

  const html = `<!DOCTYPE html>
<html lang="fr">
  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#FAFAFA; padding:40px 16px; margin:0;">
    <table role="presentation" style="max-width:560px; margin:0 auto; background:#FFFFFF; border-radius:16px; padding:32px;">
      <tr><td>
        <div style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin-bottom:32px;">
          niqo<span style="color:#D85A30;">.</span>
        </div>
        <div style="width:48px; height:48px; border-radius:24px; background:#1D9E7510; display:inline-block; line-height:48px; text-align:center; font-size:24px; margin-bottom:16px;">✓</div>
        <h1 style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin:0 0 8px;">
          Tu es désormais Vendeur Vérifié<span style="color:#D85A30;">.</span>
        </h1>
        <p style="font-size:16px; color:#444441; line-height:1.6; margin:0 0 24px;">
          Bonjour <strong>${escapeHtml(userName)}</strong>, ton dossier d'identité a été validé.
        </p>
        <div style="background:#FAFAFA; border-radius:12px; padding:20px; margin-bottom:24px;">
          <p style="font-size:14px; color:#1A1A1A; margin:0 0 12px; font-weight:600;">Ce qui change pour toi</p>
          <ul style="font-size:14px; color:#444441; line-height:1.7; margin:0; padding-left:20px;">
            <li>Badge <strong>Vendeur Vérifié</strong> à vie sur ton profil et tes annonces</li>
            <li>Plafond de 3 annonces simultanées <strong>levé</strong></li>
            <li>Plus de contacts acheteurs (filtrage par badge)</li>
          </ul>
        </div>
        <p style="font-size:14px; color:#888780; margin:24px 0 0;">
          Bonne vente,<br />L'équipe Niqo
        </p>
      </td></tr>
    </table>
    <p style="text-align:center; font-size:12px; color:#5A5A57; margin-top:24px;">
      Niqo — La marketplace de confiance en Afrique
    </p>
    <hr style="border:none;border-top:1px solid #E5E5E0;margin:16px auto;max-width:560px;">
    <div style="max-width:560px;margin:0 auto;text-align:center;">
      ${getNiqoLegalFooterHtml()}
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

function renderRejectedEmail(userName: string, reason: string) {
  const subject = "Niqo — Ta vérification d'identité n'a pas été validée.";
  const text = `Bonjour ${userName},

Ton dossier de vérification d'identité n'a pas pu être validé.

Raison du refus :
${reason}

Tu peux soumettre un nouveau dossier directement depuis l'app, après avoir
corrigé le problème. ⚠ Le paiement de 1 000 FCFA est non remboursable, comme
indiqué lors de ta soumission.

Si tu penses qu'il y a une erreur de notre côté, écris-nous à
support@niqo.africa.

L'équipe Niqo

---
Niqo — La marketplace de confiance en Afrique

${getNiqoLegalFooterText()}
`;

  const html = `<!DOCTYPE html>
<html lang="fr">
  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#FAFAFA; padding:40px 16px; margin:0;">
    <table role="presentation" style="max-width:560px; margin:0 auto; background:#FFFFFF; border-radius:16px; padding:32px;">
      <tr><td>
        <div style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin-bottom:32px;">
          niqo<span style="color:#D85A30;">.</span>
        </div>
        <div style="width:48px; height:48px; border-radius:24px; background:#E24B4A10; display:inline-block; line-height:48px; text-align:center; font-size:24px; color:#E24B4A; margin-bottom:16px;">✗</div>
        <h1 style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin:0 0 8px;">
          Vérification non validée<span style="color:#D85A30;">.</span>
        </h1>
        <p style="font-size:16px; color:#444441; line-height:1.6; margin:0 0 20px;">
          Bonjour <strong>${escapeHtml(userName)}</strong>, ton dossier d'identité n'a pas pu être validé cette fois.
        </p>
        <div style="background:#E24B4A0D; border-left:3px solid #E24B4A; border-radius:8px; padding:16px 20px; margin-bottom:20px;">
          <p style="font-size:13px; color:#888780; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 6px;">Raison</p>
          <p style="font-size:15px; color:#1A1A1A; margin:0; line-height:1.5;">
            ${escapeHtml(reason)}
          </p>
        </div>
        <p style="font-size:14px; color:#444441; line-height:1.6; margin:0 0 16px;">
          Tu peux soumettre un nouveau dossier directement depuis l'app après avoir corrigé le problème.
        </p>
        <p style="font-size:13px; color:#888780; line-height:1.5; margin:0 0 24px;">
          ⚠ Le paiement de 1 000 FCFA est non remboursable, comme indiqué lors de ta soumission.
        </p>
        <p style="font-size:14px; color:#888780; margin:0;">
          Si tu penses qu'il y a une erreur, écris-nous à <a href="mailto:support@niqo.africa" style="color:#D85A30;">support@niqo.africa</a>.
        </p>
      </td></tr>
    </table>
    <p style="text-align:center; font-size:12px; color:#5A5A57; margin-top:24px;">
      Niqo — La marketplace de confiance en Afrique
    </p>
    <hr style="border:none;border-top:1px solid #E5E5E0;margin:16px auto;max-width:560px;">
    <div style="max-width:560px;margin:0 auto;text-align:center;">
      ${getNiqoLegalFooterHtml()}
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
