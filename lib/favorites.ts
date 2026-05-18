import { supabase, withTimeout, AUTH_TIMEOUT_MS } from "@/lib/supabase";
import type { AnnonceListItem } from "@/lib/annonces";
import { getAnnoncePhotoUrl } from "@/lib/storage/annonces-photos";

// ── Types ───────────────────────────────────────────────────────────────────

interface FavoriRow {
  id: string;
  annonce_id: string;
  created_at: string;
}

// ── Cache mémoire des IDs favoris ───────────────────────────────────────────
// Évite un round-trip réseau à chaque render de card pour savoir si le cœur
// est plein ou vide. Hydraté au mount de la home, invalidé au toggle.

let favCache: Set<string> | null = null;
let favInflight: Promise<Set<string>> | null = null;

/**
 * Charge la liste des annonce_id favoris du user connecté. Cache mémoire
 * process-life, invalidé par toggleFavorite. Si pas connecté, retourne un
 * set vide (browse-first : le cœur est toujours vide pour les anonymes).
 */
export async function loadMyFavoriteIds(): Promise<Set<string>> {
  if (favCache) return favCache;
  if (favInflight) return favInflight;

  favInflight = (async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session?.user?.id) {
      favCache = new Set();
      return favCache;
    }

    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from("favoris")
          .select("annonce_id")
          .order("created_at", { ascending: false })
      ),
      AUTH_TIMEOUT_MS,
      "loadMyFavoriteIds"
    );

    if (error) {
      favCache = new Set();
      return favCache;
    }

    favCache = new Set(
      (data as { annonce_id: string }[]).map((r) => r.annonce_id)
    );
    return favCache;
  })();

  try {
    return await favInflight;
  } finally {
    favInflight = null;
  }
}

/** Vérifie si une annonce est en favori (synchrone après hydratation). */
export function isFavorite(annonceId: string): boolean {
  return favCache?.has(annonceId) ?? false;
}

/** Invalide le cache — appelé après signOut ou delete account. */
export function clearFavoritesCache(): void {
  favCache = null;
}

// ── Toggle ──────────────────────────────────────────────────────────────────

/**
 * Ajoute ou retire une annonce des favoris. Retourne le nouvel état (true =
 * favori, false = retiré). Met à jour le cache mémoire immédiatement
 * (optimistic UI).
 */
export async function toggleFavorite(annonceId: string): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  // Ensure cache is loaded
  await loadMyFavoriteIds();

  const isCurrentlyFav = favCache!.has(annonceId);

  if (isCurrentlyFav) {
    // Optimistic remove
    favCache!.delete(annonceId);

    const { error } = await supabase
      .from("favoris")
      .delete()
      .eq("user_id", userId)
      .eq("annonce_id", annonceId);

    if (error) {
      // Rollback
      favCache!.add(annonceId);
      throw new Error(error.message);
    }
    return false;
  } else {
    // Optimistic add
    favCache!.add(annonceId);

    const { error } = await supabase
      .from("favoris")
      .insert({ user_id: userId, annonce_id: annonceId });

    if (error) {
      // Rollback
      favCache!.delete(annonceId);
      throw new Error(error.message);
    }
    return true;
  }
}

// ── Fetch favoris complets (pour l'écran /profile/favorites) ────────────────

/**
 * Récupère les annonces favorites de l'user connecté avec leurs détails.
 * Jointure favoris → annonces pour obtenir les infos d'affichage.
 */
export async function fetchMyFavorites(): Promise<AnnonceListItem[]> {
  // SELECT inclut statut/type_offre/is_boosted/boost_until pour que la card
  // puisse afficher l'overlay "Plus disponible" sur les favoris non-actifs et
  // distinguer Location/Vente sur les favoris immobiliers (cohérence Home).
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("favoris")
        .select(
          "annonce_id, annonces:annonce_id (id, titre, prix, photos, ville, statut, created_at, type_offre, is_boosted, boost_until)"
        )
        .order("created_at", { ascending: false })
    ),
    AUTH_TIMEOUT_MS,
    "fetchMyFavorites"
  );

  if (error) throw new Error(error.message);
  if (!data) return [];

  interface JoinRow {
    annonce_id: string;
    annonces: {
      id: string;
      titre: string;
      prix: number | string;
      photos: string[];
      ville: string;
      statut: string;
      created_at: string;
      type_offre: AnnonceListItem["type_offre"];
      is_boosted: boolean | null;
      boost_until: string | null;
    } | null;
  }

  return (data as unknown as JoinRow[])
    .filter((row) => row.annonces !== null)
    .map((row) => {
      const a = row.annonces!;
      return {
        id: a.id,
        titre: a.titre,
        prix: typeof a.prix === "string" ? Number(a.prix) : a.prix,
        cover_url: getAnnoncePhotoUrl(a.photos[0] ?? ""),
        ville: a.ville,
        statut: a.statut as AnnonceListItem["statut"],
        created_at: a.created_at,
        type_offre: a.type_offre ?? null,
        is_boosted: a.is_boosted ?? false,
        boost_until: a.boost_until ?? null,
      };
    });
}
