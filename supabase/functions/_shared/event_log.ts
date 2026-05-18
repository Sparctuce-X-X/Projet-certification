// Helper partagé — Edge Functions Deno
//
// Appelle la RPC public.log_event (mig 106) pour alimenter niqo_event_log.
// La RPC elle-même est SECURITY DEFINER + catch-all, donc un échec côté DB
// retournera null sans raise. Côté client supabase-js, on ajoute en plus
// un try/catch défensif pour les erreurs réseau/timeout.
//
// Conventions de nommage (à respecter pour la cohérence du dashboard) :
//
//   module        : nom court de l'Edge Function ou du cron
//                   ex: "send-push", "pawapay-webhook", "purge-annonces-photos"
//
//   event_type    : "<domaine>.<verbe>"
//                   ex: "push.sent", "push.db_error",
//                       "webhook.completed", "webhook.rejected",
//                       "deposit.mock_completed", "deposit.pending",
//                       "purge.completed", "purge.error"
//
//   severity      : info (happy path), warning (signal métier suspect),
//                   error (échec technique), debug (verbosité optionnelle)
//
//   payload       : counts + codes uniquement. Pas de PII (tokens, phone numbers,
//                   pawapay_metadata complet). Le but est de compter et grouper,
//                   pas de stocker des données sensibles.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type Severity = "debug" | "info" | "warning" | "error";

export async function logEvent(
  client: SupabaseClient,
  module: string,
  eventType: string,
  severity: Severity = "info",
  payload: Record<string, unknown> = {},
  userId: string | null = null,
): Promise<void> {
  try {
    const { error } = await client.rpc("log_event", {
      p_module: module,
      p_event_type: eventType,
      p_severity: severity,
      p_payload: payload,
      p_user_id: userId,
    });
    if (error) {
      console.warn(`[event_log] rpc failed: ${error.code} ${error.message}`);
    }
  } catch (e) {
    console.warn(`[event_log] rpc threw: ${(e as Error).message}`);
  }
}
