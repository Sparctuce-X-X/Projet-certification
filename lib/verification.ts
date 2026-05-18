import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

// ── Constantes — source de vérité unique ─────────────────────────────────────

/** Prix de la vérification d'identité. Affiché à 3 endroits du wizard (intro + récap + confirm). */
export const VERIFICATION_PRICE_FCFA = 1000;

/** Délai max promis à l'user. Affiché dans le banner pending. */
export const VERIFICATION_SLA_HOURS = 24;

/** Cap d'annonces simultanées avant vérification. CDC §2.6 Pilier 1. */
export const UNVERIFIED_ANNONCES_CAP = 3;

/**
 * Version courante du document de consent RGPD affiché au step 1 du wizard.
 * Bumper chaque fois que le wording change. Storé en DB via la RPC
 * `submit_verification` pour audit trail (CNIL/ARTCI/ANRTIC).
 *
 * ⚠ Cette valeur est whitelisted côté serveur (RPC raise INVALID_CONSENT_VERSION
 * si elle n'est pas reconnue). Quand on bump, mettre à jour aussi la check
 * dans la mig 47.
 */
export const RGPD_CONSENT_VERSION = "v1.1";

// ── Mobile Money providers (PawaPay v2) ─────────────────────────────────────

/** Codes provider PawaPay sandbox + prod. Whitelist côté Edge Function. */
export type MmoProvider =
  | "ORANGE_CIV"
  | "MTN_MOMO_CIV"
  | "AIRTEL_COG"
  | "MTN_MOMO_COG";

export interface MmoProviderInfo {
  code: MmoProvider;
  /** Label complet pour le sélecteur ("Orange Money") */
  label: string;
  /** Label court pour les chips ("Orange") */
  shortLabel: string;
}

/** Liste des MMO disponibles par pays. Source de vérité unique côté client. */
export const MMO_PROVIDERS_BY_COUNTRY: Record<"CI" | "CG", MmoProviderInfo[]> = {
  CI: [
    { code: "ORANGE_CIV", label: "Orange Money", shortLabel: "Orange" },
    { code: "MTN_MOMO_CIV", label: "MTN MoMo", shortLabel: "MTN" },
  ],
  CG: [
    { code: "AIRTEL_COG", label: "Airtel Money", shortLabel: "Airtel" },
    { code: "MTN_MOMO_COG", label: "MTN MoMo", shortLabel: "MTN" },
  ],
};

/**
 * Compression CNI/selfie : qualité plus haute que photos d'annonce (le texte
 * de la CNI doit rester lisible). 1600px de plus grand côté + JPEG q=0.85
 * ≈ 400-700 KB par photo, sous le cap 8 MB du bucket (mig 46).
 */
const KYC_MAX_DIMENSION = 1600;
const KYC_PHOTO_QUALITY = 0.85;
const KYC_BUCKET = "cni-verifications";

/** Upload timeout généreux : sur 3G CI/CG, 700 KB ≈ 20-30s. 45s laisse marge. */
const KYC_UPLOAD_TIMEOUT_MS = 45_000;

// ── Types ────────────────────────────────────────────────────────────────────

export type KycPhotoKind = "recto" | "verso" | "selfie";

export type StatutVerification = "pending" | "verified" | "rejected";
export type TypePaiement =
  | "verification"
  | "boost"
  | "pro_subscription"
  | "vedette"
  | "unsuspend";
export type StatutPaiement = "pending" | "completed" | "failed" | "refunded";

/**
 * Vue client de `verifications_identite` — on n'expose PAS les paths CNI au
 * user (il n'en a pas l'usage, et il ne peut pas les relire de toute façon
 * par RLS Storage mig 46). Les paths restent côté admin uniquement.
 */
export interface MyVerificationStatus {
  id: string;
  paiement_id: string;
  statut: StatutVerification;
  reject_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface PaiementNiqo {
  id: string;
  user_id: string;
  type: TypePaiement;
  target_id: string | null;
  montant_fcfa: number;
  pawapay_deposit_id: string | null;
  statut: StatutPaiement;
  created_at: string;
  completed_at: string | null;
}

/** Réponse de l'Edge Function `pawapay-init-deposit`. */
export interface PaymentInitResult {
  paiementId: string;
  depositId: string;
  statut: StatutPaiement;
  /** URL ou instructions Mobile Money que le wizard montre à l'user. Sandbox = string fictif. */
  paymentInstructions?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) throw new Error("AUTH_REQUIRED");
  return userId;
}

