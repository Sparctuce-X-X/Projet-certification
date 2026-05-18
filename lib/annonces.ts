import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import {
  AUTH_TIMEOUT_MS,
  supabase,
  withTimeout,
} from "@/lib/supabase";
import {
  compressPhoto,
  deleteAnnoncePhotosStrict,
  getAnnoncePhotoUrl,
  uploadAnnoncePhoto,
} from "@/lib/storage/annonces-photos";
import { moderateAnnonceText, moderateText } from "@/lib/moderation";

// ── Types ───────────────────────────────────────────────────────────────────

export type EtatObjet = "neuf" | "tres_bon" | "bon" | "moyen";

export type TypeBien =
  | "studio"
  | "appartement"
  | "maison"
  | "terrain"
  | "bureau"
  | "magasin"
  | "chambre";

export type TypeOffreImmo = "location" | "vente";

export type StatutAnnonce =
  | "active"
  | "en_cours"
  | "vendue"
  | "suspendue"
  | "expiree";

export type Pays = "CI" | "CG";

/**
 * Shape complet d'une annonce telle que persistée. Ce type matche ce que
 * PostgREST retourne sur `select *` (numeric → string côté JS pour préserver
 * la précision, mais les montants tiennent largement dans Number — on cast
 * au consommateur).
 */
export interface Annonce {
  id: string;
  vendeur_id: string;
  categorie_id: string;
  titre: string;
  description: string;
  prix: number;
  photos: string[];
  etat: EtatObjet | null;
  statut: StatutAnnonce;
  pays: Pays;
  ville: string;
  quartier: string | null;
  nb_vues: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
  // ── Immobilier (null si pas immobilier) ──
  type_bien: TypeBien | null;
  type_offre: TypeOffreImmo | null;
  surface_m2: number | null;
  nb_pieces: number | null;
  meuble: boolean | null;
  // ── Boost F09 ──
  is_boosted: boolean;
  boost_until: string | null;
}

/** Shape allégé pour les listings (home, search, profil vendeur). */
export interface AnnonceListItem {
  id: string;
  titre: string;
  prix: number;
  cover_url: string;
  ville: string;
  statut: StatutAnnonce;
  created_at: string;
  /** Immobilier : "location" ou "vente". Null si pas immobilier. */
  type_offre: TypeOffreImmo | null;
  /** F09 — true si boost actif (boost_until > now()) */
  is_boosted: boolean;
  /** F09 — date d'expiration du boost (null si jamais boostée) */
  boost_until: string | null;
}

export interface CreateAnnonceInput {
  titre: string;
  description: string;
  prix: number;
  categorie_id: string;
  etat: EtatObjet | null;
  ville: string;
  quartier: string | null;
  /** URIs locales (expo-image-picker). Min 1, max 5 — validé côté serveur aussi. */
  photoUris: string[];
  // ── Immobilier (optionnel) ──
  type_bien?: TypeBien | null;
  type_offre?: TypeOffreImmo | null;
  surface_m2?: number | null;
  nb_pieces?: number | null;
  meuble?: boolean | null;
}

export interface UpdateAnnoncePatch {
  titre?: string;
  description?: string;
  prix?: number;
  categorie_id?: string;
  etat?: EtatObjet | null;
  ville?: string;
  quartier?: string | null;
  /**
   * Si présent, remplace intégralement le tableau photos. Le caller doit
   * gérer l'upload des nouvelles photos + le delete des photos retirées
   * AVANT d'appeler updateAnnonce.
   */
  photos?: string[];
  // Immobilier
  type_bien?: TypeBien | null;
  type_offre?: TypeOffreImmo | null;
  surface_m2?: number | null;
  nb_pieces?: number | null;
  meuble?: boolean | null;
}

// ── Helpers internes ────────────────────────────────────────────────────────

const VIEWS_STORAGE_KEY = "niqo_viewed_annonces";

/**
 * Déduplique les vues d'annonces : 1 vue par user par annonce par jour.
 *
 * - User connecté : on stocke `{annonceId}:{YYYY-MM-DD}` dans AsyncStorage.
 *   Si déjà présent, on skip l'appel RPC. Reset quotidien naturel (la date
 *   change). On garde max 200 entrées pour limiter la taille du stockage.
 * - User anonyme : chaque vue compte (pas de dédup fiable sans session serveur).
 */
