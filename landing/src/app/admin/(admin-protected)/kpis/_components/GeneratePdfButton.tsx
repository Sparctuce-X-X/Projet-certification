"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FileText, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

interface GeneratePdfButtonProps {
  from: Date | null;
  to: Date | null;
  pays: "CI" | "CG" | null;
}

/**
 * Bouton "Generate PDF compta now" — invoke l'Edge Function `generate-compta-pdf`
 * avec les filtres en cours. Sur succès, rafraîchit la liste (router.refresh)
 * et propose un download immédiat via signed URL.
 *
 * V1 manuel (cf. mig 115 §Choix conscient). Pas de Resend, pas de cron.
 */
export function GeneratePdfButton({ from, to, pays }: GeneratePdfButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  async function generate() {
    if (!from || !to) {
      setErr("Sélectionne une période bornée (pas 'Depuis le début').");
      return;
    }
    setBusy(true);
    setErr(null);
    setLastUrl(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke(
        "generate-compta-pdf",
        {
          body: {
            periode_debut: from.toISOString(),
            periode_fin: to.toISOString(),
            pays,
          },
        },
      );
      if (error) {
        setErr(`Erreur Edge : ${error.message ?? "inconnue"}`);
        return;
      }
      const result = data as { signed_url?: string | null } | null;
      if (result?.signed_url) {
        setLastUrl(result.signed_url);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setErr(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy || pending}
        onClick={generate}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-niqo-coral hover:bg-niqo-coral-dark text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FileText className="w-4 h-4" />
        )}
        Générer PDF compta maintenant
      </button>

      {lastUrl ? (
        <p className="text-xs">
          <a
            href={lastUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-niqo-coral hover:underline font-medium"
          >
            ↓ Télécharger le PDF généré
          </a>
        </p>
      ) : null}

      {err ? (
        <p className="text-xs text-niqo-danger bg-niqo-danger/10 border border-niqo-danger/30 rounded-md px-3 py-2">
          {err}
        </p>
      ) : null}
    </div>
  );
}
