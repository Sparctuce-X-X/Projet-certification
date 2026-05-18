"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface MonthDatum {
  month: string;
  total_fcfa: number;
  xof_fcfa: number;
  xaf_fcfa: number;
  eur: number;
}

interface RevenueAreaChartProps {
  data: MonthDatum[];
  height?: number;
}

function fmtFcfa(n: number): string {
  return n.toLocaleString("fr-FR");
}

function fmtEur(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortMonth(yyyymm: string): string {
  const [, mm] = yyyymm.split("-");
  if (!mm) return yyyymm;
  const idx = parseInt(mm, 10) - 1;
  return ["Jan", "Fev", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"][idx] ?? mm;
}

interface TooltipPayload {
  active?: boolean;
  payload?: Array<{ payload: MonthDatum }>;
}

function CustomTooltip({ active, payload }: TooltipPayload) {
  if (!active || !payload?.[0]?.payload) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-niqo-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-semibold text-niqo-black">{d.month}</p>
      <p className="font-mono text-xs tabular-nums text-niqo-coral">
        {fmtEur(d.eur)} €
      </p>
      <p className="font-mono text-[10px] tabular-nums text-niqo-gray-500">
        XOF {fmtFcfa(d.xof_fcfa)} · XAF {fmtFcfa(d.xaf_fcfa)}
      </p>
    </div>
  );
}

/**
 * Sparkline-style chart pour les revenus mensuels 12 derniers mois.
 * Remplace la liste de 12 barres horizontales (audit UX 2026-05-11 — densité
 * info insuffisante quand 0-3 paiements/mois en pré-launch).
 */
export function RevenueAreaChart({ data, height = 120 }: RevenueAreaChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    monthShort: shortMonth(d.month),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-niqo-coral)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--color-niqo-coral)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="monthShort"
          tick={{ fontSize: 10, fill: "var(--color-niqo-gray-500)" }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis hide />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--color-niqo-gray-200)", strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="eur"
          stroke="var(--color-niqo-coral)"
          strokeWidth={2}
          fill="url(#revenueGradient)"
          dot={{ r: 2, fill: "var(--color-niqo-coral)", strokeWidth: 0 }}
          activeDot={{ r: 4, fill: "var(--color-niqo-coral)", strokeWidth: 2, stroke: "white" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
