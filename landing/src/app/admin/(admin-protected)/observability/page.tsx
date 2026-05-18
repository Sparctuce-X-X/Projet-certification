import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  FileText,
  Hourglass,
  ImageIcon,
  Mail,
  MessageSquare,
  MessageSquareWarning,
  Phone,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";
import { formatParisDateTime, formatParisTime } from "@/lib/date-format";
import {
  fetchObservability,
  MODULE_LABELS,
  urlToWindow,
  WINDOW_HOURS,
  WINDOW_LABELS,
  type EventLogRow,
  type Severity,
} from "@/lib/admin/observability";

import { EventsTimeline } from "./_components/EventsTimeline";
import { PeriodFilter } from "./_components/PeriodFilter";

export const metadata: Metadata = {
  title: "Observabilité · Niqo Admin",
  robots: { index: false, follow: false },
};

// Pas de cache : on veut toujours les events 24h glissantes.
export const dynamic = "force-dynamic";

// Icône par module — fallback Activity si module inconnu.
const MODULE_ICONS: Record<string, typeof Activity> = {
  // Edge Functions
  "send-push": MessageSquare,
  "pawapay-init-deposit": Phone,
  "pawapay-webhook": Phone,
  "purge-annonces-photos": ImageIcon,
  "moderate-text": ShieldAlert,
  "moderate-image": ShieldAlert,
  "moderate-message": MessageSquareWarning,
  "generate-compta-pdf": FileText,
  "send-alert-digest": Mail,

  // Crons DB (mig 109)
  "niqo-purge-suspended-users": Trash2,
  "expire-annonces": Hourglass,
  "purge-expired-annonces": Trash2,
  "avis-auto-j7": Star,
  "purge-expired-kyc-verifications": Trash2,
  "purge-expired-boosts": Trash2,
  "purge-stale-push-tokens": Trash2,
  "rencontre-reminder": Bell,
  "mark-vendue-reminder": Bell,
  "rdv-reminder": CalendarClock,
};

