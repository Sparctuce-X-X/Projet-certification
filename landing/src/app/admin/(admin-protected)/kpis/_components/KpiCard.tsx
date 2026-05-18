import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  Icon: LucideIcon;
  delta?: { pct: number; label: string } | null;
  hint?: string;
  tone?: "neutral" | "coral";
  /**
   * Tier visuel — détermine taille + emphasis (cf. audit UX 2026-05-11) :
   * - "hero" (T0)    : KPIs critiques surveillés en daily, gros bg coral-light
   * - "normal" (T1)  : KPIs de référence, taille standard, bg blanc
   * - "compact" (T2) : KPIs secondaires, layout horizontal inline 1 ligne
   */
  tier?: "hero" | "normal" | "compact";
  /** Force la valeur en sémantique danger (ex: suspensions > 0) */
  danger?: boolean;
}

export function KpiCard({
  label,
  value,
  unit,
  Icon,
  delta,
  hint,
  tone = "neutral",
  tier = "normal",
  danger = false,
}: KpiCardProps) {
  const isCoral = tone === "coral";
  const isHero = tier === "hero";
  const TrendIcon =
    delta == null ? Minus : delta.pct > 0 ? TrendingUp : delta.pct < 0 ? TrendingDown : Minus;
  const trendColor =
    delta == null
      ? "text-niqo-gray-500"
      : delta.pct > 0
        ? "text-niqo-success"
        : delta.pct < 0
          ? "text-niqo-danger"
          : "text-niqo-gray-500";

  // ── Tier 2 : compact inline (1 ligne, plusieurs KPIs en row) ──────────────
  if (tier === "compact") {
    return (
      <div className="flex items-baseline gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-niqo-gray-500" strokeWidth={2.2} />
        <span className="text-xs uppercase tracking-wider text-niqo-gray-500">
          {label}
        </span>
        <span className={`font-mono font-semibold tabular-nums ${danger ? "text-niqo-danger" : "text-niqo-black"}`}>
          {value}
        </span>
        {unit ? <span className="text-xs text-niqo-gray-500">{unit}</span> : null}
      </div>
    );
  }

  // ── Tier 0 (hero) ou Tier 1 (normal) ──────────────────────────────────────
  const wrapperCls = isHero
    ? "rounded-xl border border-niqo-coral/30 bg-niqo-coral-light/40 p-6"
    : isCoral
      ? "rounded-xl border border-niqo-coral/30 bg-niqo-coral-light/30 p-5"
      : "rounded-xl border border-niqo-gray-200 bg-white p-5 transition-colors duration-150 hover:border-niqo-gray-300";

  const valueCls = isHero
    ? "font-mono font-semibold tracking-tight tabular-nums text-niqo-coral text-5xl"
    : isCoral
      ? "font-mono font-semibold tracking-tight tabular-nums text-niqo-coral text-4xl"
      : `font-mono font-semibold tracking-tight tabular-nums text-3xl ${danger ? "text-niqo-danger" : "text-niqo-black"}`;

  return (
    <div className={`relative ${wrapperCls}`}>
      <div className="mb-3 flex items-start justify-between">
        <span className="text-xs font-mono uppercase tracking-widest text-niqo-gray-500">
          {label}
        </span>
        <Icon
          className={`h-4 w-4 ${isCoral || isHero ? "text-niqo-coral" : "text-niqo-gray-500"}`}
          strokeWidth={2.2}
        />
      </div>

      <div className="mb-2 flex items-baseline gap-1.5">
        <span className={valueCls}>{value}</span>
        {unit ? (
          <span className={`font-medium text-niqo-gray-500 ${isHero ? "text-base" : "text-sm"}`}>
            {unit}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        {delta != null ? (
          <div className="flex items-center gap-1">
            <TrendIcon className={`h-3.5 w-3.5 ${trendColor}`} strokeWidth={2.6} />
            <span className={`text-xs font-medium ${trendColor}`}>
              {delta.pct > 0 ? "+" : ""}
              {delta.pct}%
            </span>
            <span className="text-xs text-niqo-gray-500">{delta.label}</span>
          </div>
        ) : (
          <span className="text-xs text-niqo-gray-500">{hint ?? ""}</span>
        )}
      </div>
    </div>
  );
}
