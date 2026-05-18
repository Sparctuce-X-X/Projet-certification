import {
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Building2,
  CheckCircle2,
  Coins,
  Eye,
  FileText,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import type { Metadata } from "next";

import {
  countryLabel,
  countryToRpcParam,
  fetchComptaReports,
  fetchKpisActivation,
  fetchKpisAlerts,
  fetchKpisLiquidity,
  fetchKpisRevenue,
  selectionToLabel,
  selectionToShortLabel,
  selectionToWindow,
  urlToCountry,
  urlToSelection,
} from "@/lib/admin/kpis";
import { createClient } from "@/lib/supabase/server";
import { formatParisDateShort } from "@/lib/date-format";

import { AlertBand } from "./_components/AlertBand";
import { ComptaReportsList } from "./_components/ComptaReportsList";
import { CountrySelector } from "./_components/CountrySelector";
import { ExportButtons } from "./_components/ExportButtons";
import { GeneratePdfButton } from "./_components/GeneratePdfButton";
import { KpiCard } from "./_components/KpiCard";
import { PeriodFilter } from "./_components/PeriodFilter";
import { RevenueAreaChart } from "./_components/RevenueAreaChart";
import { TimeAgo } from "./_components/TimeAgo";

export const metadata: Metadata = {
  title: "KPIs · Niqo Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function KpisPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; pays?: string }>;
}) {
  const sp = await searchParams;
  const selection = urlToSelection(sp.period);
  const country = urlToCountry(sp.pays);
  const periodLabel = selectionToLabel(selection);
  const periodShort = selectionToShortLabel(selection);
  const { from, to } = selectionToWindow(selection);
  const paysRpc = countryToRpcParam(country);

  const supabase = await createClient();

  const [alerts, liquidity, activation, revenue, reports] = await Promise.all([
    fetchKpisAlerts(supabase, paysRpc),
    fetchKpisLiquidity(supabase, from, to, paysRpc),
    fetchKpisActivation(supabase, from, to, paysRpc),
    fetchKpisRevenue(supabase, from, to, paysRpc),
    fetchComptaReports(supabase, 20),
  ]);

  if (!liquidity || !activation || !revenue) {
    return (
      <div className="mx-auto max-w-[1400px] px-8 py-10">
        <h1 className="mb-2 font-display text-3xl font-bold text-niqo-black">
          KPIs<span className="text-niqo-coral">.</span>
        </h1>
        <div className="mt-10 rounded-xl border border-dashed border-niqo-gray-200 bg-white p-12 text-center">
          <BarChart3 className="mx-auto mb-4 h-10 w-10 text-niqo-gray-500" />
          <p className="mb-1 font-display text-lg font-bold text-niqo-black">
            Données indisponibles
          </p>
          <p className="text-sm text-niqo-gray-500">
            Recharge la page. Si le problème persiste, vérifie que
            <code className="font-mono px-1">is_admin = true</code> sur ton
            compte et que les RPCs <code className="font-mono px-1">admin_kpis_*</code>{" "}
            (migs 111-113, 116) sont appliquées.
          </p>
        </div>
      </div>
    );
  }

  if (activation.trust_quality.total_users === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-8 py-10">
        <h1 className="mb-2 font-display text-3xl font-bold text-niqo-black">
          KPIs<span className="text-niqo-coral">.</span>
        </h1>
        <div className="mt-10 rounded-xl border border-dashed border-niqo-coral/30 bg-white p-16 text-center">
          <Sparkles className="mx-auto mb-4 h-12 w-12 text-niqo-coral" />
          <p className="mb-2 font-display text-xl font-bold text-niqo-black">
            Niqo en pré-lancement
          </p>
          <p className="mx-auto max-w-sm text-sm text-niqo-gray-500">
            Les KPIs s'activeront automatiquement dès les premières
            inscriptions sur la plateforme.
          </p>
        </div>
      </div>
    );
  }

  const { supply_health, demand_engagement } = liquidity;
  const { signups, activation_funnel, trust_quality } = activation;
  const { revenue: rev, arpu, alltime } = revenue;

  // Semantic flags
  const suspendedDanger = trust_quality.suspended_admin_manual > 0;
  const signupsDanger = signups.delta_pct_vs_prev_period < 0 && signups.total_prev_period > 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-10 px-8 py-10">
      {/* ── Header (responsive : stack vertical <md) ────────────────────────── */}
      <header className="flex flex-col items-start justify-between gap-4 md:flex-row md:flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold text-niqo-black">
            KPIs<span className="text-niqo-coral">.</span>
          </h1>
          <p className="mt-1 text-sm text-niqo-gray-500">
            <span className="font-medium text-niqo-black">{countryLabel(country)}</span>
            {" · "}
            <span className="font-medium text-niqo-black">{periodLabel}</span>
            {" · "}
            mis à jour <TimeAgo iso={liquidity.generated_at} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CountrySelector current={country} />
          <PeriodFilter current={selection} />
        </div>
      </header>

      {/* ── AlertBand (P0 daily-use) ──────────────────────────────────────── */}
      {alerts ? <AlertBand alerts={alerts} /> : null}

      {/* ═════ Panel 1 — LIQUIDITÉ ═════════════════════════════════════════ */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-niqo-coral" strokeWidth={2.4} />
          <h2 className="font-display text-xl font-bold text-niqo-black">
            Liquidité — {countryLabel(country)}
          </h2>
        </div>

        {/* Tier 0 — 2 héros (MAU + Vues→Contact) */}
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <KpiCard
            tier="hero"
            label="MAU (Audience active 30j)"
            value={demand_engagement.mau.toLocaleString("fr-FR")}
            Icon={Users}
            hint={`DAU ${demand_engagement.dau} · WAU ${demand_engagement.wau}`}
          />
          <KpiCard
            tier="hero"
            label="Vues → contact"
            value={
              demand_engagement.vues_to_contact_pct == null
                ? "—"
                : `${demand_engagement.vues_to_contact_pct}`
            }
            unit="%"
            Icon={MessageSquare}
            hint={`${demand_engagement.conversations_initiated_period.toLocaleString("fr-FR")} conv. · ${demand_engagement.vues_total_period.toLocaleString("fr-FR")} vues`}
          />
        </div>

        {/* Tier 1 — Supply Health (4 normales) */}
        <h3 className="mb-3 text-xs font-mono uppercase tracking-widest text-niqo-gray-500">
          Supply Health (offre vendeurs)
        </h3>
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label={`Annonces nouvelles (${periodShort})`}
            value={supply_health.annonces_nouvelles_period.toLocaleString("fr-FR")}
            Icon={Building2}
            hint="période sélectionnée"
          />
          <KpiCard
            label="Annonces actives"
            value={supply_health.annonces_actives_total.toLocaleString("fr-FR")}
            Icon={Store}
            hint="snapshot état présent"
          />
          <KpiCard
            label="Contacts / annonce"
            value={
              supply_health.contacts_per_annonce_avg == null
                ? "—"
                : supply_health.contacts_per_annonce_avg.toLocaleString("fr-FR", {
                    maximumFractionDigits: 2,
                  })
            }
            Icon={MessageSquare}
            hint="moy. sur nouvelles annonces"
          />
          <KpiCard
            label="Time-to-1er-contact"
            value={
              supply_health.time_to_first_contact_p50_hrs == null
                ? "—"
                : `${supply_health.time_to_first_contact_p50_hrs}h`
            }
            Icon={TrendingUp}
            hint="médiane P50"
          />
        </div>

        {/* Tier 2 — Compact inline */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-niqo-gray-100 bg-niqo-gray-50 px-4 py-3">
          <KpiCard
            tier="compact"
            label="Expirées"
            value={supply_health.annonces_expirees_period.toLocaleString("fr-FR")}
            Icon={ArrowDownToLine}
            hint=""
          />
          <KpiCard
            tier="compact"
            label="Vues totales"
            value={demand_engagement.vues_total_period.toLocaleString("fr-FR")}
            Icon={Eye}
            hint=""
          />
          <KpiCard
            tier="compact"
            label="Conv. initiées"
            value={demand_engagement.conversations_initiated_period.toLocaleString("fr-FR")}
            Icon={MessageSquare}
            hint=""
          />
        </div>
      </section>

      {/* ═════ Panel 2 — ACTIVATION ════════════════════════════════════════ */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-niqo-coral" strokeWidth={2.4} />
          <h2 className="font-display text-xl font-bold text-niqo-black">
            Activation & Confiance — {countryLabel(country)}
          </h2>
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-12">
          {/* Hero Signups */}
          <div className="rounded-xl border border-niqo-coral/30 bg-niqo-coral-light/40 p-6 lg:col-span-4">
            <p className="mb-3 text-xs font-mono uppercase tracking-widest text-niqo-gray-500">
              Inscriptions ({periodShort})
            </p>
            <p className="font-mono text-5xl font-semibold tabular-nums text-niqo-coral">
              {signups.total_period.toLocaleString("fr-FR")}
            </p>
            <div className="mt-2 flex items-baseline gap-2 text-sm">
              <span
                className={
                  signupsDanger
                    ? "font-semibold text-niqo-danger"
                    : signups.delta_pct_vs_prev_period > 0
                      ? "font-semibold text-niqo-success"
                      : "text-niqo-gray-500"
                }
              >
                {signups.delta_pct_vs_prev_period > 0 ? "+" : ""}
                {signups.delta_pct_vs_prev_period}%
              </span>
              <span className="text-xs text-niqo-gray-500">
                vs période précédente ({signups.total_prev_period})
              </span>
            </div>
          </div>

          {/* Funnel */}
          <div className="rounded-xl border border-niqo-gray-200 bg-white p-5 lg:col-span-8">
            <p className="mb-4 font-display font-semibold text-niqo-black">
              Funnel d'activation{" "}
              <span className="text-xs font-normal text-niqo-gray-500">
                (cohorte = inscrits {periodShort})
              </span>
            </p>
            <FunnelBar
              steps={[
                {
                  label: "Inscrits",
                  value: activation_funnel.signed_up,
                  pct: 100,
                },
                {
                  label: "Publié 1ère annonce",
                  value: activation_funnel.published_first_annonce,
                  pct: activation_funnel.signup_to_publish_pct,
                },
                {
                  label: "Proposé 1er RDV",
                  value: activation_funnel.proposed_first_rdv,
                  pct: activation_funnel.publish_to_rdv_pct,
                },
                {
                  label: "Laissé 1 avis",
                  value: activation_funnel.completed_first_rdv,
                  pct: activation_funnel.rdv_to_avis_pct,
                },
              ]}
            />
          </div>
        </div>

        {/* Trust Quality */}
        <h3 className="mb-3 text-xs font-mono uppercase tracking-widest text-niqo-gray-500">
          Trust Quality (alltime)
        </h3>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Total users"
            value={trust_quality.total_users.toLocaleString("fr-FR")}
            Icon={Users}
            hint="snapshot alltime"
          />
          <KpiCard
            label="Vérifiés (KYC)"
            value={`${trust_quality.verified}`}
            Icon={ShieldCheck}
            hint={`${trust_quality.verified_pct ?? 0}% des users`}
          />
          <KpiCard
            label="Vendeurs Fiables"
            value={`${trust_quality.vendeur_fiable}`}
            Icon={CheckCircle2}
            tone="coral"
            hint={`${trust_quality.vendeur_fiable_pct ?? 0}% (≥5 ventes & ≥4★)`}
          />
          <KpiCard
            label="Suspensions"
            value={`${trust_quality.suspended_auto_score} / ${trust_quality.suspended_admin_manual}`}
            Icon={Users}
            hint="auto / admin"
            danger={suspendedDanger}
          />
        </div>
      </section>

      {/* ═════ Panel 3 — REVENUE ═══════════════════════════════════════════ */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Coins className="h-4 w-4 text-niqo-coral" strokeWidth={2.4} />
          <h2 className="font-display text-xl font-bold text-niqo-black">
            Revenue — {countryLabel(country)}
          </h2>
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-12">
          {/* Hero Revenus période */}
          <div className="rounded-xl border border-niqo-coral/30 bg-niqo-coral-light/40 p-6 lg:col-span-5">
            <p className="mb-3 text-xs font-mono uppercase tracking-widest text-niqo-gray-500">
              Revenus ({periodShort})
            </p>
            <p className="mb-2 font-mono text-5xl font-semibold tabular-nums text-niqo-coral">
              {rev.total_eur_period.toLocaleString("fr-FR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              €
            </p>
            <p className="mb-4 text-xs text-niqo-gray-500">
              ≈ {rev.total_fcfa_period.toLocaleString("fr-FR")}{" "}
              {country === "CI" ? "XOF" : country === "CG" ? "XAF" : "FCFA combiné"}
            </p>
            {country === "ALL" && (
              <div className="space-y-2 border-t border-niqo-coral/20 pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-niqo-gray-500">🇨🇮 XOF (CI)</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {rev.total_xof_period.toLocaleString("fr-FR")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-niqo-gray-500">🇨🇬 XAF (CG)</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {rev.total_xaf_period.toLocaleString("fr-FR")}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ARPU */}
          <div className="rounded-xl border border-niqo-gray-200 bg-white p-5 lg:col-span-3">
            <p className="mb-3 text-xs font-mono uppercase tracking-widest text-niqo-gray-500">
              ARPU
            </p>
            <div className="space-y-3">
              <div>
                <p className="font-mono text-3xl font-semibold tabular-nums text-niqo-black">
                  {(arpu.eur_alltime ?? 0).toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  <span className="text-xs text-niqo-gray-500">€</span>
                </p>
                <p className="text-xs text-niqo-gray-500">alltime</p>
              </div>
              <div className="border-t border-niqo-gray-100 pt-3">
                <p className="font-mono text-xl font-semibold tabular-nums text-niqo-coral">
                  {(arpu.eur_period ?? 0).toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  <span className="text-xs text-niqo-gray-500">€</span>
                </p>
                <p className="text-xs text-niqo-gray-500">{periodShort}</p>
              </div>
            </div>
          </div>

          {/* Breakdown */}
          <div className="rounded-xl border border-niqo-gray-200 bg-white p-5 lg:col-span-4">
            <p className="mb-3 text-xs font-mono uppercase tracking-widest text-niqo-gray-500">
              Breakdown ({periodShort})
            </p>
            <div className="space-y-3">
              <BreakdownRow
                label="Vérifications"
                count={rev.verifications.count}
                fcfa={rev.verifications.total_fcfa}
              />
              <BreakdownRow
                label="Boost 7 jours"
                count={rev.boosts_7j.count}
                fcfa={rev.boosts_7j.total_fcfa}
              />
              <BreakdownRow
                label="Boost 30 jours"
                count={rev.boosts_30j.count}
                fcfa={rev.boosts_30j.total_fcfa}
              />
            </div>
          </div>
        </div>

        {/* Sparkline 12 mois */}
        <div className="rounded-xl border border-niqo-gray-200 bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="font-display font-semibold text-niqo-black">
              Évolution 12 derniers mois{" "}
              <span className="text-xs font-normal text-niqo-gray-500">
                ({countryLabel(country)})
              </span>
            </p>
            <p className="font-mono text-xs text-niqo-gray-500">
              Alltime ·{" "}
              <span className="font-semibold text-niqo-black">
                {alltime.total_eur.toLocaleString("fr-FR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                €
              </span>
            </p>
          </div>
          <RevenueAreaChart data={rev.monthly_history} height={140} />
        </div>
      </section>

      {/* ═════ Exports & Comptabilité ══════════════════════════════════════ */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <ArrowUpToLine className="h-4 w-4 text-niqo-coral" strokeWidth={2.4} />
          <h2 className="font-display text-xl font-bold text-niqo-black">
            Exports & Comptabilité
          </h2>
        </div>

        {/* Group 1 — Business Intelligence */}
        <div className="mb-4 rounded-xl border border-niqo-gray-200 bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="font-display font-semibold text-niqo-black">
              Business Intelligence
            </p>
            <p className="text-[10px] text-niqo-gray-500">
              Téléphones hashés SHA256 (RGPD) · limite 5MB / export
            </p>
          </div>
          <ExportButtons
            from={from}
            to={to}
            pays={paysRpc}
            only={["users", "annonces", "rdv", "avis", "signalements"]}
          />
        </div>

        {/* Group 2 — Comptabilité */}
        <div className="mb-4 rounded-xl border border-niqo-coral/30 bg-niqo-coral-light/20 p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-niqo-coral" strokeWidth={2.4} />
            <p className="font-display font-semibold text-niqo-black">
              Comptabilité
            </p>
          </div>
          <p className="mb-4 text-xs text-niqo-gray-500">
            Filtres = période + pays sélectionnés. Le PDF inclut en-tête Niqo Ltd
            + N° RDB + ventilation XOF/XAF.
          </p>
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <ExportButtons from={from} to={to} pays={paysRpc} only={["paiements"]} />
            </div>
            <div className="lg:col-span-5">
              <GeneratePdfButton from={from} to={to} pays={paysRpc} />
            </div>
          </div>
        </div>

        {/* Historique PDFs */}
        <div className="rounded-xl border border-niqo-gray-200 bg-white p-5">
          <p className="mb-3 font-display font-semibold text-niqo-black">
            Historique des rapports générés
          </p>
          <ComptaReportsList reports={reports} />
        </div>
      </section>

      <footer className="border-t border-niqo-gray-200 pt-6 text-xs text-niqo-gray-500">
        <p>
          Source : RPCs{" "}
          <code className="rounded bg-niqo-gray-100 px-1.5 py-0.5 font-mono">
            admin_kpis_alerts
          </code>
          {", "}
          <code className="rounded bg-niqo-gray-100 px-1.5 py-0.5 font-mono">
            admin_kpis_liquidity
          </code>
          {", "}
          <code className="rounded bg-niqo-gray-100 px-1.5 py-0.5 font-mono">
            admin_kpis_activation
          </code>
          {", "}
          <code className="rounded bg-niqo-gray-100 px-1.5 py-0.5 font-mono">
            admin_kpis_revenue
          </code>
          {" · "}fenêtre{" "}
          {formatParisDateShort(liquidity.window_from)} →{" "}
          {formatParisDateShort(liquidity.window_to)}
          {" · "}pays {liquidity.pays}
        </p>
      </footer>
    </div>
  );
}

// ── Sous-composants ───────────────────────────────────────────────────────

function FunnelBar({
  steps,
}: {
  steps: Array<{ label: string; value: number; pct: number | null }>;
}) {
  const max = steps[0]?.value ?? 1;
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const width = max > 0 ? (s.value / max) * 100 : 0;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-44 shrink-0 text-xs text-niqo-gray-500">{s.label}</span>
            <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-niqo-gray-100">
              <div
                className={`h-full rounded-md ${i === 0 ? "bg-niqo-black" : "bg-niqo-coral"}`}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="flex w-28 items-baseline justify-end gap-1.5">
              <span className="font-mono text-sm font-semibold tabular-nums text-niqo-black">
                {s.value}
              </span>
              {i > 0 && s.pct != null ? (
                <span className="font-mono text-xs tabular-nums text-niqo-gray-500">
                  ({s.pct}%)
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownRow({
  label,
  count,
  fcfa,
}: {
  label: string;
  count: number;
  fcfa: number;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-niqo-gray-500">
        {label}{" "}
        <span className="font-mono text-xs">×{count}</span>
      </span>
      <span className="font-mono font-semibold tabular-nums text-niqo-black">
        {fcfa.toLocaleString("fr-FR")}{" "}
        <span className="text-xs font-normal text-niqo-gray-500">FCFA</span>
      </span>
    </div>
  );
}
