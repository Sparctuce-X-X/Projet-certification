// Constantes légales NIQO LTD — source de vérité unique pour les documents
// officiels générés côté Edge Functions (factures, reçus PDF, footers email,
// pages légales web/mobile).
//
// Source : certificat RDB Rwanda (`docs/certificate-NIQO-LTD.pdf`, RDB serial
// 261170857304440, printing date 2026-04-27). Cf. mémoire
// `project_niqo_legal_identity.md` pour le contexte complet.
//
// Toute modification de ces constantes implique un amendement RDB Rwanda
// (sauf SUPPORT_EMAIL / LEGAL_EMAIL qui sont des canaux Niqo internes).

export const NIQO_LEGAL_NAME = "NIQO LTD";

/** Tax Identification Number — RDB Rwanda. Identifiant officiel société. */
export const NIQO_RDB_TIN = "150644832";

export const NIQO_LEGAL_FORM =
  "Société de droit rwandais — Private Company Limited By Shares";

export const NIQO_GOVERNING_LAW =
  "Article 23 of Law N° 007/2021 of 05/02/2021";

export const NIQO_HQ_ADDRESS =
  "KG 622 St, Rebero, Rugando, Kimihurura, Gasabo, Kigali, Rwanda";

/** Capital social en RWF (Franc Rwandais). 1 000 actions × 1 000 RWF. */
export const NIQO_CAPITAL = "1 000 000 RWF";

export const NIQO_DIRECTOR = "Dominique Lucien Huang";

export const NIQO_REGULATOR =
  "Office of the Registrar General (RDB — Rwanda Development Board)";

export const NIQO_REGISTRATION_DATE = "2025-11-10";

/** Activité principale enregistrée au RDB (code ISIC). */
export const NIQO_BUSINESS_ACTIVITY = "J6201 — Computer programming activities";

// ── Canaux de contact Niqo ────────────────────────────────────────────────────

export const NIQO_SUPPORT_EMAIL = "support@niqo.africa";
export const NIQO_LEGAL_EMAIL = "legal@niqo.africa";
export const NIQO_DPO_EMAIL = "dpo@niqo.africa";
export const NIQO_BILLING_EMAIL = "billing@niqo.africa";

export const NIQO_WEBSITE_URL = "https://niqo.africa";

// ── Helpers de formatage ──────────────────────────────────────────────────────

/**
 * Footer mentions légales en plain text — pour la version text/plain des
 * emails et les fallbacks console.
 */
export function getNiqoLegalFooterText(): string {
  return [
    `${NIQO_LEGAL_NAME} · TIN ${NIQO_RDB_TIN}`,
    NIQO_LEGAL_FORM,
    NIQO_HQ_ADDRESS,
    `Capital social : ${NIQO_CAPITAL}`,
    `Régulateur : ${NIQO_REGULATOR}`,
    `Contact : ${NIQO_SUPPORT_EMAIL}`,
  ].join("\n");
}

/**
 * Footer mentions légales HTML — pour les emails et les PDF générés.
 * Couleurs cohérentes avec les templates Niqo (`#5A5A57` pour WCAG AA).
 */
export function getNiqoLegalFooterHtml(): string {
  return `
    <p style="margin:0;font-size:12px;line-height:1.5;color:#5A5A57;font-family:Arial,sans-serif;">
      <strong style="color:#1A1A1A;">${NIQO_LEGAL_NAME}</strong> · TIN ${NIQO_RDB_TIN}<br>
      ${NIQO_LEGAL_FORM}<br>
      ${NIQO_HQ_ADDRESS}<br>
      Capital social : ${NIQO_CAPITAL}<br>
      Contact : <a href="mailto:${NIQO_SUPPORT_EMAIL}" style="color:#5A5A57;text-decoration:underline;">${NIQO_SUPPORT_EMAIL}</a>
    </p>
  `.trim();
}
