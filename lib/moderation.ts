// Modération automatique — couche 2 (OpenAI Moderation API).
//
// Wrapper client de l'Edge Function `moderate-text` (cf.
// supabase/functions/moderate-text/index.ts + docs/backend/moderation.md).
//
// Couche 1 (mots_interdits substring DB) reste enforced au niveau trigger
// → couvre les patterns canoniques (armes, drogues, OTP, paiement avance,
// URLs raccourcies, etc.) non contournables.
//
// Cette couche 2 ajoute la classification contextuelle ML (sexual, hate,
// violence, illicit, etc.) pour rattraper ce que substring matching ne
// peut pas faire.
//
// FAIL-OPEN : si l'Edge Function timeout/5xx, on laisse passer côté client
// aussi (la couche 1 DB couvre les pires patterns + F08 signalements
// rattrape le reste). Throws uniquement sur les erreurs de validation
// (texte vide, surface invalide).

import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { supabase, AUTH_TIMEOUT_MS, withTimeout } from "@/lib/supabase";

export type ModerationSurface =
  | "annonce.create"
  | "annonce.update"
  | "message";

export type ModerationImageSurface = "annonce.create";

export interface ModerationResult {
  ok: boolean;
  /** Catégorie OpenAI ayant déclenché le block (ex: "sexual", "hate"). */
  reason?: string;
  /** Message FR à afficher à l'utilisateur. */
  hint?: string;
}

interface ModerateArgs {
  texte: string;
  surface: ModerationSurface;
}

/**
 * Appelle l'Edge Function `moderate-text` pour classifier un texte.
 *
 * Returns `{ ok: true }` si le texte passe (ou si l'Edge Function timeout
 * et échoue en fail-open). Returns `{ ok: false, reason, hint }` si flagé.
 *
 * Côté caller : si `ok === false`, throw une erreur lisible avec `hint`.
 */
export async function moderateText(args: ModerateArgs): Promise<ModerationResult> {
  const texte = args.texte.trim();
  if (!texte) return { ok: true };

  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase.functions.invoke<ModerationResult>("moderate-text", {
          body: { texte, surface: args.surface },
        }),
      ),
      AUTH_TIMEOUT_MS,
      "moderateText",
    );

    if (error) {
      // Erreur transport (réseau, 5xx, etc.) → fail-open côté client.
      // L'Edge Function elle-même fail-open déjà sur erreur OpenAI, donc
      // si on arrive ici c'est probablement réseau mobile → ne pas bloquer
      // le user. La couche 1 mots_interdits rattrapera côté trigger DB.
      console.warn(`[moderation] invoke failed: ${error.message}`);
      return { ok: true };
    }
    if (!data) return { ok: true };
    return data;
  } catch (e) {
    console.warn(`[moderation] threw: ${(e as Error).message}`);
    return { ok: true };
  }
}

/**
 * Helper : modère titre + description en un seul appel.
 * Concatène avec un séparateur explicite pour aider OpenAI à matcher
 * sur l'ensemble.
 */
export async function moderateAnnonceText(args: {
  titre: string;
  description: string;
  surface: "annonce.create" | "annonce.update";
}): Promise<ModerationResult> {
  const combined = `${args.titre.trim()}\n\n${args.description.trim()}`;
  return moderateText({ texte: combined, surface: args.surface });
}

// ── Modération images (couche enforcement) ──────────────────────────────

interface ModerateImageArgs {
  /** URI locale (file://...) retournée par expo-image-picker. */
  uri: string;
  surface: ModerationImageSurface;
}

// Resize au max à 1024px côté long avant scan : Rekognition donne le même
// résultat sur une image 1024 que sur du 4032 pour la détection NSFW (les
// modèles sont entraînés sur du low-res), et le payload base64 reste sous
// 1 MB → upload rapide en CI/CG (3G).
const MODERATION_MAX_DIM = 1024;
const MODERATION_JPEG_QUALITY = 0.75;

/**
 * Appelle l'Edge Function `moderate-image` pour scanner une image avant
 * publication. Resize + compresse localement avant envoi (économie bande
 * passante + coût Rekognition).
 *
 * Returns `{ ok: true }` si l'image passe (ou si fail-open sur erreur
 * transport / EF inactif sans credentials AWS). Returns `{ ok: false,
 * reason, hint }` si flagged.
 *
 * Caller (Step4Photos) : si `ok === false`, afficher Alert FR avec `hint`
 * et NE PAS ajouter à la queue photos. Si `ok === true` après erreur réseau
 * silencieuse, c'est le comportement attendu (fail-open) — F08 signalements
 * + couche 1 mots_interdits (titre/desc) rattrapent côté serveur.
 */
export async function moderateImage(
  args: ModerateImageArgs,
): Promise<ModerationResult> {
  // ── 1. Resize + JPEG compression (mirror de compressPhoto, dim plus
  //    petite spécifiquement pour le scan ML) ─────────────────────────
  let base64: string;
  try {
    const context = ImageManipulator.manipulate(args.uri);
    let image = await context.renderAsync();
    if (
      image.width > MODERATION_MAX_DIM ||
      image.height > MODERATION_MAX_DIM
    ) {
      const longerSideIsWidth = image.width >= image.height;
      context.resize(
        longerSideIsWidth
          ? { width: MODERATION_MAX_DIM }
          : { height: MODERATION_MAX_DIM },
      );
      image = await context.renderAsync();
    }
    const result = await image.saveAsync({
      compress: MODERATION_JPEG_QUALITY,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!result.base64) {
      console.warn("[moderation.image] saveAsync did not return base64");
      return { ok: true };
    }
    base64 = result.base64;
  } catch (e) {
    console.warn(`[moderation.image] resize failed: ${(e as Error).message}`);
    // Fail-open : si la compression échoue (image corrompue, OOM mobile),
    // on laisse passer côté UX. L'annonce sera de toute façon créée avec
    // des photos qui passeront couche 1 (titre/desc) côté DB.
    return { ok: true };
  }

  // ── 2. Appel Edge Function ──────────────────────────────────────────
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase.functions.invoke<ModerationResult>("moderate-image", {
          body: { photo_base64: base64, surface: args.surface },
        }),
      ),
      AUTH_TIMEOUT_MS,
      "moderateImage",
    );

    if (error) {
      console.warn(`[moderation.image] invoke failed: ${error.message}`);
      return { ok: true };
    }
    if (!data) return { ok: true };
    return data;
  } catch (e) {
    console.warn(`[moderation.image] threw: ${(e as Error).message}`);
    return { ok: true };
  }
}

