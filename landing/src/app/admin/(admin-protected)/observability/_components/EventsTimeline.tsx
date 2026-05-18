"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TimelineBucket } from "@/lib/admin/observability";

// Couleurs alignées sur la palette Niqo (cf tailwind.config.ts) :
//   info    → niqo-gray-400 (#9CA3AF) — flux normal
//   warning → amber-500    (#F59E0B) — signal métier suspect
//   error   → niqo-danger  (#E24B4A) — échec technique
const COLORS = {
  info: "#9CA3AF",
  warning: "#F59E0B",
  error: "#E24B4A",
};

export function EventsTimeline({
  data,
  windowLabel,
}: {
  data: TimelineBucket[];
  windowLabel: string;
}) {
  const hasData = data.some(
    (b) => b.info > 0 || b.warning > 0 || b.error > 0,
  );

  if (!hasData) {
    return (
      <div className="bg-white border border-niqo-gray-200 rounded-xl p-8 text-center">
        <p className="text-sm text-niqo-gray-500">
          Aucun event sur la fenêtre {windowLabel}.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-niqo-gray-200 rounded-xl p-5">
      <h2 className="font-display text-lg font-bold text-niqo-black mb-1">
        Répartition temporelle
      </h2>
      <p className="text-xs text-niqo-gray-500 mb-4">
        Stacked par severity, fenêtre {windowLabel}
      </p>
      <div className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 5, right: 5, bottom: 5, left: -10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#E5E7EB"
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#6B7280" }}
              axisLine={{ stroke: "#E5E7EB" }}
              tickLine={false}
              // Afficher au plus 12 labels — sinon overlap en 30d (30 buckets)
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6B7280" }}
              axisLine={{ stroke: "#E5E7EB" }}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#1A1A1A", fontWeight: 600 }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
              iconType="square"
            />
            <Bar
              dataKey="info"
              name="Info"
              stackId="a"
              fill={COLORS.info}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="warning"
              name="Warning"
              stackId="a"
              fill={COLORS.warning}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="error"
              name="Error"
              stackId="a"
              fill={COLORS.error}
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
