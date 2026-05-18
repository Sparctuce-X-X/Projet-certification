"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { ComptaReport } from "@/lib/admin/kpis";
import { formatParisDateShort } from "@/lib/date-format";

interface ComptaReportsListProps {
  reports: ComptaReport[];
}

function fmtDate(iso: string): string {
  return formatParisDateShort(iso);
}

function fmtMoney(n: number): string {
  return n.toLocaleString("fr-FR");
}

/**
 * Liste historique des PDFs comptables générés. Bouton "Télécharger" génère
 * une signed URL à la demande (24h TTL) — pas d'URL stockée en clair.
 *
 * Cf. audit UX 2026-05-11 — 9 → 7 colonnes (drop Taille, merge XOF/XAF en
 * "Devises XOF / XAF").
 */
export function ComptaReportsList({ reports }: ComptaReportsListProps) {
  const [busy, setBusy] = useState<string | null>(null);

  async function download(report: ComptaReport) {
    setBusy(report.id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("compta-reports")
        .createSignedUrl(report.storage_path, 60 * 60); // 1h
      if (error || !data?.signedUrl) {
        alert(`Erreur signed URL : ${error?.message ?? "inconnue"}`);
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(null);
    }
  }

  if (reports.length === 0) {
    return (
      <p className="text-sm text-niqo-gray-500 italic">
        Aucun rapport généré pour l'instant. Clique "Générer PDF compta maintenant"
        ci-dessus.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-niqo-gray-200 text-xs font-mono uppercase tracking-widest text-niqo-gray-500">
            <th className="py-2 pr-3 text-left">Période</th>
            <th className="py-2 pr-3 text-left">Pays</th>
            <th className="py-2 pr-3 text-right">Paiements</th>
            <th className="py-2 pr-3 text-right">Devises (XOF / XAF)</th>
            <th className="py-2 pr-3 text-right">Total FCFA</th>
            <th className="py-2 pr-3 text-left">Généré</th>
            <th className="py-2 pl-3 text-right">—</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr
              key={r.id}
              className="border-b border-niqo-gray-100 hover:bg-niqo-gray-50"
            >
              <td className="py-2.5 pr-3 text-niqo-black">
                {fmtDate(r.periode_debut)} → {fmtDate(r.periode_fin)}
              </td>
              <td className="py-2.5 pr-3 font-mono text-xs text-niqo-gray-500">
                {r.pays}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                {r.nb_paiements}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-xs tabular-nums text-niqo-gray-500">
                {fmtMoney(r.total_xof)} / {fmtMoney(r.total_xaf)}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums">
                {fmtMoney(r.total_fcfa)}
              </td>
              <td className="py-2.5 pr-3 text-xs text-niqo-gray-500">
                {fmtDate(r.generated_at)}
              </td>
              <td className="py-2.5 pl-3 text-right">
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() => download(r)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-niqo-coral hover:underline disabled:opacity-50"
                >
                  {busy === r.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FileDown className="h-3 w-3" />
                  )}
                  PDF
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
