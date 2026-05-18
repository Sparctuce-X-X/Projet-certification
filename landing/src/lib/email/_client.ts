import { Resend } from "resend";

/**
 * Helper partagé pour les 3 emails transactionnels Niqo (verification-result,
 * annonce-suspended, signalement-result). Centralise :
 *
 *   - Init Resend lazy (on n'instancie que si la clé est présente)
 *   - Sender `bonjour@niqo.africa` par défaut (override via `RESEND_FROM`
 *     pour debug local)
 *   - **`replyTo: support@niqo.africa`** — anti-spam (Gmail score négatif sans)
 *     et l'user peut répondre directement (Reply tombe sur la bonne boîte)
 *   - **`tags`** Resend par catégorie — debug deliverability par template dans
 *     le dashboard Resend (savoir lesquels arrivent en spam plus que les autres)
 *   - Log uniformisé avec contexte
 *
 * Pas de `List-Unsubscribe` header : ce sont des transactionnels (post-action
 * user explicite), pas du marketing. Inviter au désabonnement d'un email KYC
 * ou de modération serait contre-productif (l'user ne recevrait plus les
 * réponses à ses propres actions). Si on ajoute des newsletters un jour →
 * helper séparé `_marketing-client.ts`.
 *
 * Setup Resend :
 *   - `RESEND_API_KEY` dans .env.local (resend.com → Settings → API Keys)
 *   - Domaine `niqo.africa` vérifié (DNS SPF + DKIM posés sur NameCheap)
 *   - DMARC à vérifier manuellement (cf. docs/pre-production-checklist.md §3)
 */

const FROM_DEFAULT = "Niqo <bonjour@niqo.africa>";
const REPLY_TO = "support@niqo.africa";

export interface SendNiqoEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Catégorie pour le dashboard Resend (filtrage deliverability par template).
   * Naming convention : `<module>-<variant>` en kebab-case.
   * Exemples : `kyc-verified`, `kyc-rejected`, `annonce-suspended`,
   * `signalement-traite-reporter`, `signalement-rejete-target`.
   */
  category: string;
  /**
   * Contexte court inséré dans les logs `[email]` côté serveur. Permet de
   * matcher rapidement l'origine d'un échec dans Vercel logs.
   * Exemples : `"verification-result"`, `"annonce-suspended"`.
   */
  logContext: string;
}

export async function sendNiqoEmail(
  args: SendNiqoEmailArgs
): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY non configuré — skip envoi (${args.logContext}) à`,
      args.to
    );
    return { ok: false, reason: "RESEND_API_KEY missing" };
  }

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM ?? FROM_DEFAULT;

  try {
    const { error } = await resend.emails.send({
      from,
      replyTo: REPLY_TO,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      tags: [{ name: "category", value: args.category }],
    });
    if (error) {
      console.error(`[email] resend error (${args.logContext})`, error);
      return { ok: false, reason: error.message };
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