/**
 * Identifiant local pour grouper les 3 photos d'une soumission dans un même
 * dossier Storage (`{userId}/{draftId}/{kind}.jpg`). Pas un UUID strict —
 * c'est juste pour disambiguer entre soumissions du même user. Le draftId
 * est consommé une fois la verification créée en DB ; les uploads orphelins
 * sont purgés J+30 par cron admin.
 */
export function generateVerificationDraftId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Compresse une capture caméra (URI expo-camera) avant upload pour préserver
 * la bande passante (3G omniprésent CI/CG) tout en gardant la lisibilité du
 * texte de la CNI (q=0.85 vs 0.7 pour les photos d'annonce).
 */
export async function compressKycPhoto(
  localUri: string
): Promise<{ uri: string; size: number }> {
  const context = ImageManipulator.manipulate(localUri);
  let image = await context.renderAsync();

  if (image.width > KYC_MAX_DIMENSION || image.height > KYC_MAX_DIMENSION) {
    const longerSideIsWidth = image.width >= image.height;
    context.resize(
      longerSideIsWidth
        ? { width: KYC_MAX_DIMENSION }
        : { height: KYC_MAX_DIMENSION }
    );
    image = await context.renderAsync();
  }

  const result = await image.saveAsync({
    compress: KYC_PHOTO_QUALITY,
    format: SaveFormat.JPEG,
  });

  const info = await FileSystem.getInfoAsync(result.uri);
  return { uri: result.uri, size: info.exists ? info.size : 0 };
}

// ── Upload des 3 captures ────────────────────────────────────────────────────

/**
 * Upload une photo CNI/selfie vers le bucket privé `cni-verifications`.
 * Path : `{userId}/{draftId}/{kind}.jpg`. La RLS Storage (mig 46) gate :
 *   - INSERT autorisé si la 1ère foldername == auth.uid()
 *   - SELECT/DELETE refusés au user (admin only)
 *
 * `upsert: true` permet la recapture (le user peut refaire une photo si floue).
 *
 * Pattern d'upload RN : on lit en base64 via expo-file-system puis decode en
 * ArrayBuffer (fetch().blob() retourne 0 byte sur Hermes — bug connu, cf.
 * lib/storage/annonces-photos.ts).
 */
export async function uploadKycPhoto(args: {
  localUri: string;
  draftId: string;
  kind: KycPhotoKind;
}): Promise<{ path: string }> {
  const userId = await getCurrentUserId();
  const compressed = await compressKycPhoto(args.localUri);

  const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const arrayBuffer = decodeBase64(base64);

  const path = `${userId}/${args.draftId}/${args.kind}.jpg`;

  const { error } = await withTimeout(
    Promise.resolve(
      supabase.storage.from(KYC_BUCKET).upload(path, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "0", // privé, pas de cache CDN
      })
    ),
    KYC_UPLOAD_TIMEOUT_MS,
    "uploadKycPhoto"
  );

  if (error) throw new Error(error.message);
  return { path };
}

// ── Soumission de la vérification ────────────────────────────────────────────

/**
 * Appelle la RPC `submit_verification` (mig 45) après que :
 *   1. Le paiement (1 000 FCFA) soit `completed` (callback PawaPay reçu)
 *   2. Les 3 photos soient uploadées dans Storage
 *
 * La RPC vérifie côté serveur :
 *   - Le paiement appartient au caller, type=verification, statut=completed
 *   - Le paiement n'est pas déjà consommé par une autre verification
 *   - Aucune verification pending n'est en cours pour cet user
 *   - Les paths commencent par {auth.uid()}/ (anti-spoofing)
 *
 * Retourne l'`id` de la verification créée (statut `pending`).
 */
export async function submitVerification(args: {
  paiementId: string;
  rectoPath: string;
  versoPath: string;
  selfiePath: string;
  /** Version du consent RGPD acceptée. Default au constant courant. */
  consentVersion?: string;
}): Promise<string> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("submit_verification", {
        p_paiement_id: args.paiementId,
        p_recto_path: args.rectoPath,
        p_verso_path: args.versoPath,
        p_selfie_path: args.selfiePath,
        p_consent_version: args.consentVersion ?? RGPD_CONSENT_VERSION,
      })
    ),
    AUTH_TIMEOUT_MS,
    "submitVerification"
  );

  if (error) throw new Error(error.message);
  return data as string;
}

// ── Lecture du statut courant ────────────────────────────────────────────────

