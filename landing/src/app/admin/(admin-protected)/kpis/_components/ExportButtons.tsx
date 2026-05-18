"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type DatasetKey = "users" | "annonces" | "paiements" | "rdv" | "avis" | "signalements";

interface Dataset {
  value: DatasetKey;
  label: string;
  hint: string;
}

const ALL_DATASETS: Dataset[] = [
  { value: "users", label: "Users", hint: "Inscrits (tél hash SHA256)" },
  { value: "annonces", label: "Annonces", hint: "Toutes annonces" },
  { value: "paiements", label: "Paiements", hint: "Completed only" },
  { value: "rdv", label: "RDV", hint: "Conversations avec RDV" },
  { value: "avis", label: "Avis", hint: "Notations post-RDV" },
  { value: "signalements", label: "Signalements", hint: "Reports + résolution" },
];

interface ExportButtonsProps {
  from: Date | null;
  to: Date | null;
  pays: "CI" | "CG" | null;
  /** Filtre les datasets à afficher (par défaut : tous) */
  only?: DatasetKey[];
}

/**
 * Boutons CSV. Sur click, appelle la RPC `admin_export_dataset` puis
 * déclenche un download client-side via Blob URL.
 *
 * Filtre window + pays viennent des props. Si `EXPORT_TOO_LARGE` : affiche
 * un message d'erreur user-visible.
 *
 * `only` permet de splitter en groupes thématiques (cf. audit UX 2026-05-11 —
 * BI vs Comptabilité).
 */
export function ExportButtons({ from, to, pays, only }: ExportButtonsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const datasets = only
    ? ALL_DATASETS.filter((d) => only.includes(d.value))
    : ALL_DATASETS;

  async function download(dataset: DatasetKey) {
    setBusy(dataset);
    setErr(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_export_dataset", {
        p_dataset: dataset,
        p_from: from ? from.toISOString() : null,
        p_to: to ? to.toISOString() : null,
        p_pays: pays,
      });
      if (error) {
        if (error.message?.includes("EXPORT_TOO_LARGE")) {
          setErr("Export trop volumineux (>5MB). Réduis la période ou filtre par pays.");
        } else {
          setErr(`Erreur : ${error.message ?? "inconnue"}`);
        }
        return;
      }
      if (typeof data !== "string") {
        setErr("Réponse inattendue (CSV vide).");
        return;
      }

      const ts = new Date().toISOString().slice(0, 10);
      const paysLabel = pays ?? "all";
      const filename = `niqo_${dataset}_${ts}_${paysLabel}.csv`;

      // BOM UTF-8 pour Excel Windows
      const blob = new Blob(["﻿" + data], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {datasets.map((d) => (
          <button
            key={d.value}
            type="button"
            disabled={busy !== null}
            onClick={() => download(d.value)}
            className="flex items-center gap-2 rounded-lg border border-niqo-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-niqo-coral hover:bg-niqo-coral-light/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === d.value ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-niqo-coral" />
            ) : (
              <Download className="h-4 w-4 shrink-0 text-niqo-gray-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-niqo-black">{d.label}</p>
              <p className="truncate text-[10px] text-niqo-gray-500">{d.hint}</p>
            </div>
          </button>
        ))}
      </div>

      {err ? (
        <p className="rounded-md border border-niqo-danger/30 bg-niqo-danger/10 px-3 py-2 text-xs text-niqo-danger">
          {err}
        </p>
      ) : null}
    </div>
  );
}