async function incrementViewIfNeeded(annonceId: string): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const isAuthenticated = !!sessionData.session?.user?.id;

    if (!isAuthenticated) {
      // Anonyme → toujours compter
      void Promise.resolve(
        supabase.rpc("fn_increment_views", { p_annonce_id: annonceId })
      ).catch(() => {});
      return;
    }

    // Connecté → dédup par jour
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const viewKey = `${annonceId}:${today}`;

    const raw = await AsyncStorage.getItem(VIEWS_STORAGE_KEY);
    const viewed: string[] = raw ? JSON.parse(raw) : [];

    if (viewed.includes(viewKey)) return; // déjà vu aujourd'hui

    // Appel RPC
    void Promise.resolve(
      supabase.rpc("fn_increment_views", { p_annonce_id: annonceId })
    ).catch(() => {});

    // Persist — garde les 200 dernières entrées (purge auto des vieux jours)
    const updated = [viewKey, ...viewed].slice(0, 200);
    await AsyncStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Fire-and-forget — une erreur ici ne doit jamais bloquer l'affichage
  }
}

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/**
 * Mappe une row PostgREST + sa colonne photos[] vers AnnonceListItem.
 * La cover est toujours photos[0] (cf. décision produit #2 — 1ère = cover).
 */
function toListItem(row: {
  id: string;
  titre: string;
  prix: number | string;
  photos: string[];
  ville: string;
  statut: StatutAnnonce;
  created_at: string;
  type_offre?: TypeOffreImmo | null;
  is_boosted?: boolean | null;
  boost_until?: string | null;
}): AnnonceListItem {
  return {
    id: row.id,
    titre: row.titre,
    prix: typeof row.prix === "string" ? Number(row.prix) : row.prix,
    cover_url: getAnnoncePhotoUrl(row.photos[0] ?? ""),
    ville: row.ville,
    statut: row.statut,
    created_at: row.created_at,
    type_offre: (row.type_offre as TypeOffreImmo) ?? null,
    is_boosted: row.is_boosted ?? false,
    boost_until: row.boost_until ?? null,
  };
}

// ── Création ────────────────────────────────────────────────────────────────

/**
 * Crée une annonce. Pipeline :
 *   1. Génère un UUID v4 client-side (besoin de l'id pour le path photos)
 *   2. Compresse + upload les photos en série dans `userId/annonceId/...`
 *   3. INSERT la row avec photos = paths uploadés
 *   4. Cleanup en cascade si l'INSERT échoue (RLS, rate limit, cap prix)
 *
 * Throw avec message FR mappé en cas d'erreur connue. Les erreurs DB
 * (rate_limit_announces, prix_cap_par_pays, photos_check, etc.) remontent
 * en clair pour mapping dans `lib/annonces/errors.ts` (à venir).
 */
