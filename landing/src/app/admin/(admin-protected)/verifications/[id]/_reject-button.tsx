"use client";

import { Loader2, XCircle } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { rejectVerification } from "./actions";

interface RejectButtonProps {
  verificationId: string;
  userName: string;
}

const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 500;

export function RejectButton({ verificationId, userName }: RejectButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedLength = reason.trim().length;
  const canSubmit = trimmedLength >= MIN_REASON_LENGTH && !isPending;

  // V3 audit : Escape key ferme le modal (pattern clavier admin standard).
  // Skip si pending pour éviter une fermeture pendant la mutation server.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, isPending]);

  const handleConfirm = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await rejectVerification(verificationId, reason);
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
        setReason("");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-12 border-2 border-niqo-danger text-niqo-danger font-semibold rounded-lg hover:bg-niqo-danger/5 transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
      >
        <XCircle className="w-5 h-5" strokeWidth={2.4} />
        Refuser
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setOpen(false);
          }}
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="w-12 h-12 rounded-full bg-niqo-danger/10 flex items-center justify-center mb-4">
              <XCircle className="w-6 h-6 text-niqo-danger" strokeWidth={2.2} />
            </div>
            <h2 className="font-display text-xl font-bold text-niqo-black mb-2">
              Refuser la vérification ?
            </h2>
            <p className="text-sm text-niqo-gray-800 leading-relaxed mb-1">
              <strong>{userName}</strong> sera notifié par email avec la raison
              ci-dessous. Le 1 000 FCFA payé n&apos;est pas remboursé.
            </p>
            <p className="text-xs text-niqo-gray-500 mb-4">
              Sois précis et factuel — l&apos;user doit pouvoir corriger.
            </p>

            <label
              htmlFor="reject-reason"
              className="block text-sm font-medium text-niqo-gray-800 mb-1.5"
            >
              Raison du refus
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value.slice(0, MAX_REASON_LENGTH));
                setError(null);
              }}
              rows={3}
              autoFocus
              placeholder={`Ex : la photo de la CNI est floue, le numéro est illisible. Recommence avec un meilleur éclairage. (${MIN_REASON_LENGTH} caractères minimum)`}
              aria-describedby="reject-reason-counter"
              className={`w-full px-3 py-2.5 border-2 rounded-lg text-sm text-niqo-black placeholder:text-niqo-gray-500 focus:outline-none focus:ring-2 transition-colors duration-150 resize-none ${
                trimmedLength === 0
                  ? "border-niqo-gray-200 focus:border-niqo-coral focus:ring-niqo-coral/20"
                  : trimmedLength < MIN_REASON_LENGTH
                  ? "border-niqo-danger/40 focus:border-niqo-danger focus:ring-niqo-danger/20"
                  : "border-niqo-success/60 focus:border-niqo-success focus:ring-niqo-success/20"
              }`}
            />
            <div
              id="reject-reason-counter"
              className="flex items-center justify-end mt-1.5 mb-4"
            >
              <p
                className={`text-xs tabular-nums ${
                  trimmedLength === 0
                    ? "text-niqo-gray-500"
                    : trimmedLength < MIN_REASON_LENGTH
                    ? "text-niqo-danger"
                    : "text-niqo-success"
                }`}
              >
                {trimmedLength < MIN_REASON_LENGTH
                  ? `${MIN_REASON_LENGTH - trimmedLength} caractère${MIN_REASON_LENGTH - trimmedLength > 1 ? "s" : ""} restant${MIN_REASON_LENGTH - trimmedLength > 1 ? "s" : ""} · `
                  : ""}
                {trimmedLength}/{MAX_REASON_LENGTH}
              </p>
            </div>

            {error ? (
              <div
                role="alert"
                className="bg-niqo-danger/10 border border-niqo-danger/30 rounded-lg px-3 py-2 mb-4"
              >
                <p className="text-sm text-niqo-danger font-medium">{error}</p>
              </div>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="flex-1 h-11 border border-niqo-gray-200 rounded-lg text-niqo-gray-800 font-medium hover:bg-niqo-gray-50 transition-colors duration-200 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canSubmit}
                aria-label={
                  canSubmit
                    ? "Confirmer le refus"
                    : `Saisis au moins ${MIN_REASON_LENGTH} caractères pour activer`
                }
                className={`flex-1 h-11 bg-niqo-danger text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2 ${
                  canSubmit
                    ? "hover:bg-niqo-danger/90 cursor-pointer shadow-sm"
                    : "opacity-40 cursor-not-allowed"
                }`}
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Refus…</span>
                  </>
                ) : canSubmit ? (
                  <span>Refuser</span>
                ) : (
                  <span className="text-xs">
                    Refuser · {MIN_REASON_LENGTH - trimmedLength} char
                    {MIN_REASON_LENGTH - trimmedLength > 1 ? "s" : ""} min
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
