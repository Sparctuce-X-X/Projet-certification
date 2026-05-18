// Helper partagé — Edge Functions Deno
//
// Wrapper Resend pour les emails transactionnels Niqo (version Deno).
// Miroir de `landing/src/lib/email/_client.ts` (Next.js/Node) avec :
//   - Import Resend via esm.sh (compatible Deno)
//   - `Deno.env.get` au lieu de `process.env`
//   - Champ `attachments?` additionnel (réservé Phase 3 PDF receipt)
//
// Centralise :
//   - Init Resend lazy (on n'instancie que si la clé est présente)
//   - Sender `bonjour@niqo.africa` par défaut (override via `RESEND_FROM`)
//   - `replyTo: support@niqo.africa` — anti-spam + adresse réponse correcte
//   - `tags` Resend par catégorie — debug deliverability par template
//   - Log uniformisé avec contexte logContext
//
// Pas de `List-Unsubscribe` : emails transactionnels uniquement (post-action
// user explicite). Si newsletters un jour → helper séparé `_marketing-client.ts`.
//
// Emails utilisant ce helper (prévus) :
//   - welcome-email         (category: "welcome")       — déclenché trigger DB
//   - admin-notification    (category: "admin-notif")   — phase 2
//   - payment-confirmation  (category: "payment-conf")  — phase 3

import { Resend } from "https://esm.sh/resend@6.12.2";

const FROM_DEFAULT = "Niqo <bonjour@niqo.africa>";
const REPLY_TO = "support@niqo.africa";

export interface NiqoEmailAttachment {
  filename: string;
  /** Contenu encodé en base64 (PDF, image, etc.) */
  content: string;
}

export interface SendNiqoEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Catégorie pour le dashboard Resend (filtrage deliverability par template).
   * Convention : `<module>-<variant>` en kebab-case.
   * Exemples : `welcome`, `kyc-verified`, `payment-conf`.
   */
  category: string;
  /**
   * Contexte court inséré dans les logs `[email]` côté serveur.
   * Exemples : `"welcome-email"`, `"payment-confirmation"`.
   */
  logContext: string;
  /**
   * Pièces jointes (optionnel — réservé Phase 3 PDF receipt).
   * Contenu encodé en base64.
   */
  attachments?: NiqoEmailAttachment[];
}

export async function sendNiqoEmail(
  args: SendNiqoEmailArgs,
): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY non configuré — skip envoi (${args.logContext}) à`,
      args.to,
    );
    return { ok: false, reason: "RESEND_API_KEY missing" };
  }

  const resend = new Resend(apiKey);
  const from = Deno.env.get("RESEND_FROM") ?? FROM_DEFAULT;

  try {
    const { error } = await resend.emails.send({
      from,
      replyTo: REPLY_TO,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      tags: [{ name: "category", value: args.category }],
      ...(args.attachments && args.attachments.length > 0
        ? { attachments: args.attachments }
        : {}),
    });
    if (error) {
      console.error(`[email] resend error (${args.logContext})`, error);
      return { ok: false, reason: (error as { message?: string }).message ?? "resend_error" };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[email] send threw (${args.logContext})`, e);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "unknown",
    };
  }
}
