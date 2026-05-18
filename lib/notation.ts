/**
 * Module Notation post-RDV — wrappers TypeScript des RPC migration 37.
 *
 * Flow : après un RDV passé (rdv_confirme_at non null + rdv_date < now()),
 * chaque participant peut noter l'autre via submitAvis(conv, note, commentaire).
 * Les avis sont publics, signés, figés. Cron J+7 → note auto 3/5 si pas
 * de réponse.
 */

import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

// ── Types ───────────────────────────────────────────────────────────────────

export type AvisNote = 1 | 2 | 3 | 4 | 5;
export type RoleAuteur = "acheteur" | "vendeur";

/** Avis brut (table avis). */
export interface Avis {
  id: string;
  conversation_id: string;
  auteur_id: string;
  cible_id: string;
  note: AvisNote;
  commentaire: string | null;
  role_auteur: RoleAuteur;
  is_auto: boolean;
  created_at: string;
}

/** Avis enrichi avec les infos publiques de l'auteur (utilisé sur profils). */
export interface AvisWithAuteur {
  id: string;
  note: AvisNote;
  commentaire: string | null;
  role_auteur: RoleAuteur;
  is_auto: boolean;
  created_at: string;
  auteur_id: string;
  auteur_prenom: string;
  auteur_avatar_url: string | null;
}

// ── Erreurs ─────────────────────────────────────────────────────────────────

const NOTATION_ERRORS_FR: Record<string, string> = {
  not_authenticated: "Connecte-toi pour noter.",
  not_participant: "Tu ne fais pas partie de cette conversation.",
  conversation_not_found: "Conversation introuvable.",
  note_invalid: "Choisis une note de 1 à 5 étoiles.",
  commentaire_too_long: "Le commentaire doit faire 200 caractères max.",
  rdv_not_confirmed:
    "Tu ne peux noter que les RDV qui ont été confirmés des deux côtés.",
  rdv_not_past:
    "Tu pourras noter une fois le RDV passé.",
  avis_already_submitted:
    "Tu as déjà noté ce RDV. Une note ne peut pas être modifiée.",
};

const DEFAULT_FR = "Une erreur est survenue. Réessaie dans un instant.";
const TIMEOUT_FR = "Connexion lente. Vérifie ton réseau et réessaie.";
const NETWORK_FR = "Pas de connexion. Vérifie ton réseau et réessaie.";

export function notationErrorToFr(error: unknown): string {
  if (!error) return DEFAULT_FR;
  const msg =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : (error as { message?: string }).message;
  if (!msg) return DEFAULT_FR;
  if (NOTATION_ERRORS_FR[msg]) return NOTATION_ERRORS_FR[msg];
  const lower = msg.toLowerCase();
  if (lower.includes("timeout")) return TIMEOUT_FR;
  if (lower.includes("network") || lower.includes("fetch")) return NETWORK_FR;
  return DEFAULT_FR;
}

// ── RPC submit_avis ─────────────────────────────────────────────────────────

interface SubmitResult {
  success: boolean;
  error?: string;
}

/**
 * Soumet un avis pour une conversation où le RDV est passé.
 * Le rôle (acheteur/vendeur) et la cible sont déterminés serveur-side.
 */
export async function submitAvis(
  conversationId: string,
  note: AvisNote,
  commentaire: string | null
): Promise<SubmitResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("submit_avis", {
        p_conversation_id: conversationId,
        p_note: note,
        p_commentaire: commentaire,
      })
    ),
    AUTH_TIMEOUT_MS,
    "submitAvis"
  );

  if (error) return { success: false, error: error.message };
  return data as SubmitResult;
}

// ── Récupérer mon avis sur une conversation ────────────────────────────────

/**
 * Renvoie l'avis que j'ai posé sur une conversation, ou null si pas encore.
 * Utilisé par le chat screen pour afficher "Tu as noté X" vs "Noter X".
 */
export async function fetchMyAvisOnConv(
  conversationId: string
): Promise<Avis | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("avis")
        .select(
          "id, conversation_id, auteur_id, cible_id, note, commentaire, role_auteur, is_auto, created_at"
        )
        .eq("conversation_id", conversationId)
        .eq("auteur_id", userId)
        .maybeSingle()
    ),
    AUTH_TIMEOUT_MS,
    "fetchMyAvisOnConv"
  );

  if (error) return null;
  return (data ?? null) as Avis | null;
}

// ── Récupérer si l'autre m'a noté ──────────────────────────────────────────

/**
 * Renvoie l'avis posé PAR l'autre participant SUR moi, ou null.
 * Pour afficher "Jean t'a noté aussi" en pied de bandeau (optionnel).
 */
export async function fetchAvisFromOtherOnConv(
  conversationId: string
): Promise<Avis | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("avis")
        .select(
          "id, conversation_id, auteur_id, cible_id, note, commentaire, role_auteur, is_auto, created_at"
        )
        .eq("conversation_id", conversationId)
        .eq("cible_id", userId)
        .maybeSingle()
    ),
    AUTH_TIMEOUT_MS,
    "fetchAvisFromOtherOnConv"
  );

  if (error) return null;
  return (data ?? null) as Avis | null;
}
