/**
 * Module RDV — wrappers TypeScript des RPC migration 35 + 86.
 *
 * Modèle :
 *   1. Proposer → Confirmer (mig 35) — option A
 *      - propose_rdv : une partie propose lieu + date
 *      - confirm_rdv : l'autre partie confirme
 *      - cancel_rdv  : les deux parties peuvent annuler à tout moment
 *   2. Confirmation mutuelle post-RDV (mig 86) — anti-fraude vendeur
 *      - confirm_rencontre : chaque partie confirme oui/non après le RDV
 *      - 5 états dérivés : pending / unilateral / met / disputed / unconfirmed
 *
 * Les colonnes vivent sur conversations. Voir docs/migrations/35_…sql + 86_…sql
 * et docs/backend/rdv.md pour la matrice de décision complète.
 */

import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

// ── Types ───────────────────────────────────────────────────────────────────

/** Colonnes RDV + rencontre présentes sur conversations (toutes nullables). */
export interface RdvFields {
  rdv_lieu: string | null;
  rdv_date: string | null; // ISO timestamp
  rdv_propose_par: string | null;
  rdv_propose_at: string | null;
  rdv_confirme_at: string | null;
  rdv_annule_par: string | null;
  rdv_annule_at: string | null;
  rencontre_acheteur: boolean | null;
  rencontre_vendeur: boolean | null;
  rencontre_decided_at: string | null;
  /** Mig 96 — set par fn_signalement_check_threshold quand un signalement
   * rdv_post sur cette conv passe à traite/rejete. Cumulatif et idempotent.
   * UI : si non-null + rencontreState === "disputed" → bandeau gris résolu. */
  admin_signalement_decided_at: string | null;
}

/** État dérivé d'une conversation, pour l'UI. */
export type RdvState =
  | "none"       // jamais de RDV proposé, ou annulé puis pas re-proposé
  | "proposed"   // proposé mais pas encore confirmé
  | "confirmed"  // confirmé, date à venir
  | "past";      // confirmé, date dépassée — entrée dans le cycle confirm_rencontre

/**
 * État dérivé post-RDV (mig 86) — pertinent uniquement quand getRdvState() === "past".
 *
 * - pending          : ni l'un ni l'autre n'a confirmé la rencontre
 * - unilateral_self  : moi j'ai confirmé (oui ou non), pas l'autre
 * - unilateral_other : l'autre a confirmé (oui ou non), pas moi
 * - met              : les 2 ont dit oui (true, true) — tout débloqué
 * - disputed         : l'un dit oui, l'autre dit non — tout bloqué
 * - unconfirmed      : les 2 disent non (false, false) — annonce revert active
 */
export type RencontreState =
  | "pending"
  | "unilateral_self"
  | "unilateral_other"
  | "met"
  | "disputed"
  | "unconfirmed";

/**
 * Dérive l'état RDV courant depuis les colonnes d'une conversation.
 * Pure helper — pas d'I/O. Recalculé à chaque render (le passage de
 * "confirmed" à "past" se fait au prochain re-render après que la date passe).
 */
export function getRdvState(conv: RdvFields): RdvState {
  if (conv.rdv_confirme_at) {
    if (conv.rdv_date && new Date(conv.rdv_date).getTime() < Date.now()) {
      return "past";
    }
    return "confirmed";
  }
  if (conv.rdv_propose_par && conv.rdv_lieu && conv.rdv_date) return "proposed";
  return "none";
}

/**
 * Dérive l'état rencontre post-RDV pour le côté courant (acheteur ou vendeur).
 * À appeler uniquement quand getRdvState(conv) === "past".
 *
 * Mig 86 : `rencontre_decided_at` est posé dès que les 2 ont répondu — état figé.
 */
export function getRencontreState(
  conv: RdvFields,
  isVendeur: boolean
): RencontreState {
  const self = isVendeur ? conv.rencontre_vendeur : conv.rencontre_acheteur;
  const other = isVendeur ? conv.rencontre_acheteur : conv.rencontre_vendeur;

  if (conv.rencontre_decided_at) {
    if (self === true && other === true) return "met";
    if (self === false && other === false) return "unconfirmed";
    return "disputed";
  }

  // decided_at null → encore en cours de cycle
  if (self === null && other === null) return "pending";
  if (self !== null && other === null) return "unilateral_self";
  return "unilateral_other"; // self === null && other !== null
}

/**
 * Mig 96 — l'admin a-t-il déjà tranché un signalement rdv_post sur cette conv ?
 * Pertinent uniquement combiné avec rencontreState === "disputed" : remplace
 * le bandeau orange "Signaler ce RDV" par un bandeau gris neutre.
 */
export function isAdminSignalementDecided(conv: RdvFields): boolean {
  return conv.admin_signalement_decided_at !== null;
}

// ── Mig 98 : verdict signalement post-RDV visible côté user ─────────────────

/** Statut du signalement personnel du caller sur une conv (mig 98). */
export interface MyRdvSignalementStatus {
  has_signalement: boolean;
  signalement_id?: string;
  statut?: "en_attente" | "traite" | "rejete";
  motif?: string;
  motif_categorie?:
    | "no_show"
    | "produit_different"
    | "produit_defectueux"
    | "tentative_fraude"
    | "comportement_dangereux"
    | "complot_fraude"
    | "autre";
  created_at?: string;
  updated_at?: string;
}

/**
 * Récupère le verdict du signalement post-RDV créé par le caller sur cette
 * conv (mig 98). À appeler quand `admin_signalement_decided_at` non-null
 * pour enrichir le bandeau gris "examiné par l'équipe Niqo".
 *
 * Anti-leak côté DB : retourne `has_signalement: false` si caller n'a pas
 * signalé OU n'est pas participant.
 */
