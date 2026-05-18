import type { createClient } from "@/lib/supabase/server";

/**
 * Types et fetchers pour le dashboard admin v2 — 3 RPCs ciblées :
 *   - admin_kpis_liquidity   (mig 111)
 *   - admin_kpis_activation  (mig 112)
 *   - admin_kpis_revenue     (mig 113)
 *
 * Filtre pays : 'CI' | 'CG' | null (=ALL).
 * Cf. docs/backend/admin_kpis.md.
 */

// ── Sélection période ───────────────────────────────────────────────────────

export type PeriodSelection =
  | { kind: "preset"; value: "30d" | "90d" | "12m" | "all" }
  | { kind: "month"; year: number; month: number } // month 1-12
  | { kind: "year"; year: number };

export const DEFAULT_SELECTION: PeriodSelection = { kind: "preset", value: "30d" };

export function selectionToUrl(s: PeriodSelection): string {
  if (s.kind === "preset") return s.value;
  if (s.kind === "month") {
    return `month-${s.year}-${String(s.month).padStart(2, "0")}`;
  }
  return `year-${s.year}`;
}

export function urlToSelection(raw: string | null | undefined): PeriodSelection {
  if (!raw) return DEFAULT_SELECTION;
  if (raw === "30d" || raw === "90d" || raw === "12m" || raw === "all") {
    return { kind: "preset", value: raw };
  }
  const monthMatch = raw.match(/^month-(\d{4})-(\d{2})$/);
  if (monthMatch?.[1] && monthMatch[2]) {
    const year = parseInt(monthMatch[1], 10);
    const month = parseInt(monthMatch[2], 10);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) {
      return { kind: "month", year, month };
    }
  }
  const yearMatch = raw.match(/^year-(\d{4})$/);
  if (yearMatch?.[1]) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 2000 && year <= 2100) return { kind: "year", year };
  }
  return DEFAULT_SELECTION;
}

export function selectionToWindow(s: PeriodSelection): {
  from: Date | null;
  to: Date | null;
} {
  const now = new Date();
  if (s.kind === "preset") {
    if (s.value === "all") return { from: null, to: null };
    const to = now;
    const from = new Date(now);
    if (s.value === "30d") from.setDate(now.getDate() - 30);
    else if (s.value === "90d") from.setDate(now.getDate() - 90);
    else if (s.value === "12m") from.setMonth(now.getMonth() - 12);
    return { from, to };
  }
  if (s.kind === "month") {
    const from = new Date(s.year, s.month - 1, 1);
    const to = new Date(s.year, s.month, 1);
    return { from, to };
  }
  const from = new Date(s.year, 0, 1);
  const to = new Date(s.year + 1, 0, 1);
  return { from, to };
}

export function selectionToLabel(s: PeriodSelection): string {
  if (s.kind === "preset") {
    switch (s.value) {
      case "30d": return "30 derniers jours";
      case "90d": return "90 derniers jours";
      case "12m": return "12 derniers mois";
      case "all": return "Depuis le début";
    }
  }
  if (s.kind === "month") {
    const d = new Date(s.year, s.month - 1, 1);
    return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }
  return `Année ${s.year}`;
}

export function selectionToShortLabel(s: PeriodSelection): string {
  if (s.kind === "preset") {
    return { "30d": "30j", "90d": "90j", "12m": "12 mois", all: "alltime" }[s.value];
  }
  if (s.kind === "month") {
    const d = new Date(s.year, s.month - 1, 1);
    const m = d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
    return `${m} ${String(s.year).slice(-2)}`;
  }
  return String(s.year);
}

// ── Sélection pays ──────────────────────────────────────────────────────────

export type CountrySelection = "CI" | "CG" | "ALL";

export function urlToCountry(raw: string | null | undefined): CountrySelection {
  if (raw === "CI" || raw === "CG") return raw;
  return "ALL";
}

export function countryToRpcParam(c: CountrySelection): "CI" | "CG" | null {
  return c === "ALL" ? null : c;
}

export function countryLabel(c: CountrySelection): string {
  if (c === "CI") return "Côte d'Ivoire";
  if (c === "CG") return "Congo Brazzaville";
  return "Tous pays (CI + CG)";
}

// ── Types JSON RPCs ─────────────────────────────────────────────────────────

export interface AdminKpisLiquidity {
  generated_at: string;
  window_from: string;
  window_to: string;
  pays: string;
  supply_health: {
    annonces_nouvelles_period: number;
    annonces_actives_total: number;
    annonces_expirees_period: number;
    contacts_per_annonce_avg: number | null;
    time_to_first_contact_p50_hrs: number | null;
  };
  demand_engagement: {
    dau: number;
    wau: number;
    mau: number;
    vues_total_period: number;
    conversations_initiated_period: number;
    vues_to_contact_pct: number | null;
  };
}

