"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import {
  type PeriodSelection,
  selectionToUrl,
} from "@/lib/admin/kpis";

interface PeriodFilterProps {
  current: PeriodSelection;
  /** Année min disponible dans la liste (typiquement 2024 pour Niqo) */
  minYear?: number;
  /** Année max — par défaut année actuelle */
  maxYear?: number;
}

const PRESETS: Array<{ value: "30d" | "90d" | "12m" | "all"; label: string }> = [
  { value: "30d", label: "30j" },
  { value: "90d", label: "90j" },
  { value: "12m", label: "12 mois" },
  { value: "all", label: "Tout" },
];

const MONTH_NAMES_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/**
 * Filtre période complet :
 *   - 4 chips presets (30j / 90j / 12 mois / Tout)
 *   - Select Mois (12 derniers mois)
 *   - Select Année
 *
 * Sélections mutuellement exclusives. URL search param `?period=...` :
 *   - "30d" / "90d" / "12m" / "all"
 *   - "month-2026-05"
 *   - "year-2026"
 */
export function PeriodFilter({
  current,
  minYear = 2024,
  maxYear = new Date().getFullYear(),
}: PeriodFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setPeriod(s: PeriodSelection) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", selectionToUrl(s));
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  }

  // Liste des 12 derniers mois (calculés à la volée)
  const now = new Date();
  const monthOptions: Array<{ year: number; month: number; label: string }> = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOptions.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${MONTH_NAMES_FR[d.getMonth()]} ${d.getFullYear()}`,
    });
  }

  const yearOptions: number[] = [];
  for (let y = maxYear; y >= minYear; y--) yearOptions.push(y);

  const isPreset = current.kind === "preset";
  const isMonth = current.kind === "month";
  const isYear = current.kind === "year";

  const monthValue = isMonth
    ? `${current.year}-${String(current.month).padStart(2, "0")}`
    : "";
  const yearValue = isYear ? String(current.year) : "";

  return (
    <div
      className={`flex flex-wrap items-center gap-2 transition-opacity ${
        pending ? "opacity-60 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Chips presets */}
      <div
        className="inline-flex items-center gap-0.5 bg-niqo-gray-100 p-1 rounded-lg"
        role="radiogroup"
        aria-label="Période préset"
      >
        {PRESETS.map(({ value, label }) => {
          const active = isPreset && current.value === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPeriod({ kind: "preset", value })}
              className={`px-3 h-7 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2 ${
                active
                  ? "bg-white text-niqo-black shadow-sm"
                  : "text-niqo-gray-500 hover:text-niqo-black"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Select Mois */}
      <select
        value={monthValue}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const [y, m] = v.split("-");
          if (y && m) {
            setPeriod({ kind: "month", year: parseInt(y, 10), month: parseInt(m, 10) });
          }
        }}
        className={`h-9 px-3 text-xs font-medium border rounded-lg cursor-pointer transition-colors duration-150 ${
          isMonth
            ? "bg-white border-niqo-coral text-niqo-coral"
            : "bg-white border-niqo-gray-200 text-niqo-gray-500 hover:border-niqo-gray-300"
        }`}
        aria-label="Sélectionner un mois"
      >
        <option value="" disabled>
          Mois ▾
        </option>
        {monthOptions.map((m) => (
          <option
            key={`${m.year}-${m.month}`}
            value={`${m.year}-${String(m.month).padStart(2, "0")}`}
          >
            {m.label}
          </option>
        ))}
      </select>

      {/* Select Année */}
      <select
        value={yearValue}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          setPeriod({ kind: "year", year: parseInt(v, 10) });
        }}
        className={`h-9 px-3 text-xs font-medium border rounded-lg cursor-pointer transition-colors duration-150 ${
          isYear
            ? "bg-white border-niqo-coral text-niqo-coral"
            : "bg-white border-niqo-gray-200 text-niqo-gray-500 hover:border-niqo-gray-300"
        }`}
        aria-label="Sélectionner une année"
      >
        <option value="" disabled>
          Année ▾
        </option>
        {yearOptions.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
