import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

// ── Types ───────────────────────────────────────────────────────────────────

export type PendingActionType = "disputed" | "rencontre" | "mark_vendue" | "avis";

export interface PendingAction {
  type: PendingActionType;
  priority: number;
  conversation_id: string;
  annonce_id: string | null;
  annonce_titre: string | null;
  other_user_id: string;
  other_prenom: string | null;
  rdv_date: string | null;
  created_at: string;
}

// ── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Récupère jusqu'à 5 actions pendantes pour l'user courant via la RPC
 * get_pending_user_actions (mig 93). Retourne tableau vide si pas auth ou
 * aucune action.
 */
export async function fetchPendingActions(): Promise<PendingAction[]> {
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(supabase.rpc("get_pending_user_actions")),
      AUTH_TIMEOUT_MS,
      "fetchPendingActions"
    );
    if (error) return [];
    return (data ?? []) as PendingAction[];
  } catch {
    return [];
  }
}

// ── Mapping FR pour la card ─────────────────────────────────────────────────

export function actionTitleFr(action: PendingAction): string {
  switch (action.type) {
    case "disputed":
      return "Désaccord à signaler";
    case "rencontre":
      return "Tu as rencontré quelqu'un ?";
    case "mark_vendue":
      return "Marque ton annonce vendue";
    case "avis":
      return `Note ${action.other_prenom ?? "ton interlocuteur"}`;
  }
}

export function actionSubtitleFr(action: PendingAction): string {
  const titre = action.annonce_titre ?? "Annonce";
  const other = action.other_prenom ?? "l'autre partie";
  switch (action.type) {
    case "disputed":
      return `${titre} · avec ${other}`;
    case "rencontre":
      return `${titre} · ${other}`;
    case "mark_vendue":
      return `${titre}`;
    case "avis":
      return `${titre}`;
  }
}

/**
 * Route deeplink à ouvrir au tap sur une action.
 * mark_vendue → écran annonce (où le bouton est gaté)
 * autres → écran chat
 */
export function actionDeeplink(action: PendingAction): string {
  if (action.type === "mark_vendue" && action.annonce_id) {
    return `/announce/${action.annonce_id}`;
  }
  return `/messages/${action.conversation_id}`;
}
