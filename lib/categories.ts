import {
  Baby,
  BookOpen,
  Building2,
  Car,
  Dumbbell,
  Home,
  Monitor,
  Package,
  Shirt,
  Smartphone,
  Sparkles,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { supabase, withTimeout, AUTH_TIMEOUT_MS } from "@/lib/supabase";

export interface Category {
  id: string;
  nom: string;
  icone: string;
  ordre: number;
}

/**
 * Map nom-icône-Lucide-en-DB → composant Lucide. Doit rester en phase avec
 * la colonne `categories.icone` (cf. migration 13). Si la DB renvoie un nom
 * absent de la map, `getCategoryIcon` retourne `Package` (fallback neutre)
 * et logge un warn — préférable à un crash, mais signal clair que la map
 * doit être mise à jour.
 *
 * CDC v4.0 : Véhicules ajouté (plus de plafond Mobile Money — modèle hors transaction).
 */
const ICON_MAP: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  shirt: Shirt,
  monitor: Monitor,
  home: Home,
  "building-2": Building2,
  car: Car,
  sparkles: Sparkles,
  dumbbell: Dumbbell,
  "book-open": BookOpen,
  baby: Baby,
  package: Package,
};

export function getCategoryIcon(icone: string): LucideIcon {
  const Icon = ICON_MAP[icone];
  if (!Icon) {
    console.warn(
      `[categories] Icon "${icone}" not in ICON_MAP. Add it to lib/categories.ts`
    );
    return Package;
  }
  return Icon;
}

// Cache process-life. Les catégories changent ~jamais (admin-only via
// migration), pas de TTL court ni de persistance AsyncStorage : un cold-start
// = un fetch, c'est négligeable. `null` = pas encore fetché.
let cache: Category[] | null = null;
let inflight: Promise<Category[]> | null = null;

/**
 * Récupère les catégories actives, ordonnées par `ordre asc`. Cache mémoire
 * process-life. Les fetchs concurrents partagent une seule promesse (anti
 * thundering-herd au mount des écrans home + search en parallèle).
 *
 * Throw en cas d'erreur réseau / Supabase — le caller affiche un fallback.
 */
export async function fetchCategories(): Promise<Category[]> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    // PostgREST query builder est un thenable (pas un Promise) — on le
    // matérialise via Promise.resolve pour satisfaire la signature de
    // withTimeout<T>(promise: Promise<T>, ...).
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from("categories")
          .select("id, nom, icone, ordre")
          .eq("is_active", true)
          .order("ordre", { ascending: true })
      ),
      AUTH_TIMEOUT_MS,
      "fetchCategories"
    );

    if (error) throw new Error(error.message);

    cache = (data ?? []) as Category[];
    return cache;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Vide le cache — utile pour les tests ou un futur bouton de refresh admin.
 * Pas exposé en UI MVP.
 */
export function clearCategoriesCache(): void {
  cache = null;
}