export async function fetchMyRdvSignalementStatus(
  conversationId: string
): Promise<MyRdvSignalementStatus> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("get_my_rdv_signalement_status", {
        p_conversation_id: conversationId,
      })
    ),
    AUTH_TIMEOUT_MS,
    "fetchMyRdvSignalementStatus"
  );

  if (error || !data) {
    return { has_signalement: false };
  }

  return data as MyRdvSignalementStatus;
}

// ── Erreurs ─────────────────────────────────────────────────────────────────

const RDV_ERRORS_FR: Record<string, string> = {
  not_authenticated: "Connecte-toi pour gérer le RDV.",
  not_participant: "Tu ne fais pas partie de cette conversation.",
  conversation_not_found: "Conversation introuvable.",
  lieu_required: "Indique un lieu de RDV.",
  lieu_too_long: "Le lieu doit faire 100 caractères max.",
  date_required: "Choisis une date pour le RDV.",
  date_too_soon: "Le RDV doit être au moins 30 minutes après maintenant.",
  rdv_already_confirmed:
    "Le RDV est déjà confirmé. Annule-le d'abord pour proposer une nouvelle date.",
  no_pending_rdv: "Aucune proposition de RDV en cours.",
  cannot_self_confirm:
    "Tu ne peux pas confirmer ta propre proposition. C'est à l'autre de la confirmer.",
  no_rdv_to_cancel: "Aucun RDV à annuler.",
  // Mig 86 — confirmation mutuelle post-RDV
  rencontre_required: "Choisis « Oui » ou « Non ».",
  no_confirmed_rdv: "Aucun RDV confirmé sur cette conversation.",
  rdv_not_past: "Le RDV n'a pas encore eu lieu.",
  rencontre_already_decided:
    "La décision est déjà prise — vous avez tous les deux répondu.",
  no_meeting_confirmed:
    "Tu dois d'abord confirmer la rencontre — et l'autre aussi.",
  meeting_not_confirmed_self:
    "Tu n'as pas encore confirmé que la rencontre a eu lieu.",
  meeting_declined_self:
    "Tu as dit que la rencontre n'a pas eu lieu — pas de notation possible.",
  meeting_disputed:
    "Désaccord sur la rencontre. Notation indisponible — utilise le signalement.",
};

const DEFAULT_FR = "Une erreur est survenue. Réessaie dans un instant.";
const TIMEOUT_FR = "Connexion lente. Vérifie ton réseau et réessaie.";
const NETWORK_FR = "Pas de connexion. Vérifie ton réseau et réessaie.";

/** Convertit un code d'erreur RPC RDV ou un Error JS → message FR. */
export function rdvErrorToFr(error: unknown): string {
  if (!error) return DEFAULT_FR;

  const msg =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : (error as { message?: string }).message;

  if (!msg) return DEFAULT_FR;

  if (RDV_ERRORS_FR[msg]) return RDV_ERRORS_FR[msg];

  const lower = msg.toLowerCase();
  if (lower.includes("timeout")) return TIMEOUT_FR;
  if (lower.includes("network") || lower.includes("fetch")) return NETWORK_FR;

  return DEFAULT_FR;
}

// ── RPC wrappers ────────────────────────────────────────────────────────────

interface RpcResult {
  success: boolean;
  error?: string;
  message?: string;
}

async function callRdvRpc(
  fnName: "propose_rdv" | "confirm_rdv" | "cancel_rdv" | "confirm_rencontre",
  params: Record<string, unknown>,
  label: string
): Promise<RpcResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc(fnName, params)),
    AUTH_TIMEOUT_MS,
    label
  );

  if (error) {
    return { success: false, error: error.message };
  }
  return data as RpcResult;
}

/**
 * Propose (ou re-propose) un RDV dans une conversation.
 * Si déjà confirmé, retourne `rdv_already_confirmed` — il faut annuler d'abord.
 */
export async function proposeRdv(
  conversationId: string,
  lieu: string,
  date: Date
): Promise<RpcResult> {
  return callRdvRpc(
    "propose_rdv",
    {
      p_conversation_id: conversationId,
      p_lieu: lieu,
      p_date: date.toISOString(),
    },
    "proposeRdv"
  );
}

/**
 * Confirme la proposition active.
 * Doit être appelé par l'AUTRE partie (pas le proposeur).
 */
export async function confirmRdv(conversationId: string): Promise<RpcResult> {
  return callRdvRpc(
    "confirm_rdv",
    { p_conversation_id: conversationId },
    "confirmRdv"
  );
}

/**
 * Annule un RDV (avant ou après confirmation).
 * Reset complet des colonnes rdv_lieu, rdv_date, rdv_propose_*, rdv_confirme_at.
 */
export async function cancelRdv(conversationId: string): Promise<RpcResult> {
  return callRdvRpc(
    "cancel_rdv",
    { p_conversation_id: conversationId },
    "cancelRdv"
  );
}

/**
 * Confirme la rencontre post-RDV (mig 86) — anti-fraude vendeur.
 *
 * Le caller dit oui (true) ou non (false). Quand les 2 parties ont répondu,
 * `rencontre_decided_at` est posé et un message système est inséré avec le verdict.
 *
 * Erreurs possibles : not_authenticated, not_participant, conversation_not_found,
 * rencontre_required, no_confirmed_rdv, rdv_not_past, rencontre_already_decided.
 */
export async function confirmRencontre(
  conversationId: string,
  rencontre: boolean
): Promise<RpcResult> {
  return callRdvRpc(
    "confirm_rencontre",
    { p_conversation_id: conversationId, p_rencontre: rencontre },
    "confirmRencontre"
  );
}
