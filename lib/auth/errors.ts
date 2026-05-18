/**
 * Map centralisé des codes d'erreur Supabase Auth → messages français
 * user-friendly. Source de vérité unique pour tout le module auth.
 *
 * Cf. docs Supabase : https://supabase.com/docs/reference/javascript/auth-error
 */

export const AUTH_ERRORS_FR: Record<string, string> = {
  // Identifiants
  invalid_credentials: "Email ou mot de passe incorrect.",
  invalid_grant: "Email ou mot de passe incorrect.",
  email_address_invalid: "Email invalide.",
  email_not_confirmed: "Email pas encore confirmé. Vérifie ta boîte mail.",
  user_already_exists: "Un compte existe déjà avec cet email.",
  email_taken: "Un compte existe déjà avec cet email.",
  email_exists: "Un compte existe déjà avec cet email.",
  user_not_found: "Aucun compte trouvé pour cet email.",

  // Mots de passe
  weak_password: "Mot de passe trop faible (6 caractères minimum).",
  password_does_not_meet_requirements:
    "Mot de passe trop faible. Choisis-en un plus complexe.",
  same_password: "Choisis un mot de passe différent de l'ancien.",

  // Rate / quota
  over_email_send_rate_limit:
    "Trop de tentatives, réessaie dans quelques minutes.",
  email_send_rate_limit_exceeded:
    "Trop de tentatives, réessaie dans quelques minutes.",
  over_request_rate_limit: "Trop de tentatives, attends une minute.",
  over_sms_send_rate_limit:
    "Trop de tentatives, réessaie dans quelques minutes.",

  // OAuth / PKCE
  provider_is_not_enabled: "Ce mode de connexion n'est pas encore activé.",
  bad_oauth_state: "Session expirée, refais la connexion.",
  flow_state_expired: "Session expirée, refais la connexion.",
  flow_state_not_found: "Session expirée, refais la connexion.",

  // État du compte
  user_banned: "Ce compte est bloqué. Contacte support@niqo.africa.",
  signup_disabled: "Les inscriptions sont temporairement désactivées.",
  email_provider_disabled:
    "La connexion par email est temporairement désactivée.",

  // Validation
  validation_failed: "Données invalides, vérifie tes champs.",
  captcha_failed: "Vérification de sécurité échouée, réessaie.",

  // Unicité métier (mig 84)
  PHONE_ALREADY_USED:
    "Ce numéro est déjà associé à un autre compte. Utilise-le pour te connecter.",
};

const DEFAULT_FR = "Connexion impossible. Réessaie dans un instant.";
const TIMEOUT_FR = "Connexion trop lente. Vérifie ton réseau et réessaie.";
const NETWORK_FR = "Pas de connexion. Vérifie ton réseau et réessaie.";

interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Convertit une erreur Supabase Auth (ou tout objet avec code/message)
 * en message français user-friendly.
 *
 * Cherche dans l'ordre :
 *   1. Code exact dans AUTH_ERRORS_FR
 *   2. Heuristiques sur le message (timeout, network, etc.)
 *   3. Fallback générique
 *
 * Accepte aussi Error / unknown / null pour faciliter les try/catch.
 */
export function authErrorToFr(
  error: AuthErrorLike | Error | unknown
): string {
  if (!error) return DEFAULT_FR;

  const err = error as AuthErrorLike;

  if (err.code && typeof err.code === "string" && AUTH_ERRORS_FR[err.code]) {
    return AUTH_ERRORS_FR[err.code];
  }

  if (err.message && typeof err.message === "string") {
    // Mig 84 : trigger handle_new_user → unique_violation sur telephone_hash.
    // Le code Postgres ne propage pas via Supabase Auth (qui wrap en 500 +
    // message brut), on matche donc sur le nom de l'index ou le code custom.
    if (
      err.message.includes("PHONE_ALREADY_USED") ||
      err.message.includes("users_telephone_hash_unique")
    ) {
      return AUTH_ERRORS_FR.PHONE_ALREADY_USED;
    }

    const lower = err.message.toLowerCase();
    if (lower.includes("timeout")) return TIMEOUT_FR;
    if (lower.includes("network") || lower.includes("fetch")) return NETWORK_FR;
    if (lower.includes("invalid") && lower.includes("credentials")) {
      return AUTH_ERRORS_FR.invalid_credentials;
    }
    if (lower.includes("already") || lower.includes("registered")) {
      return AUTH_ERRORS_FR.user_already_exists;
    }
    if (lower.includes("weak") && lower.includes("password")) {
      return AUTH_ERRORS_FR.weak_password;
    }
    if (lower.includes("same") && lower.includes("password")) {
      return AUTH_ERRORS_FR.same_password;
    }
    if (lower.includes("rate") && lower.includes("limit")) {
      return AUTH_ERRORS_FR.over_email_send_rate_limit;
    }
    if (lower.includes("provider") && lower.includes("not enabled")) {
      return AUTH_ERRORS_FR.provider_is_not_enabled;
    }
    if (lower.includes("flow state") || lower.includes("oauth state")) {
      return AUTH_ERRORS_FR.bad_oauth_state;
    }
  }

  return DEFAULT_FR;
}
