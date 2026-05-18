"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Globe } from "lucide-react";

import type { CountrySelection } from "@/lib/admin/kpis";

interface CountrySelectorProps {
  current: CountrySelection;
}

// Note : on garde les drapeaux nationaux 🇨🇮 🇨🇬 (exception ISO 3166 acceptée
// par CLAUDE.md). Pour "ALL", l'icône Lucide <Globe> dans le wrapper sert
// d'indicateur visuel — pas d'emoji parasitique.
const OPTIONS: Array<{ value: CountrySelection; label: string; flag: string | null }> = [
  { value: "ALL", label: "Tous", flag: null },
  { value: "CI", label: "Côte d'Ivoire", flag: "🇨🇮" },
  { value: "CG", label: "Congo", flag: "🇨🇬" },
];

/**
 * Filtre pays — switche le search param `?pays=CI|CG|ALL`. Tous les panels
 * du dashboard se re-render avec la nouvelle valeur.
 *
 * `ALL` = agrégat CI + CG (mais en MVP on regarde principalement les pays
 * séparés — voir office-hours doc Premise 1).
 */
export function CountrySelector({ current }: CountrySelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setCountry(c: CountrySelection) {
    const params = new URLSearchParams(searchParams.toString());
    if (c === "ALL") params.delete("pays");
    else params.set("pays", c);
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="inline-flex items-center bg-white border border-niqo-gray-200 rounded-lg p-1 gap-1">
      <Globe
        className="w-3.5 h-3.5 text-niqo-gray-500 ml-2"
        strokeWidth={2.2}
      />
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={pending}
          onClick={() => setCountry(opt.value)}
          className={
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 " +
            (current === opt.value
              ? "bg-niqo-black text-white"
              : "text-niqo-gray-500 hover:text-niqo-black hover:bg-niqo-gray-50")
          }
        >
          {opt.flag ? <span className="mr-1.5">{opt.flag}</span> : null}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
