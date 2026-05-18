// Routes des pages légales in-app + métadonnées de version.
//
// Source de vérité unique pour les liens légaux et le versioning des documents.
// Les contenus textuels canoniques vivent dans `docs/legal/*.md` (lisibles par
// un avocat, versionnés git). Les écrans mobiles (`app/legal/*.tsx`) et les
// pages web (`landing/src/app/legal/*/page.tsx`) sont des rendus de ces
// markdowns à maintenir en cohérence (cf. CHANGELOG dans docs/legal/).
//
// Usage :
//   import { LEGAL_ROUTES, LEGAL_VERSIONS } from "@/lib/legal";
//   import { router } from "expo-router";
//   router.push(LEGAL_ROUTES.terms);

export const LEGAL_ROUTES = {
  terms: "/legal/cgu",
  cgv: "/legal/cgv",
  privacy: "/legal/confidentialite",
  mentionsLegales: "/legal/mentions-legales",
  charteCommunautaire: "/legal/charte-communautaire",
} as const;

// URLs publiques web — utilisées dans les emails transactionnels et dans la
// review Apple/Google qui exigent une URL accessible sans installer l'app.
export const LEGAL_WEB_BASE = "https://niqo.africa";

export const LEGAL_WEB_URLS = {
  terms: `${LEGAL_WEB_BASE}/legal/cgu`,
  cgv: `${LEGAL_WEB_BASE}/legal/cgv`,
  privacy: `${LEGAL_WEB_BASE}/legal/confidentialite`,
  mentionsLegales: `${LEGAL_WEB_BASE}/legal/mentions-legales`,
  charteCommunautaire: `${LEGAL_WEB_BASE}/legal/charte-communautaire`,
  cookies: `${LEGAL_WEB_BASE}/legal/cookies`,
} as const;

// Versioning explicite par document.
//
// Toute modification matérielle d'un document doit incrémenter sa version ET
// sa date dans cet objet, en plus de mettre à jour le frontmatter du .md
// correspondant et d'ajouter une entrée à docs/legal/CHANGELOG.md.
//
// La valeur stockée en DB pour `cgu_accepted_at` / `cgu_sell_accepted_at` /
// `accept_auth_cgu(p_version)` correspond actuellement à la **date** (format
// YYYY-MM-DD) — d'où la duplication ci-dessous. Le passage à un format
// `version-date` ou `vN.M` complet est différé Phase 2 (migration DB).
export const LEGAL_VERSIONS = {
  cgu: { version: "1.2", date: "2026-05-11" },
  cgv: { version: "1.1", date: "2026-05-11" },
  privacy: { version: "1.2", date: "2026-05-11" },
  mentionsLegales: { version: "1.2", date: "2026-05-14" },
  charteCommunautaire: { version: "1.1", date: "2026-05-11" },
  cookies: { version: "1.1", date: "2026-05-11" }, // web only
} as const;

// @deprecated — utilisé historiquement comme version unique dans les colonnes
// DB `cgu_version` et le RPC `accept_auth_cgu(p_version)`. Maintenu pour
// rétrocompatibilité ; pointe sur la date de la dernière révision matérielle
// du **bundle CGU + Confidentialité** (les deux docs que l'utilisateur
// accepte explicitement à l'inscription). Les nouveaux docs (CGV, Mentions
// légales, Charte) ont leur propre version dans LEGAL_VERSIONS.
//
// À terme (Phase 2) : remplacer par un objet structuré stocké en DB pour
// permettre le re-consentement granulaire par document.
export const LEGAL_LAST_UPDATED = LEGAL_VERSIONS.cgu.date;