export interface AdminKpisActivation {
  generated_at: string;
  window_from: string;
  window_to: string;
  pays: string;
  signups: {
    total_period: number;
    total_prev_period: number;
    delta_pct_vs_prev_period: number;
  };
  activation_funnel: {
    signed_up: number;
    published_first_annonce: number;
    proposed_first_rdv: number;
    completed_first_rdv: number;
    signup_to_publish_pct: number | null;
    publish_to_rdv_pct: number | null;
    rdv_to_avis_pct: number | null;
  };
  trust_quality: {
    total_users: number;
    verified: number;
    verified_pct: number | null;
    vendeur_fiable: number;
    vendeur_fiable_pct: number | null;
    suspended_auto_score: number;
    suspended_admin_manual: number;
  };
}

export interface AdminKpisRevenue {
  generated_at: string;
  window_from: string;
  window_to: string;
  pays: string;
  revenue: {
    total_fcfa_period: number;
    total_xof_period: number;
    total_xaf_period: number;
    total_eur_period: number;
    verifications: { count: number; total_fcfa: number; total_eur: number };
    boosts_7j: { count: number; total_fcfa: number; total_eur: number };
    boosts_30j: { count: number; total_fcfa: number; total_eur: number };
    monthly_history: Array<{
      month: string;
      total_fcfa: number;
      xof_fcfa: number;
      xaf_fcfa: number;
      eur: number;
    }>;
  };
  arpu: {
    eur_period: number | null;
    eur_alltime: number | null;
  };
  alltime: {
    total_fcfa: number;
    total_eur: number;
    vendeurs_distinct: number;
  };
}

export interface AdminKpisAlerts {
  generated_at: string;
  pays: string;
  signalements_pending_24h_plus: number;
  kyc_pending_48h_plus: number;
  suspended_30d: number;
  boosts_stuck_pending: number;
  total: number;
}

// ── Fetchers ────────────────────────────────────────────────────────────────

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function fetchKpisAlerts(
  supabase: SupabaseClient,
  pays: "CI" | "CG" | null,
): Promise<AdminKpisAlerts | null> {
  const { data, error } = await supabase.rpc("admin_kpis_alerts", {
    p_pays: pays,
  });
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[fetchKpisAlerts] rpc error", error.code, error.message);
    }
    return null;
  }
  return data as AdminKpisAlerts;
}

export async function fetchKpisLiquidity(
  supabase: SupabaseClient,
  from: Date | null,
  to: Date | null,
  pays: "CI" | "CG" | null,
): Promise<AdminKpisLiquidity | null> {
  const { data, error } = await supabase.rpc("admin_kpis_liquidity", {
    p_from: from ? from.toISOString() : null,
    p_to: to ? to.toISOString() : null,
    p_pays: pays,
  });
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[fetchKpisLiquidity] rpc error", error.code, error.message);
    }
    return null;
  }
  return data as AdminKpisLiquidity;
}

export async function fetchKpisActivation(
  supabase: SupabaseClient,
  from: Date | null,
  to: Date | null,
  pays: "CI" | "CG" | null,
): Promise<AdminKpisActivation | null> {
  const { data, error } = await supabase.rpc("admin_kpis_activation", {
    p_from: from ? from.toISOString() : null,
    p_to: to ? to.toISOString() : null,
    p_pays: pays,
  });
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[fetchKpisActivation] rpc error", error.code, error.message);
    }
    return null;
  }
  return data as AdminKpisActivation;
}

export async function fetchKpisRevenue(
  supabase: SupabaseClient,
  from: Date | null,
  to: Date | null,
  pays: "CI" | "CG" | null,
): Promise<AdminKpisRevenue | null> {
  const { data, error } = await supabase.rpc("admin_kpis_revenue", {
    p_from: from ? from.toISOString() : null,
    p_to: to ? to.toISOString() : null,
    p_pays: pays,
  });
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[fetchKpisRevenue] rpc error", error.code, error.message);
    }
    return null;
  }
  return data as AdminKpisRevenue;
}

// ── Compta reports (mig 115) ────────────────────────────────────────────────

export interface ComptaReport {
  id: string;
  periode_debut: string;
  periode_fin: string;
  pays: string;
  storage_path: string;
  total_fcfa: number;
  total_xof: number;
  total_xaf: number;
  nb_paiements: number;
  generated_at: string;
  bytes: number;
}

export async function fetchComptaReports(
  supabase: SupabaseClient,
  limit = 20,
): Promise<ComptaReport[]> {
  const { data, error } = await supabase
    .from("admin_compta_reports")
    .select(
      "id, periode_debut, periode_fin, pays, storage_path, total_fcfa, total_xof, total_xaf, nb_paiements, generated_at, bytes",
    )
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[fetchComptaReports] error", error.code, error.message);
    }
    return [];
  }
  return (data ?? []) as ComptaReport[];
}
