/**
 * Module Mes achats — liste des RDV passés où l'utilisateur est acheteur.
 *
 * Source : conversations dont :
 *   - rdv_confirme_at IS NOT NULL  (RDV confirmé)
 *   - rdv_annule_par IS NULL       (pas annulé après confirmation, mig 87)
 *   - rdv_date < now()             (RDV dans le passé)
 *   - rencontre_acheteur != false  (acheteur pas explicitement "non" → exclut
 *                                   no-show acheteur ET unconfirmed mig 86)
 *
 * Le state machine `rencontre_acheteur × rencontre_vendeur` est dérivé en :
 *   - "met"      : acheteur=true ET vendeur != false → vente OK, notation possible
 *   - "disputed" : acheteur=true ET vendeur=false    → désaccord, à signaler
 *   - "pending"  : acheteur=null                     → invite à confirmer
 *
 * ⚠ Mode immo (mig 100) : pas de RDV en immo → AUCUN achat immo n'apparaît
 *    ici. Tracé impossible côté Niqo (hors paiement immobilier). Trou
 *    fonctionnel assumé pour MVP.
 *
 * ⚠ Désynchro avec `users.nb_achats` (compteur profil public) : ce dernier
 *    est calculé depuis les `avis` reçus en tant qu'acheteur (mig 38, 42).
 *    Soit, nb_achats = transactions où le vendeur t'a noté.
 *    "Mes achats" inclut potentiellement plus (= rencontre confirmée mais
 *    vendeur n'a pas encore noté). Différence acceptable :
 *      Mes achats ≥ users.nb_achats (toujours).
 *
 * Joins annonces + users + avis.
 */

import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";
import { getAnnoncePhotoUrl } from "@/lib/storage/annonces-photos";
import { fetchPublicUserProfile } from "@/lib/users";

// ── Types ───────────────────────────────────────────────────────────────────

/** État dérivé du tuple (rencontre_acheteur, rencontre_vendeur) post-RDV.
 *  Cf. mig 86 + 88. */
export type AchatRencontreState = "met" | "disputed" | "pending";

export interface MyAchat {
  conversation_id: string;
  rdv_date: string;
  rdv_lieu: string | null;

  /** État dérivé post-RDV (mig 86 + 88). UI adapte le footer en conséquence. */
  rencontre_state: AchatRencontreState;

  /** Annonce associée — peut être null si l'annonce a été purgée. */
  annonce_id: string | null;
  annonce_titre: string;
  annonce_cover_url: string;
  annonce_prix: number | null;
  annonce_ville: string | null;

  /** Vendeur (l'autre partie). */
  vendeur_id: string;
  vendeur_prenom: string;
  vendeur_avatar_url: string | null;
  /** True si le compte vendeur a été supprimé / introuvable (RGPD). */
  vendeur_deleted: boolean;

  /** Mon avis sur ce RDV — null si je n'ai pas encore noté.
   *  L'UI ne montre le bouton "Noter" que si rencontre_state="met" ET null. */
  my_avis_note: number | null;
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/**
 * Récupère mes achats : conversations où je suis acheteur, RDV confirmé,
 * non annulé, passé, et avec rencontre acheteur != false (= pas no-show
 * acheteur, pas unconfirmed mig 86).
 *
 * Retourné triés par rdv_date desc (le plus récent en premier).
 */
export async function fetchMyAchats(): Promise<MyAchat[]> {
  const userId = await getCurrentUserId();
  const now = new Date().toISOString();

  // 1. Fetch conversations + annonce
  // Filtres :
  //   - acheteur_id = me
  //   - rdv_confirme_at != null    (RDV confirmé)
  //   - rdv_annule_par IS NULL     (mig 87 — exclut RDV annulés post-confirm)
  //   - rdv_date < now             (passé)
  //   - rencontre_acheteur != false (mig 86 — exclut "non" acheteur, garde
  //                                  true et null pour pouvoir afficher
  //                                  l'invite "Confirme la rencontre")
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("conversations")
        .select(
          `id, rdv_date, rdv_lieu, vendeur_id, annonce_id,
           rencontre_acheteur, rencontre_vendeur,
           annonces:annonce_id (titre, photos, prix, ville)`
        )
        .eq("acheteur_id", userId)
        .not("rdv_confirme_at", "is", null)
        .is("rdv_annule_par", null)
        .lt("rdv_date", now)
        .not("rencontre_acheteur", "is", false)
        .order("rdv_date", { ascending: false })
    ),
    AUTH_TIMEOUT_MS,
    "fetchMyAchats"
  );

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  type Row = {
    id: string;
    rdv_date: string;
    rdv_lieu: string | null;
    vendeur_id: string;
    annonce_id: string | null;
    rencontre_acheteur: boolean | null;
    rencontre_vendeur: boolean | null;
    annonces:
      | { titre: string; photos: string[]; prix: number; ville: string }
      | { titre: string; photos: string[]; prix: number; ville: string }[]
      | null;
  };
  const rows = data as unknown as Row[];

  // 2. Fetch vendor profiles
  const vendeurIds = [...new Set(rows.map((r) => r.vendeur_id))];
  const profileMap: Record<
    string,
    { prenom: string; avatar_url: string | null }
  > = {};
  await Promise.all(
    vendeurIds.map(async (uid) => {
      try {
        const p = await fetchPublicUserProfile(uid);
        if (p) profileMap[uid] = { prenom: p.prenom, avatar_url: p.avatar_url };
      } catch {
        // silent
      }
    })
  );

  // 3. Fetch mes avis sur ces conversations (note = 1-5)
  const convIds = rows.map((r) => r.id);
  const { data: avisData } = await supabase
    .from("avis")
    .select("conversation_id, note")
    .in("conversation_id", convIds)
    .eq("auteur_id", userId);

  const avisMap: Record<string, number> = {};
  for (const a of (avisData ?? []) as { conversation_id: string; note: number }[]) {
    avisMap[a.conversation_id] = a.note;
  }

  // 4. Assemble
  return rows.map((r) => {
    const annonce = Array.isArray(r.annonces) ? r.annonces[0] : r.annonces;
    const vendor = profileMap[r.vendeur_id];
    // État rencontre dérivé (filtre rencontre_acheteur != false déjà appliqué)
    //   - acheteur=true ET vendeur != false → met (vente OK, notation possible)
    //   - acheteur=true ET vendeur=false    → disputed (à signaler)
    //   - acheteur=null                     → pending (invite à confirmer)
    const rencontre_state: AchatRencontreState =
      r.rencontre_acheteur === true
        ? r.rencontre_vendeur === false
          ? "disputed"
          : "met"
        : "pending";

    return {
      conversation_id: r.id,
      rdv_date: r.rdv_date,
      rdv_lieu: r.rdv_lieu,
      rencontre_state,
      annonce_id: r.annonce_id,
      annonce_titre: annonce?.titre ?? "Annonce supprimée",
      annonce_cover_url: annonce?.photos?.[0]
        ? getAnnoncePhotoUrl(annonce.photos[0])
        : "",
      annonce_prix: annonce?.prix ?? null,
      annonce_ville: annonce?.ville ?? null,
      vendeur_id: r.vendeur_id,
      vendeur_prenom: vendor?.prenom ?? "Compte supprimé",
      vendeur_avatar_url: vendor?.avatar_url ?? null,
      vendeur_deleted: !vendor,
      my_avis_note: avisMap[r.id] ?? null,
    };
  });
}