export async function createAnnonce(
  input: CreateAnnonceInput
): Promise<Annonce> {
  const userId = await getCurrentUserId();

  if (input.photoUris.length === 0) {
    throw new Error("Au moins une photo est requise");
  }
  if (input.photoUris.length > 5) {
    throw new Error("5 photos maximum par annonce");
  }

  // Modération couche 2 (OpenAI Moderation) sur titre+description AVANT
  // upload photo — fail fast pour éviter d'uploader 5 photos si le texte
  // est refusé. La couche 1 mots_interdits reste enforced côté trigger DB
  // sur l'INSERT (defense in depth, non bypassable).
  const moderation = await moderateAnnonceText({
    titre: input.titre,
    description: input.description,
    surface: "annonce.create",
  });
  if (!moderation.ok) {
    // Marqueur 'moderation_blocked:' reconnu par annonceErrorToFr pour
    // passer le hint OpenAI au user sans le remapper en générique.
    throw new Error(
      `moderation_blocked: ${moderation.hint ?? "Le contenu de l'annonce n'est pas autorisé."}`,
    );
  }

  // UUID v4 généré côté client — Supabase Storage a besoin du `annonceId`
  // dans le path AVANT l'INSERT. expo-crypto.randomUUID() est crypto-grade
  // et stable sur Hermes (vs `crypto.randomUUID` du runtime qui n'existe pas
  // sur certains targets RN).
  const annonceId = Crypto.randomUUID();

  // Upload séquentiel — préfère séquentiel à parallèle pour économiser RAM
  // sur les baseline Tecno/Itel (decodage simultané de 5 JPEG = OOM possible).
  const uploadedPaths: string[] = [];
  try {
    for (const localUri of input.photoUris) {
      const compressed = await compressPhoto(localUri);
      const { path } = await uploadAnnoncePhoto(compressed.uri, annonceId);
      uploadedPaths.push(path);
    }

    // INSERT — `id` est imposé par le client (cohérent avec les paths déjà
    // uploadés). `pays` est ignoré : le trigger `inherit_pays_from_user`
    // l'écrase avec users.pays côté serveur. `expires_at` idem (trigger
    // set_expires_at calcule created_at + 60j).
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from("annonces")
          .insert({
            id: annonceId,
            vendeur_id: userId,
            titre: input.titre.trim(),
            description: input.description.trim(),
            prix: input.prix,
            categorie_id: input.categorie_id,
            etat: input.etat,
            ville: input.ville.trim(),
            quartier: input.quartier?.trim() || null,
            photos: uploadedPaths,
            // Immobilier (null si pas immobilier)
            type_bien: input.type_bien ?? null,
            type_offre: input.type_offre ?? null,
            surface_m2: input.surface_m2 ?? null,
            nb_pieces: input.nb_pieces ?? null,
            meuble: input.meuble ?? null,
            // pays : trigger inherit_pays_from_user l'écrase avec users.pays
            pays: "CI" as Pays,
            // expires_at : placeholder requis (colonne NOT NULL). Le trigger
            // set_annonces_expires_at DEVRAIT l'écraser, mais actuellement
            // il ne le fait que si null. TODO: fix trigger pour forcer
            // created_at + 60j systématiquement. En attendant, le client
            // envoie un placeholder calculé localement.
            expires_at: new Date(Date.now() + 60 * 86400 * 1000).toISOString(),
          })
          .select("*")
          .single()
      ),
      AUTH_TIMEOUT_MS,
      "createAnnonce.insert"
    );

    if (error) throw new Error(error.message);
    return data as Annonce;
  } catch (err) {
    // Cleanup best-effort — si l'INSERT échoue après quelques uploads
    // réussis, on purge pour éviter les photos orphelines.
    if (uploadedPaths.length > 0) {
      try {
        await deleteAnnoncePhotosStrict(uploadedPaths);
      } catch {
        // Bloat toléré — l'erreur principale (l'INSERT) est plus importante.
      }
    }
    throw err;
  }
}

// ── Lecture ─────────────────────────────────────────────────────────────────

export type SortOrder = "recent" | "price_asc" | "price_desc";

export interface FetchAnnoncesArgs {
  pays: Pays;
  categorieId?: string;
  ville?: string;
  /** Recherche full-text simple (ilike sur titre + description). */
  search?: string;
  /** Pagination cursor : `created_at` de la dernière annonce reçue. */
  cursor?: string;
  /** Default 20. */
  limit?: number;
  /** Filtre par vendeur — pour le profil public `/u/[id]`. */
  vendeurId?: string;
  /** Tri. Default "recent" (created_at desc). */
  sort?: SortOrder;
  /** Filtre immobilier — type d'offre (location/vente) */
  typeOffre?: TypeOffreImmo;
  /** Filtre immobilier — type de bien */
  typeBien?: TypeBien;
  /** true = uniquement les annonces immobilier (type_bien IS NOT NULL) */
  immoOnly?: boolean;
  /** true = exclure les annonces immobilier (type_bien IS NULL) */
  excludeImmo?: boolean;
  /** Filtre immobilier — nombre de pièces */
  nbPieces?: number;
  /** Filtre immobilier — meublé */
  meuble?: boolean;
  /** Prix minimum */
  prixMin?: number;
  /** Prix maximum */
  prixMax?: number;
  /** Surface minimum m² */
  surfaceMin?: number;
  /** Surface maximum m² */
  surfaceMax?: number;
  /** Filtre par état de l'objet */
  etat?: EtatObjet;
  /** UUIDs de vendeurs à exclure (annonces du users bloqués — mig 129).
      Apple Guideline 1.2 UGC : "remove blocked user's content from the feed
      instantly". Filtré côté serveur via .not('vendeur_id', 'in', ...). */
  excludeVendeurIds?: string[];
}

/**
 * Liste paginée d'annonces actives (RLS gate). Pagination cursor-based sur
 * `created_at desc` pour rester stable même quand de nouvelles annonces
 * arrivent en tête (offset-based cause des doublons/sauts).
 */
