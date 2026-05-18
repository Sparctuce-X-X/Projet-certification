/**
 * Source unique pour la logique téléphone Mobile Money par pays.
 *
 * Consommé par :
 *   - app/auth/email.tsx          (signup wizard step 3)
 *   - app/auth/complete-profile.tsx (post-OAuth completion)
 *   - app/profile/edit.tsx         (modification profil)
 *
 * Toute évolution (nouveau pays, nouvel opérateur, format E.164 modifié)
 * passe ICI uniquement.
 */

/** @deprecated Utiliser `Pays` depuis `lib/annonces.ts` */
export type Country = "CI" | "CG";

export interface PhoneConfig {
  /** Préfixe E.164 (ex: "+225"). Concaténé avec les digits locaux. */
  prefix: string;
  /** Drapeau emoji pour l'UI (pill préfixe). National symbol, pas une décoration. */
  flag: string;
  /** Longueur attendue de la partie locale (sans préfixe). 10 CI, 9 CG. */
  localDigits: number;
  /** Placeholder dans le TextInput, format human-readable du local. */
  placeholder: string;
  /** Regex sur les premiers chiffres locaux validant un opérateur mobile connu. */
  operatorRegex: RegExp;
}

export const PHONE_CONFIG: Record<Country, PhoneConfig> = {
  CI: {
    prefix: "+225",
    flag: "🇨🇮",
    localDigits: 10,
    placeholder: "07 12 34 56 78",
    // Opérateurs mobile CI : Orange (07), MTN (05/01), Moov (01), Wave (07/05).
    // 25/27 réservés mobile aussi (post-réforme 2021 ARTCI).
    operatorRegex: /^(01|05|07|25|27)/,
  },
  CG: {
    prefix: "+242",
    flag: "🇨🇬",
    localDigits: 9,
    placeholder: "06 123 45 67",
    // Opérateurs mobile CG : Airtel (05/06), MTN (04/06).
    operatorRegex: /^(04|05|06)/,
  },
};

/**
 * Extract the local digits from a stored E.164 phone, stripping the +225/+242
 * prefix. Used to populate the digits-only input from `getMyPhone()` (which
 * returns the full E.164). Falls back to digit-stripping for unknown prefixes.
 */
export function localPhoneDigits(e164: string | null): string {
  if (!e164) return "";
  if (e164.startsWith("+225") || e164.startsWith("+242")) return e164.slice(4);
  return e164.replace(/\D/g, "");
}

/**
 * Normalise un numéro saisi par l'user en format E.164.
 * Retire tous les non-digits, valide la longueur attendue selon le pays,
 * vérifie le préfixe opérateur, préfixe avec le code pays.
 *
 * @returns string E.164 (ex: "+22507123456789") OU null si invalide
 */
/**
 * Formate un numéro E.164 pour affichage lisible.
 *   "+2250712345678" → "+225 07 12 34 56 78"
 *   "+242061234567"  → "+242 06 123 45 67"
 * Fallback brut si le pays n'est pas reconnu.
 */
export function formatPhoneDisplay(e164: string | null): string {
  if (!e164) return "";
  if (e164.startsWith("+225")) {
    const local = e164.slice(4);
    // CI : 10 digits → groupes de 2 : 07 12 34 56 78
    const groups = local.match(/.{1,2}/g) ?? [local];
    return `+225 ${groups.join(" ")}`;
  }
  if (e164.startsWith("+242")) {
    const local = e164.slice(4);
    // CG : 9 digits → 06 123 45 67
    if (local.length === 9) {
      return `+242 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5, 7)} ${local.slice(7)}`;
    }
    return `+242 ${local}`;
  }
  return e164;
}

export function normalizePhone(country: Country, raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const config = PHONE_CONFIG[country];
  if (digits.length !== config.localDigits) return null;
  if (!config.operatorRegex.test(digits)) return null;
  return `${config.prefix}${digits}`;
}
