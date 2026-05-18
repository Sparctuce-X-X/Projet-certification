/**
 * Helpers password — partagés entre email.tsx (signup wizard) et
 * reset-password.tsx (deeplink reset). Évite la duplication du barème de
 * force + des labels FR.
 *
 * Le barème est volontairement simple (4 critères, 3 niveaux) pour rester
 * lisible côté UX. La validation faisant autorité est côté Supabase
 * (`auth.config.password_min_length` + politique côté serveur).
 */

export type PasswordStrength = "faible" | "correct" | "fort";

export function getPasswordStrength(pwd: string): PasswordStrength {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 1) return "faible";
  if (score === 2) return "correct";
  return "fort";
}

export interface PasswordStrengthDisplay {
  label: string;
  bars: 1 | 2 | 3;
  color: string;
  text: string;
  hint: string | null;
}

export const PASSWORD_STRENGTH_CONFIG: Record<
  PasswordStrength,
  PasswordStrengthDisplay
> = {
  faible: {
    label: "Faible",
    bars: 1,
    color: "bg-niqo-danger",
    text: "text-niqo-danger",
    hint: "Utilise 8+ caractères, une majuscule et un chiffre.",
  },
  correct: {
    label: "Correct",
    bars: 2,
    color: "bg-niqo-warning",
    text: "text-niqo-warning",
    hint: "Ajoute un caractère spécial (!@#$…) pour un mot de passe fort.",
  },
  fort: {
    label: "Fort",
    bars: 3,
    color: "bg-niqo-success",
    text: "text-niqo-success",
    hint: null,
  },
};
