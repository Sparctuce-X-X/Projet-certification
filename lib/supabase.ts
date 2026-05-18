// Polyfill MUST come before @supabase/supabase-js — Supabase v2 utilise
// URL.createObjectURL/blob qui n'existent pas dans le runtime Hermes (RN).
import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail-loud au load du module — préférable à un 401 silencieux au premier
  // appel d'auth dans le flow utilisateur.
  throw new Error(
    "Supabase env manquantes. Crée /workspaces/niqo/.env.local avec EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY (cf. CLAUDE.md §Environment variables)."
  );
}

// Web SSR (Expo Router static export) runs this module in Node — pas de
// `window`, donc AsyncStorage (qui se rabat sur localStorage) crash. On
// court-circuite avec un no-op storage : la session ne peut pas être
// persistée pendant le rendu Node, ce qui est attendu (l'auth s'hydrate
// côté client après hydration React).
const isSSR = Platform.OS === "web" && typeof window === "undefined";

// SecureStore = Keychain iOS / Keystore Android, AES hardware-backed.
// Fallback AsyncStorage si SecureStore plante (très vieux Android sans
// keystore, ou web browser où SecureStore n'existe pas) — préférable à
// crash. En web browser, AsyncStorage utilise window.localStorage.
const SecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (isSSR) return null;
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (isSSR) return;
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },
  async removeItem(key: string): Promise<void> {
    if (isSSR) return;
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      await AsyncStorage.removeItem(key);
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // Web only — pas de window.location en RN, on parse le deep link nous-mêmes.
    detectSessionInUrl: false,
    // PKCE — best practice OAuth pour clients publics. Le redirect porte un
    // code (qu'on échange via exchangeCodeForSession), pas un access token.
    flowType: "pkce",
  },
});

/**
 * Wrap an async op with a timeout. Throws `Error("Timeout: <label>")` if the
 * promise doesn't settle within `ms`. Used for auth network calls — on flaky
 * 4G in CI/CG, Supabase fetches can hang silently. 15s is a deliberate
 * "trust the user's patience but cap it" value.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    }),
  ]);
}

export const AUTH_TIMEOUT_MS = 15_000;

// Type helper pour les rows public.users (à étendre au fur et à mesure).
//
// Note : la colonne `telephone bytea` (chiffrée Vault, cf. migration 02) n'est
// PAS exposée ici en clair — la lire via REST retournerait du bytea
// inutilisable. Pour récupérer le téléphone décrypté, appeler la RPC
// `get_my_phone()` :
//
//   const { data } = await supabase.rpc("get_my_phone");
//   // data: string | null
//
// `has_phone` (boolean dérivé via la vue `users_self`) sert au gating
// "needsProfileCompletion" sans déchiffrer la valeur.
export interface PublicUser {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  pays: "CI" | "CG";
  ville: string;
  quartier: string | null;
  /**
   * `true` si la colonne `telephone bytea` est non-null. Calculé côté client
   * via `(telephone as bytea | null) !== null`. Utilisé pour détecter les
   * profils OAuth incomplets (telephone IS NULL → forcer complete-profile).
   */
  has_phone: boolean;
  auth_provider: "google" | "apple" | "email";
  note_vendeur: number;
  note_acheteur: number;
  nb_ventes: number;
  nb_achats: number;
  score_abus: number;
  avatar_url: string | null;
  is_active: boolean;
  /** Badge Vendeur Vérifié (mig 45). True après validation admin du KYC F07. */
  is_verified: boolean;
  /** ISO timestamp du paiement vérification approuvé (mig 45). */
  verification_paid_at: string | null;
  /** Flag back-office admin (mig 44). True uniquement pour le fondateur. */
  is_admin: boolean;
  cgu_accepted_at: string | null;
  cgu_version: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Récupère le téléphone décrypté de l'user authentifié (auth.uid()).
 * Renvoie null si pas de téléphone ou si pas authentifié.
 */
export async function getMyPhone(): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_my_phone");
  if (error) return null;
  return (data as string | null) ?? null;
}