export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const sp = await searchParams;
  const windowKey = urlToWindow(sp.window);
  const windowHours = WINDOW_HOURS[windowKey];
  const windowLabel = WINDOW_LABELS[windowKey];

  const supabase = await createClient();
  const summary = await fetchObservability(supabase, windowHours);

  if (!summary) {
    return (
      <div className="px-8 py-10 max-w-[1400px] mx-auto">
        <h1 className="font-display text-3xl font-bold text-niqo-black mb-2">
          Observabilité
        </h1>
        <p className="text-niqo-gray-600">
          Impossible de charger les events. Vérifie que la migration 106 est jouée.
        </p>
      </div>
    );
  }

  const hasAnyErrors = summary.recent_errors.length > 0;
  const hasAnyWarnings = summary.recent_warnings.length > 0;

  return (
    <div className="px-8 py-10 max-w-[1400px] mx-auto">
      <header className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-niqo-black">
            Observabilité
          </h1>
          <p className="text-niqo-gray-600 mt-1">
            Fenêtre {windowLabel} ·{" "}
            <strong className="text-niqo-black">{summary.total}</strong> events au
            total
          </p>
        </div>
        <PeriodFilter current={windowKey} />
      </header>

      {/* État de santé global */}
      {!hasAnyErrors && !hasAnyWarnings && summary.total > 0 && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-green-800 font-medium text-sm">
            Tout est vert — aucune erreur ni warning sur la fenêtre {windowLabel}.
          </p>
        </div>
      )}

      {summary.total === 0 && (
        <div className="mb-6 bg-niqo-gray-50 border border-niqo-gray-200 rounded-xl p-6 text-center">
          <p className="text-niqo-gray-600 text-sm">
            Aucun event sur la fenêtre. Soit aucune activité, soit les Edge
            Functions ne sont pas encore redéployées avec l'instrumentation
            event_log.
          </p>
        </div>
      )}

      {/* Tiles par module */}
      {summary.by_module.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {summary.by_module.map((m) => {
            const label = MODULE_LABELS[m.module] ?? m.module;
            const Icon = MODULE_ICONS[m.module] ?? Activity;
            const errCount = m.by_severity.error;
            const warnCount = m.by_severity.warning;
            const tone =
              errCount > 0 ? "error" : warnCount > 0 ? "warning" : "ok";

            const tileBg =
              tone === "error"
                ? "bg-red-50 text-red-600"
                : tone === "warning"
                  ? "bg-amber-50 text-amber-600"
                  : "bg-niqo-gray-100 text-niqo-gray-700";

            return (
              <div
                key={m.module}
                className="bg-white border border-niqo-gray-200 rounded-xl p-5"
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className={`p-2 rounded-lg ${tileBg}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-bold text-niqo-black">
                      {label}
                    </h3>
                    <p className="text-xs text-niqo-gray-500 font-mono truncate">
                      {m.module}
                    </p>
                  </div>
                </div>

                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-3xl font-display font-bold text-niqo-black">
                    {m.total}
                  </span>
                  <span className="text-xs text-niqo-gray-500">events</span>
                </div>

                {/* Severities */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mb-3">
                  {errCount > 0 && (
                    <span className="text-red-700 font-medium">
                      ● {errCount} erreur{errCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {warnCount > 0 && (
                    <span className="text-amber-700 font-medium">
                      ● {warnCount} warning{warnCount > 1 ? "s" : ""}
                    </span>
                  )}
                  {m.by_severity.info > 0 && (
                    <span className="text-niqo-gray-600">
                      ● {m.by_severity.info} info
                    </span>
                  )}
                </div>

                {/* Top event types */}
                <div className="pt-3 border-t border-niqo-gray-100 space-y-1.5">
                  {Object.entries(m.by_event_type)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 4)
                    .map(([t, n]) => (
                      <div
                        key={t}
                        className="flex justify-between items-center text-xs"
                      >
                        <span className="font-mono text-niqo-gray-700 truncate pr-2">
                          {t}
                        </span>
                        <span className="font-mono text-niqo-gray-500 shrink-0">
                          {n}
                        </span>
                      </div>
                    ))}
                </div>

                {/* Last seen */}
                {m.last_occurred_at && (
                  <p className="mt-3 pt-3 border-t border-niqo-gray-100 text-xs text-niqo-gray-500">
                    Dernier event :{" "}
                    <time dateTime={m.last_occurred_at}>
                      {formatParisDateTime(m.last_occurred_at)}
                    </time>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Chart timeline */}
      {summary.total > 0 && (
        <div className="mb-8">
          <EventsTimeline data={summary.timeline} windowLabel={windowLabel} />
        </div>
      )}

      {/* Erreurs récentes */}
      {hasAnyErrors && (
        <EventTable
          title="Erreurs récentes"
          rows={summary.recent_errors}
          severity="error"
        />
      )}

      {/* Warnings récents */}
      {hasAnyWarnings && (
        <EventTable
          title="Warnings récents"
          rows={summary.recent_warnings}
          severity="warning"
        />
      )}
    </div>
  );
}

function EventTable({
  title,
  rows,
  severity,
}: {
  title: string;
  rows: EventLogRow[];
  severity: Severity;
}) {
  const titleIcon =
    severity === "error" ? (
      <AlertTriangle className="w-5 h-5 text-red-600" />
    ) : (
      <AlertTriangle className="w-5 h-5 text-amber-600" />
    );
  const typeColor = severity === "error" ? "text-red-700" : "text-amber-700";

  return (
    <section className="mb-8">
      <h2 className="font-display text-xl font-bold text-niqo-black mb-4 flex items-center gap-2">
        {titleIcon}
        {title}
        <span className="text-sm font-normal text-niqo-gray-500">
          ({rows.length})
        </span>
      </h2>
      <div className="bg-white border border-niqo-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-niqo-gray-50 text-xs uppercase tracking-wider text-niqo-gray-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Quand</th>
              <th className="px-4 py-3 text-left font-medium">Module</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Payload</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-niqo-gray-100">
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-niqo-gray-50/50">
                <td className="px-4 py-3 text-xs text-niqo-gray-600 font-mono whitespace-nowrap">
                  {formatParisTime(e.occurred_at)}
                </td>
                <td className="px-4 py-3 text-xs font-mono text-niqo-gray-700 whitespace-nowrap">
                  {e.module}
                </td>
                <td
                  className={`px-4 py-3 text-xs font-mono font-medium whitespace-nowrap ${typeColor}`}
                >
                  {e.event_type}
                </td>
                <td className="px-4 py-3 text-xs text-niqo-gray-700 max-w-xl truncate font-mono">
                  {JSON.stringify(e.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
