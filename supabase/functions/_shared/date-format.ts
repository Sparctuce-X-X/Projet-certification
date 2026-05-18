const PARIS_TZ = "Europe/Paris";

/** "14 mai 2026" — pour les dates seules dans tableaux */
export function formatParisDate(iso: string | Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "14/05/2026" — court tableau */
export function formatParisDateShort(iso: string | Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TZ,
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "14/05/2026 16:32" — logs, audit, événements */
export function formatParisDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "16:32:45" — événements observability tight */
export function formatParisTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

// ── Country-aware (user-facing emails/PDFs) ───────────────────────────────────

type NiqoCountry = "CI" | "CG";

const COUNTRY_TZ: Record<NiqoCountry, string> = {
  CI: "Africa/Abidjan",       // UTC+0
  CG: "Africa/Brazzaville",   // UTC+1
};

/** "14/05/2026 16:32" en heure locale du pays user */
export function formatCountryDateTime(iso: string | Date, country: NiqoCountry): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: COUNTRY_TZ[country],
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}
