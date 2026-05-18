import { sendNiqoEmail } from "./_client";
import { getNiqoLegalFooterHtml, getNiqoLegalFooterText } from "@/lib/niqo-legal";

/**
 * Email transactionnel envoyé au vendeur quand son annonce est suspendue
 * par la modération (cascade admin OU auto-suspension via signalement
 * post-RDV de motif fraude — mig 91).
 *
 * Complément du push notif (trigger DB `trg_push_annonce_suspended` mig 67) :
 * le push peut être manqué (app au foreground, lock screen full, token
 * invalide), l'email reste.
 *
 * Utilise le helper partagé `_client.ts` pour Resend init + replyTo + tags.
 */

interface SendAnnonceSuspendedArgs {
  to: string;
  userName: string;
  annonceTitre: string;
  /** Texte FR explicatif du motif (ex : "Tentative de fraude validée par la modération", "Décision de modération"). Affiché à l'user. */
  motif?: string;
}

export async function sendAnnonceSuspendedEmail(
  args: SendAnnonceSuspendedArgs
): Promise<{ ok: boolean; reason?: string }> {
  const { subject, html, text } = renderAnnonceSuspendedEmail(args);

  return sendNiqoEmail({
    to: args.to,
    subject,
    html,
    text,
    category: "annonce-suspended",
    logContext: "annonce-suspended",
  });
}

// ── Template ────────────────────────────────────────────────────────────────

function renderAnnonceSuspendedEmail(args: SendAnnonceSuspendedArgs) {
  const { userName, annonceTitre, motif } = args;
  const motifLine = motif ?? "Décision de modération";

  const subject = "Niqo — Une de tes annonces a été retirée par la modération.";
  const text = `Bonjour ${userName},

Ton annonce "${annonceTitre}" a été retirée par notre équipe de modération.

Raison :
${motifLine}

Concrètement :
  · Ton annonce n'apparaît plus dans la recherche ni sur l'accueil
  · Les conversations existantes restent accessibles (tu peux toujours répondre)
  · Tu peux publier de nouvelles annonces si ton compte n'est pas suspendu

Si tu penses qu'il y a une erreur, écris-nous à support@niqo.africa avec
le titre de l'annonce et ton explication.

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
        <div style="width:48px; height:48px; border-radius:24px; background:#E24B4A10; display:inline-block; line-height:48px; text-align:center; font-size:24px; color:#E24B4A; margin-bottom:16px;">⚠</div>
        <h1 style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin:0 0 8px;">
          Annonce retirée par la modération<span style="color:#D85A30;">.</span>
        </h1>
        <p style="font-size:16px; color:#444441; line-height:1.6; margin:0 0 20px;">
          Bonjour <strong>${escapeHtml(userName)}</strong>, ton annonce a été retirée de la plateforme.
        </p>
        <div style="background:#FAFAFA; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
          <p style="font-size:13px; color:#888780; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 6px;">Annonce concernée</p>
          <p style="font-size:15px; color:#1A1A1A; margin:0; line-height:1.4; font-weight:600;">
            ${escapeHtml(annonceTitre)}
          </p>
        </div>
        <div style="background:#E24B4A0D; border-left:3px solid #E24B4A; border-radius:8px; padding:16px 20px; margin-bottom:24px;">
          <p style="font-size:13px; color:#888780; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 6px;">Raison</p>
          <p style="font-size:15px; color:#1A1A1A; margin:0; line-height:1.5;">
            ${escapeHtml(motifLine)}
          </p>
        </div>
        <div style="background:#FAFAFA; border-radius:12px; padding:20px; margin-bottom:24px;">
          <p style="font-size:14px; color:#1A1A1A; margin:0 0 12px; font-weight:600;">Ce qui change</p>
          <ul style="font-size:14px; color:#444441; line-height:1.7; margin:0; padding-left:20px;">
            <li>Ton annonce n'apparaît plus dans la recherche ni sur l'accueil</li>
            <li>Les conversations existantes restent accessibles</li>
            <li>Tu peux publier de nouvelles annonces si ton compte n'est pas suspendu</li>
          </ul>
        </div>
        <p style="font-size:14px; color:#444441; line-height:1.6; margin:0 0 16px;">
          Si tu penses qu'il y a une erreur, écris-nous à <a href="mailto:support@niqo.africa" style="color:#D85A30;">support@niqo.africa</a>.
        </p>
        <p style="font-size:14px; color:#888780; margin:24px 0 0;">
          L'équipe Niqo
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
