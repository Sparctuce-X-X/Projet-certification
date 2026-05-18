"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type TargetFilter = "all" | "verification" | "signalement" | "annonce" | "user" | "message";

interface AuditFiltersProps {
  counts: {
    all: number;
    verification: number;
    signalement: number;
    annonce: number;
    user: number;
    message: number;
  };
}

const TARGET_CHIPS: { value: TargetFilter; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "verification", label: "KYC" },
  { value: "signalement", label: "Signalements" },
  { value: "annonce", label: "Annonces" },
  { value: "user", label: "Users" },
  { value: "message", label: "Messages" },
];

/**
 * Filtres par target_type pour la liste audit.
 * Sync URL (?target=verification). Reset page=1 au changement de filtre.
 */
export function AuditFilters({ counts }: AuditFiltersProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTarget =
    (searchParams.get("target") as TargetFilter | null) ?? "all";

  const buildHref = (value: TargetFilter) => {
    const params = new URLSearchParams();
    if (value !== "all") params.set("target", value);
    // Reset pagination au changement de filtre (sinon page=4 d'un filtre
    // peut ne plus exister sur l'autre).
    return `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  };

  return (
    <div className="flex gap-2 flex-wrap mb-5">
      {TARGET_CHIPS.map((chip) => {
        const active = currentTarget === chip.value;
        const count = counts[chip.value];
        return (
          <Link
            key={chip.value}
            href={buildHref(chip.value)}
            className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-sm font-medium transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2 ${
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
  );
}
