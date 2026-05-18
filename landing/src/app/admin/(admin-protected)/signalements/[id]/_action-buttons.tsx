"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import { useState, useTransition } from "react";

import { treatSignalement } from "./actions";

interface ActionButtonsProps {
  signalementId: string;
  /** Description courte de la cible — affichée dans le preview d'impact. */
  cibleLabel: string;
  /** Score abus actuel de la personne signalée (vendeur/user/expediteur). */
  targetScoreAbus: number;
  /** Compte de la personne déjà suspendu ? Si oui, plus rien à faire côté suspend. */
  targetIsActive: boolean;
  /** Type de cible — utilisé pour formuler les bullets d'impact. */
  targetType: "annonce" | "utilisateur" | "message" | "rdv_post";
  /** Pour rdv_post : motif typé (mig 91) — détecte fraude → auto-pause annonce. */
  motifCategorie?:
    | "no_show"
    | "produit_different"
    | "produit_defectueux"
    | "tentative_fraude"
    | "comportement_dangereux"
    | "complot_fraude"
    | "autre"
    | null;
}

/**
 * Boutons décision avec **inline expand** qui montre le preview d'impact
 * avant confirmation — remplace le confirm() natif. Pattern Linear/Vercel.
 *
 * 3 états :
 *   1. Repos : 2 boutons côte à côte (Rejeter + Marquer comme traité)
 *   2. Confirm : la card s'agrandit, montre l'impact projeté + 2 boutons (Annuler + Confirmer)
 *   3. Pending : spinner sur Confirmer
 *
 * Le calcul "va suspendre l'user" est fait côté serveur (passé en prop
 * via `targetScoreAbus + targetIsActive`) — score actuel = 2 ET compte
 * encore actif → +1 = 3 → trigger fn_check_score_abus auto-suspend.
 */