/**
 * Retourne la dernière soumission de l'user courant (pending, verified ou
 * rejected). Utilisé par :
 *   - Le banner profile (`<VerifPendingBanner>`)
 *   - L'écran wizard (refuser l'entrée si une vérif pending existe déjà)
 *   - Le badge profil public (vérifié si statut=verified)
 *
 * Volontairement select narrow — pas de paths CNI exposés au client.
 */
export async function fetchMyLastVerification(): Promise<MyVerificationStatus | null> {
  const userId = await getCurrentUserId();
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("verifications_identite")
        .select("id, paiement_id, statut, reject_reason, reviewed_at, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ),
    AUTH_TIMEOUT_MS,
    "fetchMyLastVerification"
  );

  if (error) throw new Error(error.message);
  return (data as MyVerificationStatus | null) ?? null;
}

// ── Paiement (Edge Function PawaPay) ─────────────────────────────────────────

/**
 * Appelle l'Edge Function `pawapay-init-deposit` qui :
 *   1. Crée la row `paiements_niqo` en service_role (statut pending)
 *   2. Initie le deposit côté PawaPay sandbox
 *   3. Retourne le `paiementId` + instructions Mobile Money pour l'user
 *
 * Le client poll ensuite `fetchPaiement(paiementId)` jusqu'à `completed`,
 * ou attend le push notif (côté webhook). Une fois completed, on enchaîne
 * `submitVerification()`.
 *
 * ⚠ L'Edge Function n'est pas encore déployée à ce stade. La task #18 la
 * crée. Avant déploiement, cet appel échoue avec FUNCTION_NOT_FOUND.
 */
export async function initVerificationPayment(args: {
  /** Numéro Mobile Money au format E.164, ex: "+22507XXXXXXXX" */
  phoneNumber: string;
  /** Provider MMO sélectionné par l'user (sélecteur Step 5) */
  mmoProvider: MmoProvider;
  /** Version CGV acceptée — trace légale renonciation droit rétractation 14j */
  cgvAcceptedVersion: string;
}): Promise<PaymentInitResult> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.functions.invoke<PaymentInitResult>("pawapay-init-deposit", {
        body: {
          type: "verification",
          montant_fcfa: VERIFICATION_PRICE_FCFA,
          phone_number: args.phoneNumber,
          mmo_provider: args.mmoProvider,
          cgv_accepted_version: args.cgvAcceptedVersion,
        },
      })
    ),
    AUTH_TIMEOUT_MS,
    "initVerificationPayment"
  );

  if (error) throw new Error(error.message);
  if (!data) throw new Error("EMPTY_PAYMENT_RESPONSE");
  return data;
}

/**
 * Lit l'état d'un paiement (poll par le client en attendant le webhook PawaPay).
 * Cap recommandé côté caller : 3 s × 60 = 3 min, puis on bascule sur le push
 * notif (mais la prod est généralement < 30s).
 */
export async function fetchPaiement(
  paiementId: string
): Promise<PaiementNiqo | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from("paiements_niqo")
        .select("*")
        .eq("id", paiementId)
        .maybeSingle()
    ),
    AUTH_TIMEOUT_MS,
    "fetchPaiement"
  );

  if (error) throw new Error(error.message);
  return (data as PaiementNiqo | null) ?? null;
}

// ── Mapping erreurs RPC → messages FR pour l'UX ──────────────────────────────

const SUBMIT_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Reconnecte-toi pour soumettre ta vérification.",
  INVALID_PAIEMENT: "Paiement introuvable ou non confirmé. Réessaie dans quelques secondes.",
  PAIEMENT_ALREADY_USED: "Ce paiement a déjà été utilisé pour une vérification.",
  VERIFICATION_ALREADY_PENDING: "Tu as déjà une vérification en cours. Attends la réponse de l'équipe.",
  INVALID_PATH_OWNERSHIP: "Erreur de sécurité sur les fichiers. Recommence le wizard.",
  INVALID_CONSENT_VERSION: "Version de consentement non reconnue. Mets l'app à jour.",
};

export function mapSubmitVerificationError(rawMessage: string): string {
  // Postgres errors arrivent sous forme `code: P000X — message`. On cherche le code custom.
  for (const code of Object.keys(SUBMIT_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return SUBMIT_ERROR_MESSAGES[code]!;
  }
  // En dev, on expose le raw pour debug. En prod on cache.
  if (__DEV__) {
    return `[DEV] ${rawMessage}`;
  }
  return "Impossible de soumettre la vérification. Réessaie plus tard.";
}
