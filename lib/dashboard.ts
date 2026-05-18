import { supabase, withTimeout, AUTH_TIMEOUT_MS } from "@/lib/supabase";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DashboardStats {
  annonces: {
    total: number;
    active: number;
    en_cours: number;
    vendue: number;
    expiree: number;
    suspendue: number;
    /** F09 — annonces avec boost actif (boost_until > now()) */
    boosted: number;
  };
  vues_total: number;
  conversations: {
    total: number;
    unread: number;
  };
  rdv: {
    proposed: number;
    confirmed_upcoming: number;
    past: number;
  };
  profile: {
    nb_ventes: number;
    nb_achats: number;
    note_vendeur: number;
    note_acheteur: number;
    nb_signalements: number;
    score_abus: number;
    is_verified: boolean;
    is_active: boolean;
  };
}

// ── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Récupère toutes les stats du vendeur connecté en 1 round-trip.
 * RPC `get_my_dashboard_stats` (mig 58) retourne un JSONB structuré.
 *
 * Throw en cas d'erreur — le caller affiche un état d'erreur ou retry.
 */
export async function fetchMyDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc("get_my_dashboard_stats")),
    AUTH_TIMEOUT_MS,
    "fetchMyDashboardStats"
  );

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Aucune donnée retournée.");

  return data as DashboardStats;
}