export async function fetchAnnonces(
  args: FetchAnnoncesArgs
): Promise<AnnonceListItem[]> {
  const limit = args.limit ?? 20;

  const sort = args.sort ?? "recent";

  let query = supabase
    .from("annonces")
    .select(
      "id, titre, prix, photos, ville, statut, created_at, type_offre, is_boosted, boost_until"
    )
    .eq("pays", args.pays)
    .eq("statut", "active")
    .limit(limit);

  // Tri F09 — boost actif TOUJOURS en premier (peu importe le sort utilisateur).
  // Pattern marketplaces (Vinted, eBay) : le boost paie pour la position. Le
  // sub-tri choisi par l'user s'applique ensuite (récent / prix asc / prix desc).
  query = query
    .order("is_boosted", { ascending: false })
    .order("boost_until", { ascending: false, nullsFirst: false });

  // Tri — le cursor pagination ne fonctionne qu'avec "recent" (created_at).
  // Pour prix asc/desc, on reset le cursor (offset pagination implicite via
  // limit, acceptable MVP car les utilisateurs scrollent rarement > 100 items
  // en mode tri prix).
  if (sort === "price_asc") {
    query = query.order("prix", { ascending: true });
  } else if (sort === "price_desc") {
    query = query.order("prix", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  if (args.categorieId) query = query.eq("categorie_id", args.categorieId);
  if (args.ville) query = query.eq("ville", args.ville);
  if (args.vendeurId) query = query.eq("vendeur_id", args.vendeurId);
  if (args.immoOnly) query = query.not("type_bien", "is", null);
  if (args.excludeImmo) query = query.is("type_bien", null);
  if (args.typeOffre) query = query.eq("type_offre", args.typeOffre);
  if (args.typeBien) query = query.eq("type_bien", args.typeBien);
  if (args.nbPieces) query = query.eq("nb_pieces", args.nbPieces);
  if (args.meuble !== undefined) query = query.eq("meuble", args.meuble);
  if (args.prixMin) query = query.gte("prix", args.prixMin);
  if (args.prixMax) query = query.lte("prix", args.prixMax);
  if (args.surfaceMin) query = query.gte("surface_m2", args.surfaceMin);
  if (args.surfaceMax) query = query.lte("surface_m2", args.surfaceMax);
  if (args.etat) query = query.eq("etat", args.etat);
  if (args.excludeVendeurIds && args.excludeVendeurIds.length > 0) {
    // PostgREST `not.in.(uuid1,uuid2)` — masque les annonces des users bloqués
    // pour l'utilisateur courant (mig 129, Apple Guideline 1.2 UGC).
    query = query.not(
      "vendeur_id",
      "in",
      `(${args.excludeVendeurIds.join(",")})`
    );
  }
  if (args.search) {
    // Échappe les wildcards Postgres pour éviter qu'un user injecte `%` qui
    // matcherait tout. ilike est case-insensitive.
    const escaped = args.search.trim().replace(/[%_]/g, "\\$&");
    query = query.or(
      `titre.ilike.%${escaped}%,description.ilike.%${escaped}%`
    );
  }
  if (args.cursor && sort === "recent") {
    query = query.lt("created_at", args.cursor);
  }

  const { data, error } = await withTimeout(
    Promise.resolve(query),
    AUTH_TIMEOUT_MS,
    "fetchAnnonces"
  );

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) =>
    toListItem(row as Parameters<typeof toListItem>[0])
  );
}

/**
 * Détail complet d'une annonce + increment atomique des vues côté serveur.
 * Increment fire-and-forget : on n'attend pas la réponse pour ne pas bloquer
 * le rendu de la page (les vues comptent même pour anon, cf. RPC mig 16).
 */
export async function fetchAnnonceById(id: string): Promise<Annonce | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.from("annonces").select("*").eq("id", id).maybeSingle()
    ),
    AUTH_TIMEOUT_MS,
    "fetchAnnonceById"
  );

  if (error) throw new Error(error.message);
  if (!data) return null;

  // Increment views — modèle Vinted : 1 vue par user par annonce par jour.
  // Users connectés : dédupliqué via AsyncStorage (clé = annonce_id + date).
  // Users anonymes : chaque vue compte (pas de moyen fiable de dédupliquer).
  void incrementViewIfNeeded(id);

  return data as Annonce;
}

/**
 * Toutes les annonces du user authentifié (RLS owner_select_own gate). Pour
 * `/profile/announces`. Ordre : created_at desc.
 */