/**
 * Complète le profil de l'user authentifié — appelé après signup OAuth
 * (Google/Apple) qui ne collecte pas telephone/quartier. Encrypte le téléphone
 * server-side via la RPC SECURITY DEFINER (la clé Vault ne quitte pas Postgres).
 *
 * @param ville     non-vide
 * @param quartier  optionnel (null si vide)
 * @param telephone E.164 (ex: "+22507123456789")
 *
 * Throw en cas d'erreur — le caller doit gérer l'affichage.
 */
export async function completeMyProfile(args: {
  ville: string;
  quartier: string | null;
  telephone: string;
  pays?: "CI" | "CG";
  prenom?: string;
  nom?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("complete_my_profile", {
    p_ville: args.ville,
    p_quartier: args.quartier,
    p_telephone: args.telephone,
    p_pays: args.pays ?? null,
    p_prenom: args.prenom ?? null,
    p_nom: args.nom ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Purge tous les fichiers d'un user dans un bucket Storage.
 * Gère la structure plate (avatars/{userId}/file) et imbriquée
 * (annonces-photos/{userId}/{annonceId}/file) via listing récursif
 * des sous-dossiers.
 *
 * Throw si la purge échoue — le caller doit abort le delete compte
 * (mieux vaut un compte vivant que des PII orphelines sur le CDN).
 */
async function purgeUserBucket(
  bucket: string,
  userId: string
): Promise<void> {
  const { data: entries, error: listError } = await supabase.storage
    .from(bucket)
    .list(userId);
  if (listError) throw new Error(`Storage cleanup (${bucket}): ${listError.message}`);
  if (!entries || entries.length === 0) return;

  // Sépare fichiers et sous-dossiers. Supabase Storage list() retourne
  // des FileObject avec `id: null` pour les dossiers virtuels.
  const files = entries.filter((e) => e.id !== null);
  const folders = entries.filter((e) => e.id === null);

  // Supprimer les fichiers directs
  if (files.length > 0) {
    const paths = files.map((f) => `${userId}/${f.name}`);
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw new Error(`Storage cleanup (${bucket}): ${error.message}`);
  }

  // Récurser dans les sous-dossiers (annonces-photos/{userId}/{annonceId}/)
  for (const folder of folders) {
    const folderPath = `${userId}/${folder.name}`;
    const { data: subFiles, error: subErr } = await supabase.storage
      .from(bucket)
      .list(folderPath);
    if (subErr) throw new Error(`Storage cleanup (${bucket}): ${subErr.message}`);
    if (subFiles && subFiles.length > 0) {
      const subPaths = subFiles
        .filter((f) => f.id !== null)
        .map((f) => `${folderPath}/${f.name}`);
      if (subPaths.length > 0) {
        const { error } = await supabase.storage.from(bucket).remove(subPaths);
        if (error) throw new Error(`Storage cleanup (${bucket}): ${error.message}`);
      }
    }
  }
}

/**
 * Supprime définitivement le compte de l'user authentifié (RGPD droit à
 * l'oubli). Cascade auth.users → public.users via FK ON DELETE CASCADE.
 *
 * Purge des 3 buckets Storage côté client (mig 73) :
 *   - avatars
 *   - annonces-photos
 *   - cni-verifications (policy DELETE owner ajoutée mig 73)
 *
 * Pourquoi côté client : Supabase Storage a un trigger `protect_delete`
 * qui bloque les `delete from storage.objects` directs en SQL (anti-orphelin
 * S3). Donc on ne peut pas purger depuis une RPC SECURITY DEFINER. Le seul
 * chemin propre est la Storage API HTTP, qui passe par les policies RLS
 * owner-only.
 *
 * Si le storage cleanup throw, on abort le delete : mieux vaut un compte
 * vivant que des PII orphelines sur le CDN. L'user peut retry.
 *
 * Throw en cas d'erreur — le caller doit gérer la signOut + redirection.
 */
export async function deleteMyAccount(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  // 1. Purge des 3 buckets owner-deletable.
  await purgeUserBucket("avatars", userId);
  await purgeUserBucket("annonces-photos", userId);
  await purgeUserBucket("cni-verifications", userId);

  // 2. RPC delete auth.users → cascade tout le reste (mig 73).
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw new Error(error.message);
}
