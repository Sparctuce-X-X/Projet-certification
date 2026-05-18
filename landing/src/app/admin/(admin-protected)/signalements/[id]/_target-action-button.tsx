"use client";

import {
  AlertOctagon,
  CheckCircle2,
  Loader2,
  ShieldOff,
} from "lucide-react";
import { useState, useTransition } from "react";

import {
  softDeleteMessage,
  suspendAnnonce,
  suspendUser,
} from "./cascade-actions";

type TargetType = "annonce" | "utilisateur" | "message" | "rdv_post";

interface TargetActionButtonProps {
  signalementId: string;
  targetType: TargetType;
  targetId: string;
  /** Pour annonce : statut actuel ('active', 'suspendue', etc.) */
  annonceStatut?: string;
  /** Pour user : si is_active déjà false → rien à faire */
  userIsActive?: boolean;
  /** Pour message : si is_deleted déjà true → rien à faire */
  messageIsDeleted?: boolean;
}

/**
 * Bouton "Action sur la cible" — suspendre annonce/user, soft-delete message.
 *
 * Indépendant du statut du signalement (ActionButtons gère ce dernier).
 * Pattern inline expand identique à ActionButtons : tap → preview impact
 * → confirmer.
 *
 * Si la cible est déjà dans l'état terminal (annonce suspendue, user inactif,
 * message supprimé), affiche un état lecture seule au lieu du bouton.
 */
export function TargetActionButton(props: TargetActionButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // S3 audit : rdv_post n'a pas d'action manuelle (l'auto-pause annonce est
  // faite par fn_signalement_check_threshold mig 91 si motif=fraude validé),
  // mais on affiche un fallback informatif au lieu de retourner null
  // silencieusement — sinon Dominique se demande si c'est cassé.
  if (props.targetType === "rdv_post") {
    return (
      <div className="rounded-lg p-3 bg-niqo-gray-50 border border-niqo-gray-200">
        <p className="text-xs font-bold text-niqo-gray-500 uppercase tracking-wider mb-1">
          Cible
        </p>
        <p className="text-xs text-niqo-gray-800 inline-flex items-start gap-1.5">
          <ShieldOff className="w-3.5 h-3.5 text-niqo-gray-500 mt-0.5 shrink-0" strokeWidth={2.4} />
          <span>
            Pas d&apos;action manuelle requise — si tu valides ce signalement
            avec un motif de fraude, l&apos;annonce est{" "}
            <span className="font-medium text-niqo-black">auto-suspendue</span>{" "}
            par le système (mig 91).
          </span>
        </p>
      </div>
    );
  }

  const config = getActionConfig(props);

  // ── Cible déjà dans l'état terminal — pas d'action possible ─────────────
  if (config.alreadyDone) {
    return (
      <div className="rounded-lg p-3 bg-niqo-gray-50 border border-niqo-gray-200">
        <p className="text-xs font-bold text-niqo-gray-500 uppercase tracking-wider mb-1">
          Cible
        </p>
        <p className="text-xs text-niqo-gray-800 inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-niqo-gray-500" strokeWidth={2.4} />
          {config.alreadyDoneLabel}
        </p>
      </div>
    );
  }

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await config.action();
      if (result.error) setError(result.error);
      else setConfirming(false);
    });
  };

  // ── État repos ───────────────────────────────────────────────────────────
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full h-10 border border-niqo-danger/40 text-niqo-danger text-sm font-medium rounded-lg hover:bg-niqo-danger/5 transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5"
      >
        <ShieldOff className="w-4 h-4" strokeWidth={2.4} />
        {config.label}
      </button>
    );
  }

  // ── État confirm ────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="rounded-lg p-3.5 bg-niqo-danger/5 border border-niqo-danger/30">
        <p className="text-xs font-bold uppercase tracking-wider mb-2 text-niqo-danger inline-flex items-center gap-1.5">
          <AlertOctagon className="w-3.5 h-3.5" strokeWidth={2.4} />
          {config.label} — impact
        </p>
        <ul className="space-y-1.5 text-xs text-niqo-gray-800 leading-relaxed">
          {config.impactBullets.map((bullet, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-niqo-danger shrink-0">•</span>
              <span>{bullet}</span>
            </li>
          ))}
          <li className="flex gap-1.5 pt-1.5 border-t border-niqo-danger/20 mt-2">
            <span className="text-niqo-gray-500 shrink-0">↳</span>
            <span className="text-niqo-gray-500">
              Action immédiate, indépendante du signalement
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
          className="flex-1 h-10 border border-niqo-gray-200 rounded-lg text-niqo-gray-800 text-sm font-medium hover:bg-niqo-gray-50 transition-colors duration-150 cursor-pointer disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          className="flex-1 h-10 bg-niqo-danger text-white text-sm font-semibold rounded-lg hover:bg-niqo-danger/90 transition-colors duration-150 cursor-pointer disabled:opacity-60 shadow-sm flex items-center justify-center gap-1.5"
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>En cours…</span>
            </>
          ) : (
            <span>Confirmer</span>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Configuration par type de cible ─────────────────────────────────────────

interface ActionConfig {
  label: string;
  impactBullets: string[];
  action: () => Promise<{ success?: true; error?: string }>;
  alreadyDone: boolean;
  alreadyDoneLabel: string;
}

function getActionConfig(props: TargetActionButtonProps): ActionConfig {
  const { signalementId, targetType, targetId } = props;

  if (targetType === "annonce") {
    const alreadyDone = props.annonceStatut === "suspendue";
    return {
      label: "Suspendre l'annonce",
      impactBullets: [
        "L'annonce passe en statut 'suspendue'",
        "Disparaît de Home / Search / catégorie",
        "Le vendeur peut toujours la voir mais ne peut plus l'éditer",
        "Action réversible (réactivation manuelle SQL)",
      ],
      action: () => suspendAnnonce(signalementId, targetId),
      alreadyDone,
      alreadyDoneLabel: "Annonce déjà suspendue",
    };
  }

  if (targetType === "utilisateur") {
    const alreadyDone = props.userIsActive === false;
    return {
      label: "Suspendre le compte",
      impactBullets: [
        "Le user passe en is_active = false",
        "Ne peut plus se connecter ni publier",
        "Ses annonces actives restent visibles (suspendre séparément)",
        "Action réversible (réactivation SQL)",
      ],
      action: () => suspendUser(signalementId, targetId),
      alreadyDone,
      alreadyDoneLabel: "Compte déjà suspendu",
    };
  }

  // message
  const alreadyDone = props.messageIsDeleted === true;
  return {
    label: "Supprimer le message",
    impactBullets: [
      "Le message passe en is_deleted = true (soft delete)",
      "Disparaît du chat côté mobile",
      "Conservé en DB pour audit",
      "Action irréversible côté UI mobile",
    ],
    action: () => softDeleteMessage(signalementId, targetId),
    alreadyDone,
    alreadyDoneLabel: "Message déjà supprimé",
  };
}
