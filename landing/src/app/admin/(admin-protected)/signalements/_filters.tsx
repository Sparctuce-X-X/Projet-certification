"use client";

import { Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type StatutFilter = "all" | "en_attente" | "traite" | "rejete";
type CibleFilter = "all" | "annonce" | "utilisateur" | "message" | "rdv_post";

interface SignalementsFiltersProps {
  counts: {
    all: number;
    en_attente: number;
    traite: number;
    rejete: number;
  };
}

const STATUT_CHIPS: { value: StatutFilter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "en_attente", label: "En attente" },
  { value: "traite", label: "Traité" },
  { value: "rejete", label: "Rejeté" },
];

const CIBLE_CHIPS: { value: CibleFilter; label: string }[] = [
  { value: "all", label: "Toutes cibles" },
  { value: "annonce", label: "Annonces" },
  { value: "utilisateur", label: "Utilisateurs" },
  { value: "message", label: "Messages" },
  { value: "rdv_post", label: "RDV" },
];

/**
 * Filtres + recherche pour la liste signalements.
 * Synchronise avec l'URL (?filter=en_attente&cible=annonce&q=arnaque).
 */
export function SignalementsFilters({ counts }: SignalementsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // S5 audit : on capture `isPending` du transition pour afficher un spinner
  // trailing dans le champ search pendant que le RSC re-fetch (sinon le
  // débounce 300ms + le SSR donnent l'impression d'un input mort).
  const [isPending, startTransition] = useTransition();

  const currentStatut =
    (searchParams.get("filter") as StatutFilter | null) ?? "en_attente";
  const currentCible =
    (searchParams.get("cible") as CibleFilter | null) ?? "all";
  const currentQuery = searchParams.get("q") ?? "";
  const [queryInput, setQueryInput] = useState(currentQuery);

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

  const buildHref = (kind: "filter" | "cible", value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (kind === "filter") {
      if (value === "en_attente") params.delete("filter");
      else params.set("filter", value);
    } else {
      if (value === "all") params.delete("cible");
      else params.set("cible", value);
    }
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="space-y-3 mb-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Statut chips */}
        <div className="flex gap-2 flex-wrap">
          {STATUT_CHIPS.map((chip) => {
            const active = currentStatut === chip.value;
            const count = counts[chip.value];
            return (
              <Link
                key={chip.value}
                href={buildHref("filter", chip.value)}
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
            placeholder="Rechercher par motif, signaleur..."
            className="w-full h-10 pl-9 pr-9 bg-white border border-niqo-gray-200 rounded-lg text-sm text-niqo-black focus:outline-none focus:ring-2 focus:ring-niqo-coral focus:border-transparent transition-colors"
          />
          {/* S5 audit : spinner trailing pendant le débounce + RSC fetch.
              Priorité au spinner sur le bouton clear (visible que pendant
              isPending qui dure ~quelques centaines de ms max). */}
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

      {/* Cible chips (sous-filtre) */}
      <div className="flex gap-2 flex-wrap">
        {CIBLE_CHIPS.map((chip) => {
          const active = currentCible === chip.value;
          return (
            <Link
              key={chip.value}
              href={buildHref("cible", chip.value)}
              className={`inline-flex items-center h-7 px-2.5 rounded-md border text-xs font-medium transition-colors duration-150 cursor-pointer ${
                active
                  ? "bg-niqo-black text-white border-niqo-black"
                  : "bg-white text-niqo-gray-800 border-niqo-gray-200 hover:bg-niqo-gray-50"
              }`}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