export async function fetchMyAnnonces(args?: {
  statut?: StatutAnnonce;
}): Promise<Annonce[]> {
  const userId = await getCurrentUserId();
  let query = supabase
    .from("annonces")
    .select("*")
    .eq("vendeur_id", userId)
    .order("created_at", { ascending: false });

  if (args?.statut) query = query.eq("statut", args.statut);

  const { data, error } = await withTimeout(
    Promise.resolve(query),
    AUTH_TIMEOUT_MS,
    "fetchMyAnnonces"
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as Annonce[];
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Update partiel via PostgREST. RLS `annonces_owner_update` gate l'accès :
 *   - vendeur_id = auth.uid()
 *   - statut = 'active' (impossible d'éditer en_cours/vendue/expiree/suspendue)
 *
 * Returns la row mise à jour.
 */
export async function updateAnnonce(
  id: string,
  patch: UpdateAnnoncePatch
): Promise<Annonce> {
  if (Object.keys(patch).length === 0) {
    throw new Error("Patch vide");
  }

  // Trim côté client pour éviter les whitespace-only updates qui passeraient
  // les check constraints (`char_length(titre) between 3 and 50` accepte
  // "   " si on ne trim pas).
  const cleanPatch: UpdateAnnoncePatch = { ...patch };
  if (cleanPatch.titre !== undefined) cleanPatch.titre = cleanPatch.titre.trim();
  if (cleanPatch.description !== undefined)
    cleanPatch.description = cleanPatch.description.trim();
  if (cleanPatch.ville !== undefined) cleanPatch.ville = cleanPatch.ville.trim();
  if (cleanPatch.quartier !== undefined && cleanPatch.quartier !== null)
    cleanPatch.quartier = cleanPatch.quartier.trim() || null;

  // Modération couche 2 sur titre/description si patché. La couche 1
  // mots_interdits reste enforced sur UPDATE côté trigger DB.
  if (cleanPatch.titre !== undefined || cleanPatch.description !== undefined) {
    const moderation = await moderateText({
      texte: [cleanPatch.titre, cleanPatch.description]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join("\n\n"),
      surface: "annonce.update",
    });
    if (!moderation.ok) {
      throw new Error(
        `moderation_blocked: ${moderation.hint ?? "Le contenu modifié n'est pas autorisé."}`,
      );
    }
  }

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("annonces")
        .update(cleanPatch)
        .eq("id", id)
        .select("*")
        .single()
    ),
    AUTH_TIMEOUT_MS,
    "updateAnnonce"
  );

  if (error) throw new Error(error.message);
  return data as Annonce;
}

/**
 * Supprime une annonce. RLS gate :
 *   - vendeur_id = auth.uid()
 *   - statut in ('active', 'expiree', 'suspendue') — pas de delete pendant
 *     transaction
 *
 * Cleanup des photos en cascade. Si le DELETE DB échoue, les photos restent
 * (best practice : DB est source de vérité, cleanup storage suit).
 */
export async function deleteAnnonce(id: string): Promise<void> {
  // 1. Récupère les paths photos AVANT delete (sinon plus moyen de les lire
  //    après que la row est partie).
  const { data: existing, error: fetchError } = await withTimeout(
    Promise.resolve(
      supabase.from("annonces").select("photos").eq("id", id).maybeSingle()
    ),
    AUTH_TIMEOUT_MS,
    "deleteAnnonce.fetch"
  );

  if (fetchError) throw new Error(fetchError.message);
  if (!existing) {
    throw new Error("Annonce introuvable");
  }

  // 2. DELETE row — RLS gate
  const { error: deleteError } = await withTimeout(
    Promise.resolve(supabase.from("annonces").delete().eq("id", id)),
    AUTH_TIMEOUT_MS,
    "deleteAnnonce.delete"
  );

  if (deleteError) throw new Error(deleteError.message);

  // 3. Cleanup photos best-effort. Si ça plante, photos orphelines mais
  //    DB cohérente — un futur sweep les rattrapera.
  const photos = (existing as { photos: string[] }).photos;
  if (photos && photos.length > 0) {
    try {
      await deleteAnnoncePhotosStrict(photos);
    } catch {
      // bloat toléré
    }
  }
}

/**
 * Réactive une annonce expirée dans la fenêtre de 28j post-expiration.
 * Retourne le résultat jsonb de la RPC fn_prolonger_annonce :
 *   - { success: true, new_expires_at: <iso> }
 *   - { success: false, error: 'not_owner' | 'not_expired' | 'window_closed' | 'not_found' | 'not_authenticated', deadline?: <iso> }
 */
export interface ProlongationResult {
  success: boolean;
  error?: string;
  new_expires_at?: string;
  deadline?: string;
}

export async function prolongerAnnonce(
  id: string
): Promise<ProlongationResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc("fn_prolonger_annonce", { p_annonce_id: id })),
    AUTH_TIMEOUT_MS,
    "prolongerAnnonce"
  );

  if (error) throw new Error(error.message);
  return (data as ProlongationResult) ?? { success: false, error: "unknown" };
}
