// Listes de villes prédéfinies par pays (CI/CG).
//
// Choix MVP : ~20 villes CI + ~12 villes CG, classées alphabétiquement.
// Couvre les capitales économiques/politiques + chefs-lieux régionaux + villes
// portuaires/touristiques majeures, soit ~95% de la population des 2 pays.
//
// Pas d'option "Autre" : on assume liste exhaustive pour l'MVP. Si retours
// terrain montrent des manques, enrichir cette constante (pas de migration DB
// requise — c'est un free text côté Postgres dans public.users.ville).
//
// ⚠ Ne PAS mettre Cocody, Yopougon, Treichville, etc. — ce sont des
// **communes/quartiers** d'Abidjan, pas des villes distinctes. Le quartier
// reste un free text (variabilité hyper-locale).

/** @deprecated Utiliser `Pays` depuis `lib/annonces.ts` */
export type Country = "CI" | "CG";

/** Alias pour compatibilité — le type canonique est `Pays` dans lib/annonces.ts */
export type Pays = Country;

export const CITIES_BY_COUNTRY: Record<Country, readonly string[]> = {
  CI: [
    "Abidjan",
    "Aboisso",
    "Adzopé",
    "Agboville",
    "Anyama",
    "Bondoukou",
    "Bouaké",
    "Dabou",
    "Daloa",
    "Dimbokro",
    "Divo",
    "Gagnoa",
    "Grand-Bassam",
    "Korhogo",
    "Man",
    "Odienné",
    "San-Pédro",
    "Soubré",
    "Touba",
    "Yamoussoukro",
  ],
  CG: [
    "Brazzaville",
    "Dolisie",
    "Gamboma",
    "Impfondo",
    "Kinkala",
    "Madingou",
    "Mossendjo",
    "Nkayi",
    "Ouesso",
    "Owando",
    "Pointe-Noire",
    "Sibiti",
  ],
} as const;
