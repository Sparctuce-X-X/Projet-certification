import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { decode as decodeBase64 } from "base64-arraybuffer";

import {
  AUTH_TIMEOUT_MS,
  supabase,
  withTimeout,
} from "@/lib/supabase";

const BUCKET = "rencontre-photos";
const MAX_PHOTOS = 5;
const SIGNED_URL_TTL = 3600; // 1h
const UPLOAD_TIMEOUT_MS = 30_000;

// ── Types ───────────────────────────────────────────────────────────────────

export interface RencontrePhoto {
  id: string;
  conversation_id: string;
  auteur_id: string;
  role_auteur: "acheteur" | "vendeur";
  storage_path: string;
  created_at: string;
}

export interface AddPhotoResult {
  success: boolean;
  count_after?: number;
  error?: string;
}

// ── Erreurs FR ──────────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Connecte-toi pour ajouter une photo.",
  not_participant: "Tu n'es pas participant à cette conversation.",
  conversation_not_found: "Conversation introuvable.",
  no_confirmed_rdv: "Aucun RDV confirmé sur cette conversation.",
  rdv_not_past: "Le RDV n'est pas encore passé.",
  path_required: "Chemin de fichier requis.",
  invalid_path: "Chemin de fichier invalide.",
  quota_exceeded: `Maximum ${MAX_PHOTOS} photos par conversation.`,
  // Mig 102 : lock après décision admin sur signalement post-RDV
  signalement_decided:
    "Ce RDV a été examiné par notre équipe. Plus de nouvelles preuves possibles.",
};

export function rencontreErrorToFr(code?: string): string {
  if (!code) return "Erreur inconnue. Réessaie.";
  return ERROR_MESSAGES[code] ?? "Erreur inconnue. Réessaie.";
}

// ── Capture caméra + upload ────────────────────────────────────────────────

/**
 * Lance la caméra (in-app, pas de galerie pour anti-spoof) et upload la
 * photo capturée vers Storage + insère la ligne via RPC.
 *
 * Retourne :
 *   - { canceled: true } si l'user annule la capture
 *   - { success: true, photo } si tout passe
 *   - { success: false, error } si erreur (permissions, quota, upload)
 */
export async function captureAndUploadRencontrePhoto(
  conversationId: string
): Promise<
  | { canceled: true }
  | { success: true; photo: RencontrePhoto }
  | { success: false; error: string }
> {
  // Permissions caméra
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    return {
      success: false,
      error:
        "Permission caméra refusée. Active-la dans les réglages pour ajouter des photos.",
    };
  }

  // Capture (caméra UNIQUEMENT — pas d'import galerie pour anti-spoof)
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 0.85,
    cameraType: ImagePicker.CameraType.back,
  });

  if (result.canceled || !result.assets?.[0]) {
    return { canceled: true };
  }

  const localUri = result.assets[0].uri;

  // Caller's UID (vérifié via auth.uid() côté RPC, mais on a besoin pour le path)
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { success: false, error: rencontreErrorToFr("not_authenticated") };
  }

  // Path : {conv_id}/{uid}/{filename}.jpg
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const path = `${conversationId}/${user.id}/${filename}`;

  // Upload Storage (binary via base64 → arrayBuffer)
  try {
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const arrayBuffer = decodeBase64(base64);

    const { error: uploadErr } = await withTimeout(
      Promise.resolve(
        supabase.storage.from(BUCKET).upload(path, arrayBuffer, {
          contentType: "image/jpeg",
          upsert: false,
        })
      ),
      UPLOAD_TIMEOUT_MS,
      "uploadRencontrePhoto"
    );

    if (uploadErr) {
      return {
        success: false,
        error: `Upload échoué : ${uploadErr.message}`,
      };
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Upload échoué.",
    };
  }

  // Insert ligne via RPC (gates : participant + RDV passé + quota)
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("add_rencontre_photo", {
        p_conversation_id: conversationId,
        p_storage_path: path,
      })
    ),
    AUTH_TIMEOUT_MS,
    "addRencontrePhoto"
  );

  if (error) {
    // Rollback Storage si l'INSERT échoue (best-effort)
    void supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { success: false, error: error.message };
  }

  const r = data as AddPhotoResult;
  if (!r.success) {
    void supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { success: false, error: rencontreErrorToFr(r.error) };
  }

  // Re-fetch la photo créée pour retourner les métadonnées complètes
  const { data: photo } = await supabase
    .from("rencontre_photos")
    .select("id, conversation_id, auteur_id, role_auteur, storage_path, created_at")
    .eq("storage_path", path)
    .maybeSingle();

  if (!photo) {
    return {
      success: false,
      error: "Photo créée mais introuvable. Recharge la conversation.",
    };
  }

  return { success: true, photo: photo as RencontrePhoto };
}

// ── Fetch les photos de l'auteur courant pour une conv ─────────────────────

export async function fetchMyRencontrePhotos(
  conversationId: string
): Promise<RencontrePhoto[]> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("rencontre_photos")
        .select("id, conversation_id, auteur_id, role_auteur, storage_path, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
    ),
    AUTH_TIMEOUT_MS,
    "fetchMyRencontrePhotos"
  );

  if (error) throw new Error(error.message);
  return (data ?? []) as RencontrePhoto[];
}

// ── Signed URL (bucket privé — accès via URL signée 1h) ────────────────────

export async function getRencontrePhotoSignedUrl(
  storagePath: string
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);
  if (error || !data) return null;
  return data.signedUrl;
}

export const RENCONTRE_PHOTOS_MAX = MAX_PHOTOS;
