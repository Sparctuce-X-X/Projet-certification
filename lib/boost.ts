import { supabase, withTimeout, AUTH_TIMEOUT_MS } from "@/lib/supabase";

import {
  fetchPaiement,
  type MmoProvider,
  type PaiementNiqo,
  type PaymentInitResult,
} from "@/lib/verification";

// Réexports pour l'écran boost (évite à l'orchestrator d'importer 2 modules)
export { fetchPaiement, MMO_PROVIDERS_BY_COUNTRY } from "@/lib/verification";
export type { MmoProvider, PaiementNiqo, PaymentInitResult };

// ── Options boost ────────────────────────────────────────────────────────────

export interface BoostOption {
  /** Durée du boost en jours (7 ou 30 — whitelist côté DB mig 60) */
  days: 7 | 30;
  /** Prix en FCFA — entier (cf CDC v4.0 §5.2) */
  priceFcfa: number;
  /** Label court pour l'UI */
  shortLabel: string;
  /** Économie vs le tarif unitaire (pour le 30j) */
  savingsLabel?: string;
}

export const BOOST_OPTIONS: BoostOption[] = [
  {
    days: 7,
    priceFcfa: 1000,
    shortLabel: "7 jours",
  },
  {
    days: 30,
    priceFcfa: 3000,
    shortLabel: "30 jours",
    savingsLabel: "Économise 1 000 FCFA",
  },
];

export function getBoostOption(days: 7 | 30): BoostOption {
  const opt = BOOST_OPTIONS.find((o) => o.days === days);
  if (!opt) throw new Error(`Durée boost invalide : ${days}`);
  return opt;
}

// ── Init paiement boost ──────────────────────────────────────────────────────

/**
 * Appelle la Edge Function `pawapay-init-deposit` (mig F07) avec
 * type='boost' et target_id=annonce_id. Retourne le paiementId que l'app
 * mobile va poll en attendant le webhook PawaPay.
 */
export async function initBoostPayment(args: {
  annonceId: string;
  days: 7 | 30;
  /** Numéro Mobile Money E.164 (ex: +22507XXXXXXXX) */
  phoneNumber: string;
  /** Provider MMO sélectionné, whitelisté côté serveur par pays */
  mmoProvider: MmoProvider;
  /** Version CGV acceptée — trace légale renonciation droit rétractation 14j */
  cgvAcceptedVersion: string;
}): Promise<PaymentInitResult> {
  const opt = getBoostOption(args.days);

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.functions.invoke<PaymentInitResult>("pawapay-init-deposit", {
        body: {
          type: "boost",
          montant_fcfa: opt.priceFcfa,
          phone_number: args.phoneNumber,
          mmo_provider: args.mmoProvider,
          target_id: args.annonceId,
          cgv_accepted_version: args.cgvAcceptedVersion,
        },
      })
    ),
    AUTH_TIMEOUT_MS,
    "initBoostPayment"
  );

  if (error) throw new Error(error.message);
  if (!data) throw new Error("EMPTY_PAYMENT_RESPONSE");
  return data;
}

// ── Application du boost (post-completed) ────────────────────────────────────

/**
 * Une fois le paiement marqué `completed` par le webhook PawaPay, appelle
 * la RPC `apply_boost` (mig 60) qui set is_boosted=true + boost_until
 * sur l'annonce et marque le paiement consommé (anti-double-spend).
 *
 * Retourne le nouveau `boost_until` pour confirmer à l'user dans l'UI.
 */
export async function applyBoost(args: {
  paiementId: string;
  annonceId: string;
  days: 7 | 30;
}): Promise<string> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("apply_boost", {
        p_paiement_id: args.paiementId,
        p_annonce_id: args.annonceId,
        p_duration_days: args.days,
      })
    ),
    AUTH_TIMEOUT_MS,
    "applyBoost"
  );

  if (error) throw new Error(error.message);
  if (!data) throw new Error("EMPTY_BOOST_RESPONSE");

  // RPC retourne un timestamptz (ISO string côté JS)
  return data as string;
}

// ── Mapping erreurs RPC → FR ────────────────────────────────────────────────

const APPLY_BOOST_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Reconnecte-toi pour booster ton annonce.",
  INVALID_DURATION: "Durée invalide (7 ou 30 jours uniquement).",
  INVALID_PAIEMENT:
    "Paiement introuvable ou non confirmé. Réessaie dans quelques secondes.",
  PAIEMENT_ALREADY_USED:
    "Ce paiement a déjà été utilisé pour booster une annonce.",
  PAIEMENT_TARGET_MISMATCH:
    "Ce paiement a été initié pour une autre annonce. Contacte le support.",
  PAIEMENT_TARGET_MISSING:
    "Paiement boost mal initialisé (annonce manquante). Contacte le support.",
  INVALID_PRICE:
    "Le montant payé ne correspond pas au tarif officiel. Contacte le support.",
  ANNONCE_INVALID:
    "Annonce introuvable ou inactive (vendue, expirée ou suspendue).",
};

export function mapApplyBoostError(rawMessage: string): string {
  for (const code of Object.keys(APPLY_BOOST_ERRORS)) {
    if (rawMessage.includes(code)) return APPLY_BOOST_ERRORS[code]!;
  }
  if (__DEV__) return `Erreur : ${rawMessage}`;
  return "Erreur lors de l'activation du boost. Réessaie.";
}

// ── Helpers d'affichage ─────────────────────────────────────────────────────

/** True si l'annonce est encore boostée à l'instant T (frontend safety). */
export function isBoostActive(args: {
  is_boosted: boolean;
  boost_until: string | null;
}): boolean {
  if (!args.is_boosted) return false;
  if (!args.boost_until) return false;
  return new Date(args.boost_until) > new Date();
}

/** "5 jours restants" / "1 jour restant" / "expiré" */
export function formatBoostRemaining(boostUntil: string | null): string {
  if (!boostUntil) return "expiré";
  const ms = new Date(boostUntil).getTime() - Date.now();
  if (ms <= 0) return "expiré";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days === 1 ? "1 jour restant" : `${days} jours restants`;
}
