import { sendNiqoEmail } from "./_client";
import { getNiqoLegalFooterHtml, getNiqoLegalFooterText } from "@/lib/niqo-legal";

/**
 * Email transactionnel envoyé au signaleur après décision admin sur son
 * signalement (statut → 'traite' ou 'rejete'). Closure psychologique :
 * le signaleur sait que sa requête a été examinée et a un verdict.
 *
 * Complément du push notif (mig 91 §4.7 `fn_signalement_check_threshold`)
 * qui peut être manqué (app au foreground, lock screen full, token stale).
 *
 * Anti-vendetta : l'identité du signaleur n'est jamais révélée à la cible
 * (variantes `target*`). La cible reçoit seulement le motif (transparence)
 * et le verdict (closure).
 *
 * Utilise le helper partagé `_client.ts` pour Resend init + replyTo + tags.
 */

interface SendSignalementResultArgs {
  to: string;
  userName: string;
  /** Statut final du signalement après décision admin. */
  status: "traite" | "rejete";
  /** Label FR du motif initial (ex : "Tentative de fraude", "Spam", "Contenu illégal"). Affiché au destinataire pour rappeler le motif du signalement. */
  motifLabel: string;
  /** "reporter" = c'est l'auteur du signalement qui reçoit le verdict. "target" = c'est la personne signalée qui reçoit le verdict (transparence anti-opacité, sans révéler l'identité du reporter). */
  recipient: "reporter" | "target";
}

export async function sendSignalementResultEmail(
  args: SendSignalementResultArgs
): Promise<{ ok: boolean; reason?: string }> {
  const { subject, html, text } =
    args.recipient === "target"
      ? args.status === "traite"
        ? renderTargetTraiteEmail(args.userName, args.motifLabel)
        : renderTargetRejeteEmail(args.userName, args.motifLabel)
      : args.status === "traite"
        ? renderTraiteEmail(args.userName, args.motifLabel)
        : renderRejeteEmail(args.userName, args.motifLabel);

  return sendNiqoEmail({
    to: args.to,
    subject,
    html,
    text,
    category: `signalement-${args.status}-${args.recipient}`,
    logContext: "signalement-result",
  });
}

// ── Templates ────────────────────────────────────────────────────────────────