export function ActionButtons({
  signalementId,
  cibleLabel,
  targetScoreAbus,
  targetIsActive,
  targetType,
  motifCategorie,
}: ActionButtonsProps) {
  const isFraudMotif =
    targetType === "rdv_post" &&
    (motifCategorie === "tentative_fraude" || motifCategorie === "complot_fraude");
  const [confirmingAction, setConfirmingAction] = useState<
    "traite" | "rejete" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Calcul d'impact : un traitement valide pousse score à +1 → suspend si on
  // touche le seuil 3 (et que le compte n'est pas déjà suspendu).
  const newScoreOnTraite = targetScoreAbus + 1;
  const willSuspendOnTraite = newScoreOnTraite >= 3 && targetIsActive;

  const handleConfirm = () => {
    if (!confirmingAction) return;
    setError(null);
    startTransition(async () => {
      const result = await treatSignalement(signalementId, confirmingAction);
      if (result.error) {
        setError(result.error);
      } else {
        setConfirmingAction(null);
      }
    });
  };

  // ── État repos ────────────────────────────────────────────────────────────
  if (!confirmingAction) {
    return (
      <div className="flex gap-2">
        {/* S2 audit : focus-visible:ring pour navigation clavier (admin =
            usage quotidien, raccourcis). focus-visible:outline-none retire
            l'outline browser par défaut moche. */}
        <button
          type="button"
          onClick={() => setConfirmingAction("rejete")}
          className="flex-1 h-10 border border-niqo-gray-200 rounded-lg text-niqo-gray-800 text-sm font-medium hover:bg-niqo-gray-50 transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
        >
          <XCircle className="w-4 h-4" strokeWidth={2.4} />
          Rejeter
        </button>
        <button
          type="button"
          onClick={() => setConfirmingAction("traite")}
          className="flex-1 h-10 bg-niqo-success text-white text-sm font-semibold rounded-lg hover:bg-niqo-success/90 transition-colors duration-150 cursor-pointer shadow-sm flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
        >
          <CheckCircle2 className="w-4 h-4" strokeWidth={2.4} />
          Marquer comme traité
        </button>
      </div>
    );
  }

  // ── État confirm — preview d'impact ───────────────────────────────────────
  const isReject = confirmingAction === "rejete";

  return (
    <div className="space-y-3">
      <div
        className={`rounded-lg p-3.5 ${
          isReject
            ? "bg-niqo-gray-50 border border-niqo-gray-200"
            : willSuspendOnTraite
            ? "bg-niqo-danger/5 border border-niqo-danger/30"
            : "bg-niqo-success/5 border border-niqo-success/30"
        }`}
      >
        <p
          className={`text-xs font-bold uppercase tracking-wider mb-2 ${
            isReject
              ? "text-niqo-gray-500"
              : willSuspendOnTraite
              ? "text-niqo-danger"
              : "text-niqo-success"
          }`}
        >
          {isReject ? "Rejet — impact" : "Traitement — impact"}
        </p>

        <ul className="space-y-1.5 text-xs text-niqo-gray-800 leading-relaxed">
          {isReject ? (
            <>
              <li className="flex gap-1.5">
                <span className="text-niqo-gray-500 shrink-0">•</span>
                <span>Aucun changement sur la cible</span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-niqo-gray-500 shrink-0">•</span>
                <span>Le signaleur reçoit un push « Signalement examiné »</span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-niqo-gray-500 shrink-0">•</span>
                <span>Marqué comme faux positif dans l&apos;historique</span>
              </li>
            </>
          ) : (
            <>
              <li className="flex gap-1.5">
                <span className="text-niqo-success shrink-0">•</span>
                <span>
                  Score abus :{" "}
                  <span className="font-mono font-medium">
                    {targetScoreAbus}
                  </span>{" "}
                  →{" "}
                  <span
                    className={`font-mono font-medium ${
                      willSuspendOnTraite ? "text-niqo-danger" : "text-niqo-black"
                    }`}
                  >
                    {newScoreOnTraite}
                  </span>{" "}
                  / 3
                </span>
              </li>
              {willSuspendOnTraite ? (
                <li className="flex gap-1.5">
                  <span className="text-niqo-danger shrink-0">
                    <AlertTriangle className="w-3 h-3 mt-0.5" strokeWidth={2.4} />
                  </span>
                  <span className="text-niqo-danger font-medium">
                    Compte suspendu automatiquement (seuil 3 atteint)
                  </span>
                </li>
              ) : null}
              {isFraudMotif ? (
                <li className="flex gap-1.5">
                  <span className="text-niqo-danger shrink-0">
                    <AlertTriangle className="w-3 h-3 mt-0.5" strokeWidth={2.4} />
                  </span>
                  <span className="text-niqo-danger font-medium">
                    Annonce auto-suspendue (motif fraude — mig 91)
                  </span>
                </li>
              ) : null}
              <li className="flex gap-1.5">
                <span className="text-niqo-success shrink-0">•</span>
                <span>
                  Le signaleur reçoit un push « Signalement pris en compte »
                </span>
              </li>
              {targetType === "annonce" ? (
                <li className="flex gap-1.5">
                  <span className="text-niqo-gray-500 shrink-0">•</span>
                  <span className="text-niqo-gray-800">
                    L&apos;annonce reste en ligne (suspendre manuellement si besoin)
                  </span>
                </li>
              ) : null}
            </>
          )}
          <li className="flex gap-1.5 pt-1.5 border-t border-niqo-gray-200/60 mt-2">
            <span className="text-niqo-gray-500 shrink-0">↳</span>
            <span className="text-niqo-gray-500 truncate" title={cibleLabel}>
              {cibleLabel}
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
            setConfirmingAction(null);
            setError(null);
          }}
          disabled={isPending}
          className="flex-1 h-10 border border-niqo-gray-200 rounded-lg text-niqo-gray-800 text-sm font-medium hover:bg-niqo-gray-50 transition-colors duration-150 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          className={`flex-1 h-10 text-white text-sm font-semibold rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-60 shadow-sm flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2 ${
            isReject
              ? "bg-niqo-gray-800 hover:bg-niqo-black"
              : willSuspendOnTraite
              ? "bg-niqo-danger hover:bg-niqo-danger/90"
              : "bg-niqo-success hover:bg-niqo-success/90"
          }`}
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{isReject ? "Rejet…" : "Traitement…"}</span>
            </>
          ) : (
            <span>Confirmer</span>
          )}
        </button>
      </div>
    </div>
  );
}
