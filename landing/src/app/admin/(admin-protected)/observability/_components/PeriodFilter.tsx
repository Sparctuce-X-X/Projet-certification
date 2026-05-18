"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { type WindowKey, WINDOW_LABELS } from "@/lib/admin/observability";

const OPTIONS: WindowKey[] = ["24h", "7d", "30d"];

export function PeriodFilter({ current }: { current: WindowKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const handleSelect = (next: WindowKey) => {
    if (next === current || pending) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("window", next);
    startTransition(() => {
      router.push(`/admin/observability?${params.toString()}`);
    });
  };

  return (
    <div
      className="inline-flex items-center gap-1 bg-niqo-gray-100 rounded-lg p-1"
      role="tablist"
      aria-label="Période d'observation"
    >
      {OPTIONS.map((key) => {
        const isActive = key === current;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={pending}
            onClick={() => handleSelect(key)}
            className={`
              px-3 py-1.5 text-xs font-medium rounded-md transition-colors
              ${isActive
                ? "bg-white text-niqo-black shadow-sm"
                : "text-niqo-gray-600 hover:text-niqo-black"}
              ${pending ? "opacity-50 cursor-wait" : "cursor-pointer"}
            `}
          >
            {WINDOW_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
