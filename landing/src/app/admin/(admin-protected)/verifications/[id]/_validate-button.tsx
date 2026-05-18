"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { validateVerification } from "./actions";

interface ValidateButtonProps {
  verificationId: string;
  userName: string;
}

export function ValidateButton({ verificationId, userName }: ValidateButtonProps) {
  const [open, setOpen] = useState(false);
  const [numeroCni, setNumeroCni] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = numeroCni.trim().toUpperCase();
  const cniValid =
    trimmed.length >= 4 &&
    trimmed.length <= 20 &&
    /^[A-Z0-9 \-]+$/.test(trimmed);

  // V3 audit : Escape key ferme le modal (pattern clavier admin standard).
  // Skip si pending pour éviter une fermeture pendant la mutation server.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) {
        setOpen(false);
        setNumeroCni("");
        setError(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, isPending]);

  const handleConfirm = () => {
    if (!cniValid) {
      setError("Numéro CNI invalide (4-20 caractères, A-Z, 0-9).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await validateVerification(verificationId, trimmed);
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
        setNumeroCni("");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full h-12 bg-niqo-success text-white font-semibold rounded-lg hover:bg-niqo-success/90 transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
      >
        <CheckCircle2 className="w-5 h-5" strokeWidth={2.4} />
        Valider la vérification
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setOpen(false);
          }}
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="w-12 h-12 rounded-full bg-niqo-success/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-6 h-6 text-niqo-success" strokeWidth={2.2} />
            </div>
            <h2 className="font-display text-xl font-bold text-niqo-black mb-2">
              Valider la vérification ?
            </h2>
            <p className="text-sm text-niqo-gray-800 leading-relaxed mb-4">
              <strong>{userName}</strong> recevra le badge « Vendeur Vérifié »
              à vie. Un email de confirmation lui sera envoyé.
            </p>

            <label className="block text-sm font-medium text-niqo-gray-800 mb-1">
              Numéro CNI
              <span className="text-niqo-danger ml-0.5">*</span>
            </label>
            <input
              type="text"
              value={numeroCni}
              onChange={(e) => {
                setNumeroCni(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Ex : CI123456789012"
              autoFocus
              maxLength={20}
              disabled={isPending}
              className="w-full h-11 px-3 rounded-lg border border-niqo-gray-200 font-mono text-sm uppercase text-niqo-black focus:outline-none focus:border-niqo-success focus:ring-1 focus:ring-niqo-success disabled:opacity-60"
            />
            <p className="text-xs text-niqo-gray-500 mt-1 mb-5">
              Lis le numéro sur la CNI (recto). Évite les doublons : la même
              identité ne peut être vérifiée que sur 1 seul compte.
            </p>

            {error ? (
              <div className="bg-niqo-danger/10 border border-niqo-danger/20 rounded-lg px-3 py-2 mb-4">
                <p className="text-sm text-niqo-danger">{error}</p>
              </div>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setNumeroCni("");
                  setError(null);
                }}
                disabled={isPending}
                className="flex-1 h-11 border border-niqo-gray-200 rounded-lg text-niqo-gray-800 font-medium hover:bg-niqo-gray-50 transition-colors duration-200 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending || !cniValid}
                className="flex-1 h-11 bg-niqo-success text-white font-semibold rounded-lg hover:bg-niqo-success/90 transition-colors duration-200 cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Validation…</span>
                  </>
                ) : (
                  <span>Valider</span>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
