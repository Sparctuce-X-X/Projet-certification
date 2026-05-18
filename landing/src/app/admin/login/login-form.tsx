"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { signInAdmin } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  not_admin: "Ce compte n'a pas accès au back-office.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const queryError = searchParams.get("error");
  const redirectTo = searchParams.get("redirect");

  const [error, setError] = useState<string | null>(
    queryError ? (ERROR_MESSAGES[queryError] ?? null) : null
  );
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    setError(null);
    if (redirectTo) formData.set("redirect", redirectTo);
    startTransition(async () => {
      const result = await signInAdmin(formData);
      if (result?.error) {
        setError(result.error);
      }
      // Si succès : Server Action fait redirect() qui throw NEXT_REDIRECT
    });
  };

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-niqo-gray-800 mb-1.5"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          className="w-full h-11 px-3 border border-niqo-gray-200 rounded-lg text-niqo-black focus:outline-none focus:ring-2 focus:ring-niqo-coral focus:border-transparent transition-colors"
          placeholder="admin@niqo.africa"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-niqo-gray-800 mb-1.5"
        >
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full h-11 px-3 border border-niqo-gray-200 rounded-lg text-niqo-black focus:outline-none focus:ring-2 focus:ring-niqo-coral focus:border-transparent transition-colors"
        />
      </div>

      {/* L2 audit : aria-live="polite" + role="alert" pour que les screen
          readers annoncent l'erreur de login après submit (sans être trop
          intrusif comme "assertive"). */}
      <div role="alert" aria-live="polite" className="min-h-0">
        {error ? (
          <div className="bg-niqo-danger/10 border border-niqo-danger/20 rounded-lg px-3 py-2.5">
            <p className="text-sm text-niqo-danger">{error}</p>
          </div>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full h-11 bg-niqo-coral text-white font-semibold rounded-lg hover:bg-niqo-coral/90 transition-colors duration-200 cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2"
      >
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Connexion…</span>
          </>
        ) : (
          <span>Se connecter</span>
        )}
      </button>
    </form>
  );
}
