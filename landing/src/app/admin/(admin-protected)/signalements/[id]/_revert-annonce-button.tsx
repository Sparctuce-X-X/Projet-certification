"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";

import { revertAnnonceToActive } from "./actions";

interface RevertAnnonceButtonProps {
  annonceId: string;
  annonceTitre: string;
  signalementId: string;
}

/**
 * Bouton secondaire — remet une annonce de `en_cours` vers `active` après
 * signalement post-RDV non-fraude validé (mig 95).
 *
 * Visible uniquement quand :
 *   - target_type = 'rdv_post'
 *   - motif_categorie NOT IN ('tentative_fraude', 'complot_fraude')
 *   - signalement.statut = 'traite' (déjà décidé)
 *   - annonce.statut = 'en_cours' (re-fetch fresh state)
 *
 * Pattern inline confirm (cohérent avec ActionButtons).
 */
export function RevertAnnonceButton({
  annonceId,
  annonceTitre,
  signalementId,
}: RevertAnnonceButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await revertAnnonceToActive(annonceId, signalementId);
      if (result.error) {
        setError(result.error);
      } else {
        setDone(true);
        setConfirming(false);
      }
    });
  };

  if (done) {
    return (
      <div className="rounded-lg bg-niqo-success/5 border border-niqo-success/30 p-3">
        <p className="text-xs font-bold uppercase tracking-wider text-niqo-success mb-1">
          Annonce remise en vente
        </p>
        <p className="text-xs text-niqo-gray-800">
          Le vendeur reçoit une notification push.
        </p>
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 h-9 px-3 border border-niqo-coral/40 rounded-lg text-niqo-coral text-sm font-medium hover:bg-niqo-coral/5 transition-colors duration-150 cursor-pointer"
      >
        <RotateCcw className="w-4 h-4" strokeWidth={2.4} />
        Remettre l&apos;annonce en vente
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-niqo-coral/5 border border-niqo-coral/30 p-3.5">
        <p className="text-xs font-bold uppercase tracking-wider text-niqo-coral mb-2">
          Revert — impact
        </p>
        <ul className="space-y-1.5 text-xs text-niqo-gray-800 leading-relaxed">
          <li className="flex gap-1.5">
            <span className="text-niqo-coral shrink-0">•</span>
            <span>
              Statut <span className="font-mono">en_cours</span> →{" "}
              <span className="font-mono text-niqo-success font-medium">
                active
              </span>
            </span>
          </li>
          <li className="flex gap-1.5">
            <span className="text-niqo-coral shrink-0">•</span>
            <span>L&apos;annonce redevient visible sur Home + Recherche</span>
          </li>
          <li className="flex gap-1.5">
            <span className="text-niqo-coral shrink-0">•</span>
            <span>
              Le vendeur reçoit un push « Annonce remise en vente »
            </span>
          </li>
          <li className="flex gap-1.5 pt-1.5 border-t border-niqo-gray-200/60 mt-2">
            <span className="text-niqo-gray-500 shrink-0">↳</span>
            <span className="text-niqo-gray-500 truncate" title={annonceTitre}>
              {annonceTitre}
            </span>
          </li>
        </ul>
      </div>

      {error ? (
        <div
          role="alert"
          className="bg-niqo-danger/10 border border-niqo-danger/30 rounded-lg px-3 py-2"
        >
          <p className="text-xs text-niqo-danger font-medium">{error}</p>
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={isPending}
          className="flex-1 h-9 border border-niqo-gray-200 rounded-lg text-niqo-gray-800 text-sm font-medium hover:bg-niqo-gray-50 transition-colors duration-150 cursor-pointer disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          className="flex-1 h-9 bg-niqo-coral text-white text-sm font-semibold rounded-lg hover:bg-niqo-coral/90 transition-colors duration-150 cursor-pointer disabled:opacity-60 shadow-sm flex items-center justify-center gap-1.5"
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Revert…</span>
            </>
          ) : (
            <span>Confirmer</span>
          )}
        </button>
      </div>
    </div>
  );
}
