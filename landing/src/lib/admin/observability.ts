// Observability — agrégation des events niqo_event_log pour le dashboard
// /admin/observability.
//
// Stratégie : 1 fetch raw des events 24h (limit 5000), agrégation en mémoire.
// À ~5k events/jour estimé pour le MVP, ça reste rapide. Si on grossit (>10k/j),
// on factorisera en RPC `get_observability_summary()` côté Postgres.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Severity = "debug" | "info" | "warning" | "error";

export interface EventLogRow {
  id: number;
  occurred_at: string;
  module: string;
  event_type: string;
  severity: Severity;
  payload: Record<string, unknown>;
}

export interface ModuleSummary {
  module: string;
  total: number;
  by_severity: Record<Severity, number>;
  by_event_type: Record<string, number>;
  last_occurred_at: string | null;
}

/**
 * Un bucket = une plage de temps continue (1h ou 1 jour selon la fenêtre).
 * Le label est court pour l'axe X du chart ("14h", "Lun", "12/05").
 */
export interface TimelineBucket {
  /** Début du bucket (UTC ISO) */
  start: string;
  label: string;
  info: number;
  warning: number;
  error: number;
}

export interface ObservabilitySummary {
  window_hours: number;
  total: number;
  by_module: ModuleSummary[];
  recent_errors: EventLogRow[];
  recent_warnings: EventLogRow[];
  timeline: TimelineBucket[];
}

/** Granularité du chart selon la fenêtre. */
function bucketSizeMs(windowHours: number): number {
  if (windowHours <= 24) return 3600 * 1000; // 1 heure
  return 24 * 3600 * 1000; // 1 jour
}

function formatBucketLabel(date: Date, windowHours: number): string {
  if (windowHours <= 24) {
    // "14h"
    return date.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      timeZone: "Africa/Abidjan",
    });
  }
  if (windowHours <= 7 * 24) {
    // "Lun 12"
    return date.toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "2-digit",
      timeZone: "Africa/Abidjan",
    });
  }
  // "12/05"
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Africa/Abidjan",
  });
}

function buildTimeline(
  rows: EventLogRow[],
  windowHours: number,
  nowMs: number,
): TimelineBucket[] {
  const sizeMs = bucketSizeMs(windowHours);
  const totalMs = windowHours * 3600 * 1000;
  // Aligner le premier bucket sur sa frontière naturelle (début d'heure ou
  // début de jour UTC) pour éviter des étiquettes décalées entre runs.
  const endAligned = Math.floor(nowMs / sizeMs) * sizeMs + sizeMs;
  const startMs = endAligned - totalMs;
  const bucketCount = Math.ceil(totalMs / sizeMs);

  const buckets: TimelineBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucketStartMs = startMs + i * sizeMs;
    const date = new Date(bucketStartMs);
    buckets.push({
      start: date.toISOString(),
      label: formatBucketLabel(date, windowHours),
      info: 0,
      warning: 0,
      error: 0,
    });
  }

  for (const e of rows) {
    const t = new Date(e.occurred_at).getTime();
    const idx = Math.floor((t - startMs) / sizeMs);
    if (idx < 0 || idx >= bucketCount) continue;
    const b = buckets[idx]!;
    if (e.severity === "error") b.error++;
    else if (e.severity === "warning") b.warning++;
    else if (e.severity === "info") b.info++;
    // debug n'est pas tracé sur le chart (rare, peu utile visuellement)
  }

  return buckets;
}

const EMPTY_SEVERITY: Record<Severity, number> = {
  debug: 0,
  info: 0,
  warning: 0,
  error: 0,
};

export async function fetchObservability(
  supabase: SupabaseClient,
  windowHours = 24,
): Promise<ObservabilitySummary | null> {
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from("niqo_event_log")
    .select("id, occurred_at, module, event_type, severity, payload")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[observability] query failed", error);
    return null;
  }

  const rows = (data ?? []) as EventLogRow[];

  // Agrégation par module
  const moduleMap = new Map<string, ModuleSummary>();
  for (const e of rows) {
    let m = moduleMap.get(e.module);
    if (!m) {
      m = {
        module: e.module,
        total: 0,
        by_severity: { ...EMPTY_SEVERITY },
        by_event_type: {},
        last_occurred_at: null,
      };
      moduleMap.set(e.module, m);
    }
    m.total++;
    m.by_severity[e.severity]++;
    m.by_event_type[e.event_type] = (m.by_event_type[e.event_type] ?? 0) + 1;
    // rows est trié DESC, la première occurrence rencontrée est la plus récente
    if (m.last_occurred_at === null) {
      m.last_occurred_at = e.occurred_at;
    }
  }

  const byModule = Array.from(moduleMap.values()).sort(
    (a, b) => b.total - a.total,
  );

  const recentErrors = rows.filter((r) => r.severity === "error").slice(0, 20);
  const recentWarnings = rows.filter((r) => r.severity === "warning").slice(0, 10);
  const timeline = buildTimeline(rows, windowHours, Date.now());

  return {
    window_hours: windowHours,
    total: rows.length,
    by_module: byModule,
    recent_errors: recentErrors,
    recent_warnings: recentWarnings,
    timeline,
  };
}

// ── Période URL ──────────────────────────────────────────────────────────────
// Filtre via `?window=24h|7d|30d`. Default 24h.

export type WindowKey = "24h" | "7d" | "30d";

export const WINDOW_HOURS: Record<WindowKey, number> = {
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
};

export const WINDOW_LABELS: Record<WindowKey, string> = {
  "24h": "24 heures",
  "7d": "7 jours",
  "30d": "30 jours",
};

export function urlToWindow(raw: string | undefined): WindowKey {
  if (raw === "7d" || raw === "30d" || raw === "24h") return raw;
  return "24h";
}

// Labels humains des modules connus, pour l'affichage UI.
// Si un module inconnu apparaît, on fallback sur le nom brut.
export const MODULE_LABELS: Record<string, string> = {
  // Edge Functions
  "send-push": "Push notifications",
  "pawapay-init-deposit": "PawaPay — init deposit",
  "pawapay-webhook": "PawaPay — webhook",
  "purge-annonces-photos": "Purge photos annonces",
  "moderate-text": "Modération texte (OpenAI)",
  "moderate-image": "Modération image (Rekognition)",
  "moderate-message": "Modération messagerie (OpenAI)",
  "generate-compta-pdf": "Génération PDF comptable",
  "send-alert-digest": "Alerte digest email",

  // Crons DB instrumentés (mig 109)
  "niqo-purge-suspended-users": "Cron — purge comptes suspendus",
  "expire-annonces": "Cron — expiration annonces (60j)",
  "purge-expired-annonces": "Cron — purge annonces expirées",
  "avis-auto-j7": "Cron — avis automatique J+7",
  "purge-expired-kyc-verifications": "Cron — purge KYC obsolètes",
  "purge-expired-boosts": "Cron — purge boosts expirés",
  "purge-stale-push-tokens": "Cron — purge tokens push",
  "rencontre-reminder": "Cron — rappel rencontre",
  "mark-vendue-reminder": "Cron — rappel marquer vendue",
  "rdv-reminder": "Cron — rappel RDV (1h avant)",
};
