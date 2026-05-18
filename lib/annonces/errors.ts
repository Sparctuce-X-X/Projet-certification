/**
 * Map centralisé des codes d'erreur Supabase DB (check constraints, triggers,
 * RPC) → messages français user-friendly pour le module annonces.
 *
 * Pattern identique à `lib/auth/errors.ts`.
 *
 * Sources des noms de contraintes :
 *   - docs/migrations/15_annonces.sql (check constraints inline + nommées)
 *   - docs/migrations/16_annonces_expiration.sql (trigger anti-spam + RPCs)
 */


// ── Check constraints (migration 15) ────────────────────────────────────────

const ANNONCE_ERRORS_FR: Record<string, string> = {
  // Check constraints inline — Postgres les nomme `{table}_{column}_check`
  annonces_titre_check: "Le titre doit faire entre 3 et 50 caractères.",
  annonces_description_check:
    "La description doit faire entre 10 et 2 000 caractères.",
  annonces_prix_check: "Le prix doit être supérieur à 0.",
  annonces_photos_check: "Il faut entre 1 et 5 photos par annonce.",
  annonces_ville_check: "La ville doit faire entre 2 et 50 caractères.",
  annonces_quartier_check:
    "Le quartier doit faire entre 2 et 50 caractères (ou être vide).",

  // Trigger anti-spam (migration 16)
  rate_limit_announces:
    "Tu as atteint la limite de 5 nouvelles annonces par 24h. Réessaie plus tard.",

  // Anti-doublon (migration 17)
  annonces_duplicate_check:
    "Tu as déjà posté une annonce identique récemment. Modifie le titre, la description ou le prix.",

  // Filtre contenu (migration 29) — couche 1 mots_interdits substring DB
  contenu_interdit:
    "Ton annonce contient un terme interdit. Modifie le titre ou la description.",
};

// Modération couche 2 (OpenAI Moderation, Edge Function moderate-text)
// Format des throws côté lib/annonces : "moderation_blocked: <hint FR>"
// → on extrait le hint pour le présenter tel quel à l'user (déjà FR).
const MODERATION_MARKER = "moderation_blocked:";

// ── RPC prolongation errors (migration 16) ──────────────────────────────────

const PROLONGATION_ERRORS_FR: Record<string, string> = {
  not_owner: "Tu ne peux prolonger que tes propres annonces.",
  not_expired: "Cette annonce n'est pas expirée.",
  window_closed:
    "Le délai de prolongation de 28 jours est dépassé. Crée une nouvelle annonce.",
  not_found: "Annonce introuvable.",
  not_authenticated: "Connecte-toi pour prolonger une annonce.",
};

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_FR = "Une erreur est survenue. Réessaie dans un instant.";
const TIMEOUT_FR = "Connexion lente. Vérifie ton réseau et réessaie.";
const NETWORK_FR = "Pas de connexion. Vérifie ton réseau et réessaie.";

// ── Mapper principal ────────────────────────────────────────────────────────

interface AnnonceErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Convertit une erreur Supabase DB (PostgREST / RPC) ou un Error JS
 * en message français user-friendly.
 *
 * Cherche dans l'ordre :
 *   1. Nom de contrainte exact dans ANNONCE_ERRORS_FR (substring match
 *      sur le message, car PostgREST inclut le nom de la contrainte dans
 *      le champ `message`)
 *   2. Heuristiques (timeout, network)
 *   3. Fallback générique
 *
 */
export function annonceErrorToFr(
  error: AnnonceErrorLike | Error | unknown
): string {
  if (!error) return DEFAULT_FR;

  const msg =
    (error as AnnonceErrorLike)?.message ??
    (error instanceof Error ? error.message : String(error));

  if (!msg || typeof msg !== "string") return DEFAULT_FR;

  const lower = msg.toLowerCase();

  // 0. Modération couche 2 (OpenAI) — pass-through du hint FR déjà mis en
  //    forme par l'Edge Function moderate-text. Doit matcher AVANT le scan
  //    des contraintes pour ne pas être écrasé par un fallback.
  const moderationIdx = lower.indexOf(MODERATION_MARKER);
  if (moderationIdx >= 0) {
    const hint = msg.substring(moderationIdx + MODERATION_MARKER.length).trim();
    return hint || DEFAULT_FR;
  }

  // 1. Match exact par nom de contrainte / trigger dans le message
  for (const [key, value] of Object.entries(ANNONCE_ERRORS_FR)) {
    if (lower.includes(key.toLowerCase())) {
      return value;
    }
  }

  // 2. Heuristiques réseau
  if (lower.includes("timeout")) return TIMEOUT_FR;
  if (lower.includes("network") || lower.includes("fetch")) return NETWORK_FR;

  // 3. Fallback
  return DEFAULT_FR;
}

/**
 * Convertit un code d'erreur RPC prolongation en message FR.
 */
export function prolongationErrorToFr(errorCode: string): string {
  return PROLONGATION_ERRORS_FR[errorCode] ?? DEFAULT_FR;
}
