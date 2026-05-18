import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";

import { supabase, withTimeout, type PublicUser } from "@/lib/supabase";

/**
 * Read the user id from the local session (SecureStore) instead of calling
 * `auth.getUser()` which round-trips to validate. The session is hydrated
 * at app boot — once we render this code we know it's valid. Saves one
 * network call per write op (audit fix #8).
 */
async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/**
 * Partial patch — only fields the caller wants to change should be set.
 * `quartier` set to "" or null clears the field. `telephone` set to "" or
 * null clears the encrypted phone. Pays is restricted to MVP countries.
 *
 * The patch is forwarded as-is to the SQL RPC `update_my_profile(jsonb)`.
 */
export interface ProfilePatch {
  prenom?: string;
  nom?: string;
  ville?: string;
  quartier?: string | null;
  pays?: "CI" | "CG";
  telephone?: string | null;
}

/**
 * Atomic update of the editable columns of public.users (text fields +
 * encrypted phone) via RPC. Email and avatar_url remain on dedicated paths.
 *
 * Server-side guarantees (cf. migration 06+08) :
 *   - SECURITY DEFINER, gate `auth.uid() is not null`
 *   - Required fields (prenom/nom/ville) reject empty after trim
 *   - telephone is re-encrypted with Vault key, "" → null
 *   - Trigger set_users_updated_at bumps updated_at automatically
 *   - Returns the updated row (UPDATE … RETURNING *) → caller can pass it
 *     to AuthProvider.refreshProfile() to skip a round-trip SELECT.
 *
 * Returns null when patch is empty (no-op).
 */
export async function updateMyProfile(
  patch: ProfilePatch
): Promise<PublicUser | null> {
  if (Object.keys(patch).length === 0) return null;
  const { data, error } = await supabase.rpc("update_my_profile", { patch });
  if (error) throw new Error(error.message);
  // The RPC returns the row with the encrypted `telephone bytea` field which
  // PostgREST serializes; PublicUser doesn't include it, the cast drops it.
  return data as PublicUser;
}

/**
 * Triggers Supabase email change flow. The user receives a confirmation
 * link on the new address (and on the old one if "Secure email change" is
 * enabled in the dashboard). The email column in public.users is synced
 * via the trigger on_auth_user_email_updated AFTER the user clicks the
 * confirmation link.
 */
export async function updateEmail(newEmail: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email: newEmail });
  // Re-throw the original AuthError (preserves `code` so the caller can map
  // `email_exists` → message FR via authErrorToFr / AUTH_ERRORS_FR).
  if (error) throw error;
}

/**
 * Upload a local image URI (from expo-image-picker) to the `avatars`
 * bucket and update `users.avatar_url` with the public URL.
 *
 * Path convention: `{user_id}/avatar-{timestamp}.{ext}`. Timestamped to
 * bust CDN cache after replace (CDN keys on URL, not on object content).
 *
 * After a successful upload + DB update, old avatars in `{user_id}/` are
 * removed (best-effort, errors swallowed) so the bucket doesn't bloat
 * over re-uploads — and so we don't keep PII (old photo) longer than the
 * user's last opt-in (RGPD minimisation).
 *
 * Returns the new public URL.
 */
export async function uploadAvatar(localUri: string): Promise<string> {
  const userId = await getCurrentUserId();

  // RN-specific: fetch(uri).blob() yields a 0-byte Blob when fed to
  // supabase-js storage upload (well-known Hermes / RN bug). Read the file
  // as base64 via expo-file-system, then decode to ArrayBuffer — the only
  // pattern documented by Supabase for React Native uploads.
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const arrayBuffer = decodeBase64(base64);

  // Derive extension from the URI; default to jpg. Image-picker on Android
  // can return content:// URIs without a clear ext — jpg is a safe default
  // since we set quality:0.8 and the picker re-encodes to JPEG by default.
  const extMatch = localUri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = (extMatch?.[1] ?? "jpg").toLowerCase();
  const contentType = ext === "png" ? "image/png" : "image/jpeg";

  const newFileName = `avatar-${Date.now()}.${ext}`;
  const newPath = `${userId}/${newFileName}`;

  const { error: uploadError } = await withTimeout(
    Promise.resolve(
      supabase.storage
        .from("avatars")
        .upload(newPath, arrayBuffer, {
          contentType,
          upsert: false,
        })
    ),
    30_000,
    "uploadAvatar"
  );
  if (uploadError) throw new Error(uploadError.message);

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(newPath);
  const publicUrl = pub.publicUrl;

  const { error: updateError } = await supabase
    .from("users")
    .update({ avatar_url: publicUrl })
    .eq("id", userId);
  if (updateError) throw new Error(updateError.message);

  // Best-effort cleanup of older avatars. Non-fatal: if it fails, the user
  // still has the new avatar working — only side-effect is bucket bloat,
  // recoverable via a backend sweep later.
  void cleanupOldAvatars(userId, newFileName);

  return publicUrl;
}

/**
 * List `{userId}/` and remove every file whose name is not `keepFileName`.
 * Errors are swallowed — caller fires this and-forget.
 */
async function cleanupOldAvatars(
  userId: string,
  keepFileName: string
): Promise<void> {
  try {
    const { data: files, error } = await supabase.storage
      .from("avatars")
      .list(userId);
    if (error || !files) return;
    const paths = files
      .filter((f) => f.name !== keepFileName)
      .map((f) => `${userId}/${f.name}`);
    if (paths.length === 0) return;
    await supabase.storage.from("avatars").remove(paths);
  } catch {
    // Silent — bloat tolerated, account flow not blocked.
  }
}

/**
 * Remove the user's avatar entirely : purge every file under
 * `avatars/{userId}/` and clear `users.avatar_url`. Distinct from
 * `uploadAvatar` which replaces (and cleans up the predecessor).
 *
 * Throws on any failure so the caller can show an error to the user.
 */
export async function removeAvatar(): Promise<void> {
  const userId = await getCurrentUserId();

  const { data: files, error: listError } = await supabase.storage
    .from("avatars")
    .list(userId);
  if (listError) throw new Error(listError.message);
  if (files && files.length > 0) {
    const paths = files.map((f) => `${userId}/${f.name}`);
    const { error: removeError } = await supabase.storage
      .from("avatars")
      .remove(paths);
    if (removeError) throw new Error(removeError.message);
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ avatar_url: null })
    .eq("id", userId);
  if (updateError) throw new Error(updateError.message);
}