function renderTraiteEmail(userName: string, motifLabel: string) {
  const subject = "Niqo — Ton signalement a été pris en compte.";
  const text = `Bonjour ${userName},

Notre équipe a examiné le signalement que tu as envoyé (motif : ${motifLabel})
et l'a confirmé. Une action a été prise contre la personne ou l'annonce
concernée.

Merci de contribuer à rendre Niqo plus sûr pour tout le monde.

Si tu as d'autres incidents à nous remonter, tu peux toujours utiliser le
bouton « Signaler » directement depuis l'app.

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
        <div style="width:48px; height:48px; border-radius:24px; background:#1D9E7510; display:inline-block; line-height:48px; text-align:center; font-size:24px; color:#1D9E75; margin-bottom:16px;">✓</div>
        <h1 style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin:0 0 8px;">
          Signalement pris en compte<span style="color:#D85A30;">.</span>
        </h1>
        <p style="font-size:16px; color:#444441; line-height:1.6; margin:0 0 20px;">
          Bonjour <strong>${escapeHtml(userName)}</strong>, notre équipe a examiné ton signalement et l'a confirmé.
        </p>
        <div style="background:#FAFAFA; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
          <p style="font-size:13px; color:#888780; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 6px;">Motif signalé</p>
          <p style="font-size:15px; color:#1A1A1A; margin:0; line-height:1.4; font-weight:600;">
            ${escapeHtml(motifLabel)}
          </p>
        </div>
        <div style="background:#1D9E750D; border-left:3px solid #1D9E75; border-radius:8px; padding:16px 20px; margin-bottom:24px;">
          <p style="font-size:14px; color:#1A1A1A; line-height:1.5; margin:0;">
            Une action a été prise contre la personne ou l'annonce concernée. Merci de contribuer à rendre Niqo plus sûr.
          </p>
        </div>
        <p style="font-size:14px; color:#444441; line-height:1.6; margin:0 0 16px;">
          Si tu as d'autres incidents à nous remonter, le bouton « Signaler » reste disponible directement depuis l'app.
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

function renderRejeteEmail(userName: string, motifLabel: string) {
  const subject = "Niqo — Ton signalement a été examiné — non retenu.";
  const text = `Bonjour ${userName},

Nous avons examiné le signalement que tu as envoyé (motif : ${motifLabel})
et conclu qu'il n'y avait pas matière à action de notre part cette fois.

Cela ne remet pas en cause ton ressenti — chaque signalement est étudié
attentivement, et c'est important que tu continues à nous remonter ce qui
te paraît anormal.

Si tu as des éléments supplémentaires (captures d'écran, témoignages,
détails du contexte), écris-nous à support@niqo.africa avec ces preuves
et nous re-examinerons le cas.

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
        <div style="width:48px; height:48px; border-radius:24px; background:#88878010; display:inline-block; line-height:48px; text-align:center; font-size:24px; color:#888780; margin-bottom:16px;">i</div>
        <h1 style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin:0 0 8px;">
          Signalement examiné — non retenu<span style="color:#D85A30;">.</span>
        </h1>
        <p style="font-size:16px; color:#444441; line-height:1.6; margin:0 0 20px;">
          Bonjour <strong>${escapeHtml(userName)}</strong>, nous avons examiné ton signalement et conclu qu'il n'y avait pas matière à action cette fois.
        </p>
        <div style="background:#FAFAFA; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
          <p style="font-size:13px; color:#888780; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 6px;">Motif signalé</p>
          <p style="font-size:15px; color:#1A1A1A; margin:0; line-height:1.4; font-weight:600;">
            ${escapeHtml(motifLabel)}
          </p>
        </div>
        <p style="font-size:14px; color:#444441; line-height:1.6; margin:0 0 16px;">
          Cela ne remet pas en cause ton ressenti — chaque signalement est étudié attentivement, et c'est important que tu continues à nous remonter ce qui te paraît anormal.
        </p>
        <div style="background:#FAFAFA; border-radius:12px; padding:20px; margin-bottom:24px;">
          <p style="font-size:14px; color:#1A1A1A; margin:0 0 12px; font-weight:600;">Tu as plus d'informations ?</p>
          <p style="font-size:14px; color:#444441; line-height:1.6; margin:0;">
            Si tu as des éléments supplémentaires (captures d'écran, témoignages, détails du contexte), écris-nous à <a href="mailto:support@niqo.africa" style="color:#D85A30;">support@niqo.africa</a> avec ces preuves et nous re-examinerons le cas.
          </p>
        </div>
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

// ── Templates côté CIBLE (la personne signalée) ────────────────────────────
// L'identité du signaleur n'est jamais révélée (anti-vendetta). On donne le
// motif pour transparence : la cible sait POURQUOI elle a été signalée.

function renderTargetTraiteEmail(userName: string, motifLabel: string) {
  const subject = "Niqo — Un signalement te concernant a été pris en compte.";
  const text = `Bonjour ${userName},

Notre équipe a examiné un signalement te concernant pour le motif suivant :
${motifLabel}

Après vérification, le signalement a été confirmé et une action a été prise
de notre côté (ton annonce, ton message ou ton compte selon le cas).

Si tu penses qu'il y a une erreur ou si tu veux nous donner ta version,
écris-nous à support@niqo.africa avec ton ID compte et le contexte.

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
        <div style="width:48px; height:48px; border-radius:24px; background:#E24B4A10; display:inline-block; line-height:48px; text-align:center; font-size:24px; color:#E24B4A; margin-bottom:16px;">!</div>
        <h1 style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin:0 0 8px;">
          Signalement te concernant — confirmé<span style="color:#D85A30;">.</span>
        </h1>
        <p style="font-size:16px; color:#444441; line-height:1.6; margin:0 0 20px;">
          Bonjour <strong>${escapeHtml(userName)}</strong>, notre équipe a examiné un signalement te concernant et l'a confirmé.
        </p>
        <div style="background:#FAFAFA; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
          <p style="font-size:13px; color:#888780; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 6px;">Motif du signalement</p>
          <p style="font-size:15px; color:#1A1A1A; margin:0; line-height:1.4; font-weight:600;">
            ${escapeHtml(motifLabel)}
          </p>
        </div>
        <div style="background:#E24B4A0D; border-left:3px solid #E24B4A; border-radius:8px; padding:16px 20px; margin-bottom:24px;">
          <p style="font-size:14px; color:#1A1A1A; line-height:1.5; margin:0;">
            Une action a été prise de notre côté (ton annonce, ton message ou ton compte selon le cas).
          </p>
        </div>
        <p style="font-size:14px; color:#444441; line-height:1.6; margin:0 0 16px;">
          Si tu penses qu'il y a une erreur ou si tu veux nous donner ta version, écris-nous à <a href="mailto:support@niqo.africa" style="color:#D85A30;">support@niqo.africa</a> avec ton ID compte et le contexte.
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

function renderTargetRejeteEmail(userName: string, motifLabel: string) {
  const subject = "Niqo — Un signalement te concernant a été examiné — non retenu.";
  const text = `Bonjour ${userName},

Notre équipe a examiné un signalement te concernant pour le motif suivant :
${motifLabel}

Après vérification, le signalement n'a pas été retenu et aucune action n'a
été prise contre toi. Tu peux continuer à utiliser Niqo normalement.

On te tient au courant pour la transparence.

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
        <div style="width:48px; height:48px; border-radius:24px; background:#1D9E7510; display:inline-block; line-height:48px; text-align:center; font-size:24px; color:#1D9E75; margin-bottom:16px;">✓</div>
        <h1 style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#1A1A1A; margin:0 0 8px;">
          Signalement te concernant — non retenu<span style="color:#D85A30;">.</span>
        </h1>
        <p style="font-size:16px; color:#444441; line-height:1.6; margin:0 0 20px;">
          Bonjour <strong>${escapeHtml(userName)}</strong>, notre équipe a examiné un signalement te concernant. Aucune action n'a été prise contre toi.
        </p>
        <div style="background:#FAFAFA; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
          <p style="font-size:13px; color:#888780; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 6px;">Motif du signalement</p>
          <p style="font-size:15px; color:#1A1A1A; margin:0; line-height:1.4; font-weight:600;">
            ${escapeHtml(motifLabel)}
          </p>
        </div>
        <div style="background:#1D9E750D; border-left:3px solid #1D9E75; border-radius:8px; padding:16px 20px; margin-bottom:24px;">
          <p style="font-size:14px; color:#1A1A1A; line-height:1.5; margin:0;">
            Tu peux continuer à utiliser Niqo normalement. On te tient au courant pour la transparence.
          </p>
        </div>
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
