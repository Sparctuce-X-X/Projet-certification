"use client";

import { Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type FilterValue = "all" | "pending" | "verified" | "rejected";

interface VerifFiltersProps {
  counts: { all: number; pending: number; verified: number; rejected: number };
}

const CHIPS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "pending", label: "En attente" },
  { value: "verified", label: "Validé" },
  { value: "rejected", label: "Refusé" },
];

/**
 * Filtres + recherche pour la liste verifications.
 *
 * Synchronise avec l'URL (?filter=pending&q=aicha) — partageable, browser
 * back/forward fonctionnel. Debounce 300ms sur la search pour éviter de
 * spammer le server à chaque frappe.
 */
export function VerifFilters({ counts }: VerifFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // V5 audit : capture isPending pour le spinner trailing pendant le RSC
  // refetch (cohérent avec /admin/signalements S5).
  const [isPending, startTransition] = useTransition();

  const currentFilter =
    (searchParams.get("filter") as FilterValue | null) ?? "pending";
  const currentQuery = searchParams.get("q") ?? "";
  const [queryInput, setQueryInput] = useState(currentQuery);

  // Debounce pour le search input
  useEffect(() => {
    const t = setTimeout(() => {
      if (queryInput === currentQuery) return;
      const params = new URLSearchParams(searchParams.toString());
      if (queryInput) params.set("q", queryInput);
      else params.delete("q");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  const buildHref = (value: FilterValue) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "pending") params.delete("filter");
    else params.set("filter", value);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
      {/* Chips */}
      <div className="flex gap-2 flex-wrap">
        {CHIPS.map((chip) => {
          const active = currentFilter === chip.value;
          const count = counts[chip.value];
          return (
            <Link
              key={chip.value}
              href={buildHref(chip.value)}
              className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-sm font-medium transition-colors duration-150 cursor-pointer ${
                active
                  ? "bg-niqo-coral text-white border-niqo-coral"
                  : "bg-white text-niqo-gray-800 border-niqo-gray-200 hover:bg-niqo-gray-50"
              }`}
            >
              <span>{chip.label}</span>
              <span
                className={`text-xs font-mono ${
                  active ? "text-white/80" : "text-niqo-gray-500"
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Search */}
      <div className="sm:ml-auto relative w-full sm:w-72">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-niqo-gray-500"
          strokeWidth={2.2}
        />
        <input
          type="search"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Rechercher par nom, ville..."
          className="w-full h-10 pl-9 pr-9 bg-white border border-niqo-gray-200 rounded-lg text-sm text-niqo-black focus:outline-none focus:ring-2 focus:ring-niqo-coral focus:border-transparent transition-colors"
        />
        {/* V5 audit : spinner pendant débounce + RSC fetch, priorité sur le
            clear button (durée ~quelques centaines de ms max). */}
        {isPending ? (
          <Loader2
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-niqo-coral animate-spin"
            aria-label="Recherche en cours"
          />
        ) : queryInput ? (
          <button
            type="button"
            onClick={() => setQueryInput("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-niqo-gray-100 flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral"
            aria-label="Effacer la recherche"
          >
            <X className="w-3.5 h-3.5 text-niqo-gray-500" strokeWidth={2.2} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
