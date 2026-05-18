import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

import type { Pays } from "@/lib/annonces";
import type { AvisWithAuteur } from "@/lib/notation";

/**
 * Seuils du badge "Vendeur fiable" — anneau vert + CheckCircle2 autour de
 * l'avatar. Statut purement visuel, sans effet business (pas de boost de
 * ranking, pas de cap d'annonces). À distinguer de `is_verified` (CNI payée)
 * qui débloque les annonces > 3.
 */
export const TRUSTED_SELLER_THRESHOLDS = {
  minVentes: 5,
  minNote: 4.0,
} as const;

/**
 * Nombre minimum de ventes/achats avant d'afficher une note moyenne.
 * En dessous, la note n'est pas représentative (1 vente = 1 avis = manipulable
 * via fraude amis-pour-amis). Utilisé sur `/u/[id]` ET `/profile` pour rester
 * cohérent : un user voit "—" sur son profil si un acheteur le verra "—" aussi.
 */
export const MIN_VENTES_FOR_NOTE = 3;
export const MIN_ACHATS_FOR_NOTE = 3;

export function isTrustedSeller(
  nbVentes: number,
  noteVendeur: number
): boolean {
  return (
    nbVentes >= TRUSTED_SELLER_THRESHOLDS.minVentes &&
    noteVendeur >= TRUSTED_SELLER_THRESHOLDS.minNote
  );
}

/**
 * Shape exposé par la RPC `get_user_public_profile` (cf. migrations 16 + 37).
 *
 * Volontairement minimaliste — pas d'email, pas de téléphone, pas de
 * quartier précis (privacy). `nom_initial` est calculé server-side
 * (première lettre + ".") pour que le client n'ait jamais le nom complet
 * d'un user qui n'est pas lui-même.
 */
export interface PublicUserProfile {
  id: string;
  prenom: string;
  nom_initial: string;
  avatar_url: string | null;
  pays: Pays;
  ville: string;
  /** 0 si jamais noté. Affiche les étoiles seulement si nb_ventes >= 3. */
  note_vendeur: number;
  nb_ventes: number;
  /** Côté acheteur (mig 37). 0 si jamais noté. */
  note_acheteur: number;
  nb_achats: number;
  /** Badge "Vendeur Vérifié" (KYC payé + admin validé). Mig 51 — inline coral. */
  is_verified: boolean;
  /** Top 10 des avis reçus, triés par created_at desc (mig 37). */
  recent_avis: AvisWithAuteur[];
  /** ISO timestamp — pour afficher "Membre depuis avril 2026". */
  created_at: string;
}

/**
 * Récupère le profil public d'un utilisateur (page `/u/[id]`). Accessible
 * anon (browse-first). Retourne null si user introuvable ou suspendu
 * (`is_active = false`). La RPC SECURITY DEFINER server-side fait le filtre
 * colonne-par-colonne — on n'expose pas la table users elle-même.
 *
 * ⚠️ Postgres `numeric` est sérialisé en string par Supabase/PostgREST
 * (préserve la précision). On convertit `note_*` et `nb_*` en number ici
 * pour que les consommateurs puissent appeler `.toFixed()` / comparer
 * naturellement.
 */
export async function fetchPublicUserProfile(
  userId: string
): Promise<PublicUserProfile | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("get_user_public_profile", { p_user_id: userId })
    ),
    AUTH_TIMEOUT_MS,
    "fetchPublicUserProfile"
  );

  if (error) throw new Error(error.message);
  if (!data) return null;

  const raw = data as Record<string, unknown>;
  return {
    ...(raw as unknown as PublicUserProfile),
    note_vendeur: Number(raw.note_vendeur ?? 0),
    nb_ventes: Number(raw.nb_ventes ?? 0),
    note_acheteur: Number(raw.note_acheteur ?? 0),
    nb_achats: Number(raw.nb_achats ?? 0),
  };
}
