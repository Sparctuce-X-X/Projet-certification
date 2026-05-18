import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { supabase, withTimeout, AUTH_TIMEOUT_MS } from "@/lib/supabase";

// ── Constantes partagées avec le futur écran /sell ──────────────────────────
// Source de vérité unique. Si on change ces limites, mettre à jour aussi le
// Dashboard Supabase → Storage → annonces-photos → Settings (cf. migration 14).
export const MAX_PHOTO_SIZE_BYTES = 5_242_880; // 5 MB
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const MAX_PHOTOS_PER_ANNONCE = 5;

const BUCKET = "annonces-photos";

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export type PhotoValidation =
  | { ok: true }
  | { ok: false; reason: "too_large" | "wrong_type" };

/**
 * Validation côté client AVANT upload — fail-fast pour économiser la bande
 * passante. La RLS storage.objects (cf. migration 14) ne valide pas la taille
 * ni le MIME type, c'est le Dashboard Supabase qui le fait au niveau bucket
 * (limites configurées manuellement).
 */
export function validatePhotoFile(args: {
  size: number;
  mimeType: string;
}): PhotoValidation {
  if (args.size > MAX_PHOTO_SIZE_BYTES) return { ok: false, reason: "too_large" };
  if (!ALLOWED_MIME_TYPES.includes(args.mimeType as AllowedMimeType)) {
    return { ok: false, reason: "wrong_type" };
  }
  return { ok: true };
}

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

function extFromUri(uri: string): { ext: string; contentType: AllowedMimeType } {
  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const raw = (match?.[1] ?? "jpg").toLowerCase();
  if (raw === "png") return { ext: "png", contentType: "image/png" };
  if (raw === "webp") return { ext: "webp", contentType: "image/webp" };
  return { ext: "jpg", contentType: "image/jpeg" };
}

export interface CompressedPhoto {
  /** Local URI du fichier compressé (cache directory Expo). */
  uri: string;
  /** Taille en bytes après compression. */
  size: number;
  /** Toujours JPEG après compression — simplifie le pipeline upload. */
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

/**
 * Compresse une photo locale (URI expo-image-picker) avant upload pour
 * économiser la bande passante CI/CG (3G omniprésent, 5 MB en moyenne =
 * 30s+ d'upload).
 *
 * Stratégie :
 *   - Resize : longer side ≤ maxDimension (default 1080) en gardant le ratio
 *   - Format : JPEG quality 0.7 (bon compromis qualité/poids)
 *   - Skip resize si la photo est déjà sous maxDimension (juste compression)
 *
 * Avec ces paramètres, une photo iPhone 4032×3024 (~3 MB JPEG natif) tombe
 * autour de 200-400 KB. Largement sous le cap MAX_PHOTO_SIZE_BYTES de 5 MB,
 * ce qui rend `validatePhotoFile` quasi-redondant après compression mais
 * il reste utile pour fail-fast côté UX (avant la compression).
 */
export async function compressPhoto(
  localUri: string,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<CompressedPhoto> {
  const maxDim = options.maxDimension ?? 1080;
  const quality = options.quality ?? 0.7;

  // Premier renderAsync : matérialise l'image en mémoire pour lire les dims.
  // C'est cheap (pas de transformation), juste un load natif.
  const context = ImageManipulator.manipulate(localUri);
  let image = await context.renderAsync();

  // Resize uniquement si nécessaire — sinon on reste sur l'image originale
  // (le saveAsync ci-dessous suffit pour la compression JPEG).
  if (image.width > maxDim || image.height > maxDim) {
    const longerSideIsWidth = image.width >= image.height;
    context.resize(
      longerSideIsWidth ? { width: maxDim } : { height: maxDim }
    );
    image = await context.renderAsync();
  }

  const result = await image.saveAsync({
    compress: quality,
    format: SaveFormat.JPEG,
  });

  // saveAsync ne retourne pas la taille — on la lit du filesystem.
  // FileInfo expose `size` directement quand `exists: true` (cf. legacy types).
  const info = await FileSystem.getInfoAsync(result.uri);
  const size = info.exists ? info.size : 0;

  return {
    uri: result.uri,
    size,
    mimeType: "image/jpeg",
    width: result.width,
    height: result.height,
  };
}

export interface UploadedPhoto {
  /** Chemin Supabase Storage (ex: `userId/annonceId/1714389123-x4f9a2.jpg`). À stocker en DB. */
  path: string;
  /** URL publique CDN — directement utilisable dans <Image source={{ uri }} />. */
  publicUrl: string;
}

/**
 * Upload une photo locale (URI expo-image-picker) vers le bucket
 * `annonces-photos`. Path : `{userId}/{annonceId}/{timestamp}-{rand}.{ext}`.
 * La RLS storage.objects (migration 14) gate le `userId` côté serveur —
 * impossible d'écrire dans le sous-dossier d'un autre user.
 *
 * Pattern d'upload RN : fetch(uri).blob() retourne 0 byte sur Hermes, donc
 * on lit en base64 via expo-file-system puis decode en ArrayBuffer (cf.
 * lib/profile.ts uploadAvatar — même contrainte).
 *
 * Throw en cas d'erreur réseau, RLS, ou taille. Le caller affiche le message.
 */
export async function uploadAnnoncePhoto(
  localUri: string,
  annonceId: string
): Promise<UploadedPhoto> {
  const userId = await getCurrentUserId();
  const { ext, contentType } = extFromUri(localUri);

  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const arrayBuffer = decodeBase64(base64);

  // Suffixe random courte pour éviter collision si l'user upload 2 photos
  // dans la même milliseconde (rare mais théoriquement possible avec un
  // upload parallèle multi-fichiers).
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const path = `${userId}/${annonceId}/${filename}`;

  // Timeout 30s par photo — sur 3G CI/CG, 400 KB ≈ 10-20s. 30s laisse
  // de la marge sans laisser l'user attendre indéfiniment en cas de coupure.
  const UPLOAD_TIMEOUT_MS = 30_000;

  const { error } = await withTimeout(
    Promise.resolve(
      supabase.storage
        .from(BUCKET)
        .upload(path, arrayBuffer, {
          contentType,
          upsert: false,
          cacheControl: "31536000",
        })
    ),
    UPLOAD_TIMEOUT_MS,
    "uploadAnnoncePhoto"
  );
  if (error) throw new Error(error.message);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: pub.publicUrl };
}

/**
 * URL publique à partir d'un path stocké en DB. Synchrone — getPublicUrl ne
 * fait pas de round-trip réseau, c'est juste de la concat URL.
 */
export function getAnnoncePhotoUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Supprime une photo. Best-effort — les erreurs sont loggées mais pas thrown.
 * Pattern repris de cleanupOldAvatars dans lib/profile.ts : si l'upload de
 * remplacement a réussi, on ne veut pas crasher le flow utilisateur sous
 * prétexte qu'on n'a pas pu nettoyer l'ancien fichier (le bucket bloat est
 * récupérable via un sweep backend, pas le flow user).
 *
 * Pour les suppressions critiques (ex: cascade delete annonce, RGPD purge
 * compte), utiliser deleteAnnoncePhotosStrict.
 */
export async function deleteAnnoncePhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    console.warn(`[storage/annonces-photos] delete failed for ${path}:`, error.message);
  }
}

/**
 * Variante stricte : throw en cas d'erreur. À utiliser quand on a besoin de
 * garantie de purge (cascade delete annonce, suppression de compte RGPD).
 */
export async function deleteAnnoncePhotosStrict(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}
