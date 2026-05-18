# Niqo — Design System

> Interprétation humaine de la charte graphique Figma.
> Source de vérité visuelle : [Figma `Niqo — Brand Identity / Design System`](https://www.figma.com/design/aO5P9890olO8oJARLK9NdZ/Niqo-%E2%80%94-Brand-Identity---Design-System).
>
> Ce fichier est rempli par l'agent `frontend` à partir des frames Figma. Ne pas éditer à la main sans aligner Figma au préalable.
> Dernière extraction : 2026-05-01 (Brand Identity v1.0 — Dominique Huang, aligné CDC v4.0)

---

## 1. Logo

**Frame Figma :** [Logo (`node-id=1-2`)](https://www.figma.com/design/aO5P9890olO8oJARLK9NdZ/Niqo-%E2%80%94-Brand-Identity---Design-System?node-id=1-2)

### Concept

Un mot, un point. `niqo.` — mémorable, polyvalent, reproductible. Le point final fait partie intégrante du logotype et ne peut être supprimé.

### Variantes

Le logo Niqo est un **wordmark pur** — le nom `niqo.` (avec point) en Space Grotesk. Il n'existe pas de version "mark seule" ou "icon seule" distincte du wordmark, sauf pour les App Icons Store qui utilisent `n.` (initiale + point).

| Variante | Usage | Fond autorisé |
|---|---|---|
| `niqo.` (wordmark complet) | Toutes utilisations générales | Fond clair, fond noir, fond coral, fond beige |
| `n.` (app icon) | Stores (Google Play / App Store), favicon | Fond coral (principal), fond noir (alternatif), fond coral inversé |

### Échelles d'utilisation

| Taille | Usage | Contexte |
|---|---|---|
| 11 px | Taille minimum lisible | Jamais en dessous de cette limite |
| ~20 px | Header app | Navigation mobile |
| ~60 px | Splash / loading | Écran de démarrage |
| ~100 px | Marketing hero | Visuels promotionnels |
| ~150 px | Brand cover | Couvertures, supports print |

### App Icons

Trois variantes d'icône pour les stores :
- **Principal** : `n.` sur fond coral `#D85A30`
- **Alternatif** : `n.` sur fond noir `#1A1A1A`
- **Coral** : `n.` sur fond... (à confirmer avec screenshot — le fond de la 3e variante n'est pas identifiable depuis les métadonnées seules)

### Zone de protection

La zone de protection autour du logotype est égale à la hauteur de la lettre `n` de chaque côté. Aucun autre élément graphique dans cette zone.

### Usages interdits

- Supprimer ou déplacer le point final
- Changer la police (Space Grotesk est la police exclusive)
- Déformer les proportions (pas de stretch horizontal/vertical)
- Utiliser le coral comme fond pour des boutons d'action critique (Contacter, Publier)
- Appliquer des ombres ou effets sur le logotype

### Exports attendus

Les assets SVG/PNG sont à exporter depuis Figma (hors scope de cette tâche d'extraction). Formats requis pour le projet :
- `assets/logo/niqo-wordmark-black.svg` (sur fond transparent)
- `assets/logo/niqo-wordmark-white.svg` (version fond sombre)
- `assets/icons/app-icon-coral.png` (1024×1024 pour stores)
- `assets/icons/app-icon-black.png` (1024×1024 alternatif)

---

## 2. Couleurs

**Frame Figma :** [Colors (`node-id=1-3`)](https://www.figma.com/design/aO5P9890olO8oJARLK9NdZ/Niqo-%E2%80%94-Brand-Identity---Design-System?node-id=1-3)

### Palette principale

| Hex | Nom Figma | Token NativeWind | Usage |
|---|---|---|---|
| `#1A1A1A` | Niqo Black | `bg-niqo-black` / `text-niqo-black` | Boutons primaires, titres, navigation |
| `#D85A30` | Niqo Coral | `bg-niqo-coral` / `text-niqo-coral` | Accents, CTA secondaires, badges catégories, signature |
| `#FAECE7` | Coral Light | `bg-niqo-coral-light` | Fonds catégories, tags, surfaces |
| `#FFFFFF` | White | `bg-niqo-white` / `bg-white` | Fonds principaux, cards |

### Échelle de gris

| Hex | Nom Figma | Token NativeWind | Usage |
|---|---|---|---|
| `#FAFAFA` | Gray 50 | `bg-niqo-gray-50` | Sections, search bar |
| `#E5E5E5` | Gray 200 | `border-niqo-gray-200` | Bordures, séparateurs |
| `#888780` | Gray 500 | `text-niqo-gray-500` | Texte tertiaire, hints |
| `#444441` | Gray 800 | `text-niqo-gray-800` | Texte secondaire |
| `#1A1A1A` | Black | `text-niqo-black` | Texte principal |

### Couleurs sémantiques

| Hex | Nom | Token NativeWind | Usage |
|---|---|---|---|
| `#1D9E75` | Success | `text-niqo-success` / `bg-niqo-success` | Vendeur vérifié, action réussie |
| `#BA7517` | Warning | `text-niqo-warning` / `bg-niqo-warning` | Annonce expire bientôt, attention |
| `#E24B4A` | Danger | `text-niqo-danger` / `bg-niqo-danger` | Signalement, erreur, suspendu |
| `#185FA5` | Info | `text-niqo-info` / `bg-niqo-info` | Liens, infos, système |

### Dark mode

| Hex | Token NativeWind | Usage |
|---|---|---|
| `#0A0A0A` | `bg-niqo-dark-bg` | Vrai noir OLED — économie batterie Android low-end, lisibilité soleil |

### Règle d'or (Figma 1:3)

> Le coral est utilisé **avec parcimonie**. Réservé aux accents, signatures (point logo, onglet actif, badges catégorie) et CTA wizard vendeur. **Le noir reste l'action principale** (Contacter, Appliquer filtres). Les filtres actifs utilisent `bg-niqo-coral-light` + `border-niqo-coral` pour signaler visuellement leur état.

---

### Badges statuts annonce

Les 5 statuts `ENUM statut_annonce` mappent sur des couleurs sémantiques :

| Statut SQL | Label FR | Base sémantique |
|---|---|---|
| `active` | Active | Success (vert) |
| `en_cours` | En cours | Info (bleu) |
| `vendue` | Vendue | Neutre (gris) |
| `suspendue` | Suspendue | Danger (rouge) |
| `expiree` | Expirée | Warning (orange) |

### Badges état objet

Les 4 états pour les annonces classiques (non immobilier) :

| État | Label FR | Couleur | Icône |
|---|---|---|---|
| `neuf` | Neuf | `#1D9E75` (success) | Sparkles |
| `tres_bon` | Très bon | `#185FA5` (info) | ThumbsUp |
| `bon` | Bon | `#BA7517` (warning) | CircleDot |
| `moyen` | Moyen | `#E24B4A` (danger) | Wrench |

Les annonces immobilier n'ont pas d'état (`etat = NULL`).

---

## 3. Typographie

**Frame Figma :** [Typography (`node-id=1-4`)](https://www.figma.com/design/aO5P9890olO8oJARLK9NdZ/Niqo-%E2%80%94-Brand-Identity---Design-System?node-id=1-4)

### 3 polices, 3 rôles

> "3 polices, 3 rôles. Space Grotesk pour le caractère, Inter pour la lisibilité, JetBrains Mono pour les chiffres."

| Police | Rôle | Usage | Package à installer |
|---|---|---|---|
| **Space Grotesk** | DISPLAY | Titres, logo — caractère unique, lettres ouvertes | `@expo-google-fonts/space-grotesk` |
| **Inter** | BODY | Texte courant — lisibilité maximale, neutre | `@expo-google-fonts/inter` |
| **JetBrains Mono** | DATA | Prix, codes, numéros — largeur fixe, alignement FCFA | `@expo-google-fonts/jetbrains-mono` |

**Installation requise (hors scope de cette tâche) :**
```bash
npx expo install @expo-google-fonts/space-grotesk @expo-google-fonts/inter @expo-google-fonts/jetbrains-mono
```

Ces packages sont des custom Google Fonts — **pas de system-ui**. Le design est incompatible avec les polices système car Space Grotesk est un caractère distinctif de l'identité Niqo.

### Hiérarchie typographique complète

| Style | Police | Taille | Line-height | Letter-spacing | Token NativeWind | Usage |
|---|---|---|---|---|---|---|
| DISPLAY | Space Grotesk Medium | 56 px | 64 px | -1.5 px | `text-display font-display` | Héros marketing |
| H1 | Space Grotesk Medium | 32 px | 40 px | -0.5 px | `text-h1 font-display` | Titres d'écrans |
| H2 | Space Grotesk Medium | 24 px | 32 px | — | `text-h2 font-display` | Titres sections |
| H3 | Inter Semi Bold | 18 px | 24 px | — | `text-h3 font-body` | Sous-titres |
| BODY | Inter Regular | 16 px | 24 px (×1.5) | — | `text-body font-body` | Texte courant |
| CAPTION | Inter Regular | 13 px | 18 px | — | `text-caption font-body` | Méta, labels |
| PRICE | JetBrains Mono Medium | 22 px | 28 px | — | `text-price font-mono` | Montants FCFA |
| MICRO | Inter Regular | 11 px | 14 px | — | `text-micro font-body` | Labels filtres, badges compteurs |
| 2XS | Inter Regular | 10 px | 12 px | — | `text-2xs font-body` | Badges très petits |
| LABEL | Inter Semi Bold | 14 px | 20 px | — | `text-label font-body` | Boutons, onglets actifs |

---

## 4. Composants

**Frame Figma :** [Components (`node-id=1-5`)](https://www.figma.com/design/aO5P9890olO8oJARLK9NdZ/Niqo-%E2%80%94-Brand-Identity---Design-System?node-id=1-5)

> Inventaire uniquement — aucun composant codé dans cette tâche. Les implémentations `.tsx` arrivent dans les tâches suivantes.

### Boutons

Figma montre une rangée de 6 boutons avec variantes visuelles distinctes :

| Label | Variante visuelle | Couleur bg | Couleur text | Arrondi | Usage contextuel |
|---|---|---|---|---|---|
| "Contacter le vendeur" | Primaire | `#1A1A1A` (niqo-black) | `#FFFFFF` | 8 px (btn) | Action principale contact |
| "Modifier l'annonce" | Secondaire outline | `transparent` + bordure noire | `#1A1A1A` | 8 px | Actions secondaires |
| "Publier maintenant" | Coral filled | `#D85A30` (niqo-coral) | `#FFFFFF` | 8 px | Publication annonce (CTA wizard vendeur) |
| "Signaler" | Danger filled | `#E24B4A` (danger) | `#FFFFFF` | 8 px | Signalement annonce/user/message |
| "Annuler" | Ghost / texte seul | `transparent` | `#1A1A1A` | — | Action destructive légère |
| "Appliquer" | Primaire (modal) | `#1A1A1A` (niqo-black) | `#FFFFFF` | 8 px | Validation filtres modal |

**États MANQUANTS dans Figma (boucle d'enrichissement requise) :**
- État `disabled` pour toutes les variantes
- État `loading` (spinner) pour les boutons d'action asynchrone
- État `pressed` (feedback tactile)
- Variante taille `sm` (height 36 px — touch-sm)

### Badges & statuts

**ANNONCES.STATUT** (5 badges visuels) :

| Badge | Couleur observée | Mapping couleur |
|---|---|---|
| Active | Vert clair / texte vert | Success |
| En cours | Bleu clair / texte bleu | Info |
| Vendue | Gris moyen / texte foncé | Neutre |
| Suspendue | Rouge clair / texte rouge | Danger |
| Expirée | Gris clair / texte gris | Neutre muted |

**TRANSACTIONS.STATUT** (6 badges visibles, 8 au total dans le schéma SQL) :

| Badge Figma | Couleur observée |
|---|---|
| En attente | Gris clair |
| Escrow | Bleu clair |
| Code envoyé | Orange clair |
| Complete | Vert clair |
| Litige | Rouge clair |
| Remboursé | Bleu clair |

Manquants dans Figma : `expire` et `echoue` — dérivés dans `tailwind.config.ts`.

**CATÉGORIES** (11 tags) : Électronique, Vêtements, Meubles, Sports, Livres, Jeux vidéo, Autres, Véhicules, Beauté & Cosmétiques, Immobilier, Services — fond coral-light `#FAECE7`, texte coral `#D85A30`. Border-radius 8 px. Icônes lucide-react-native mappées dans `lib/categories.ts`.

### Card annonce

Structure d'une card produit (280 × 264 px dans Figma) :

```
┌─────────────────────────┐
│  [Image placeholder]    │  160 px de hauteur, border-radius 8 px intérieur
│  (fond catégorie teinté)│
├─────────────────────────┤
│  Titre annonce          │  Inter Semi Bold 17 px
│  XX XXX FCFA            │  JetBrains Mono Medium 24 px
│  [Tag catégorie] Lieu·Δt│  Caption 13 px
└─────────────────────────┘
```

Padding intérieur : 12 px. Border-radius card : 12 px. Fond : white.

**États implémentés :**
- Favori : cœur actif (filled coral, bounce Reanimated + haptic) / inactif (outline)
- Badge "Nouveau" : annonces < 24h
- Badge "Location"/"Vente" : annonces immobilier
- Prix "/mois" : locations immobilières
- Skeleton loading : `SkeletonCard` (placeholder animé)

### Composants implémentés (`components/ui/`)

| Composant | Fichier | Usage |
|---|---|---|
| `HomeHeader` | `HomeHeader.tsx` | Wordmark + favoris + onglets Annonces/Immo |
| `BottomNav` | `BottomNav.tsx` | Navigation 5 onglets (Home, Search, Sell, Messages, Profile) |
| `SearchBar` | `SearchBar.tsx` | Barre de recherche tap-to-navigate |
| `CategoryPill` | `CategoryPill.tsx` | Pill catégorie horizontale scrollable |
| `AnnouncementCard` | `AnnouncementCard.tsx` | Card annonce (image, titre, prix, ville, badge favori, badge immo) |
| `AuthGate` | `AuthGate.tsx` | Modal login browse-first (sell, messages, profile, favorite) |
| `WizardProgress` | `WizardProgress.tsx` | Barre progression wizard 5 étapes |
| `CityPicker` | `CityPicker.tsx` | Dropdown ville par pays |
| `TrustedAvatar` | `TrustedAvatar.tsx` | Avatar vendeur avec badge confiance (anneau vert + check) |
| `EmailVerificationBanner` | `EmailVerificationBanner.tsx` | Banner "Vérifie ton email" |
| `ReportButton` | `ReportButton.tsx` | Bouton signaler (annonce/user/message) |
| `ImmoFilters` | `ImmoFilters.tsx` | Filtres immo : Location/Vente, type bien, modal avancés (pièces, meublé, surface, prix) |
| `AnnoncesFiltersModal` | `AnnoncesFiltersModal.tsx` | Modal filtres annonces : état objet + prix min/max |

### Composants à implémenter (Phase 2)

| Composant | Priorité | Requis pour |
|---|---|---|
| `Toast / Snackbar` | Haute | Feedback actions (boost, signalement confirmé) |
| `RDVConfirmCard` | Haute | Confirmation RDV dans chat |
| `RatingStars` | Haute | Notation post-RDV (1-5 étoiles) |
| `VerificationBadge` | Moyenne | Badge "Vendeur vérifié" (CNI) |
| `BoostBadge` | Moyenne | Badge "Sponsorisé" sur annonce boostée |

---

## 5. Splash animation

**Frame Figma :** [Splash animation (`node-id=1-6`)](https://www.figma.com/design/aO5P9890olO8oJARLK9NdZ/Niqo-%E2%80%94-Brand-Identity---Design-System?node-id=1-6)

### Storyboard (5 keyframes)

| Temps | Description | État visuel |
|---|---|---|
| 0.0 s | Écran noir initial | Fond `#1A1A1A`, rien |
| 0.4 s | Texte apparaît avec écartement | `niqo.` en Space Grotesk, letter-spacing large → resserrement |
| 0.8 s | Texte se resserre, point pulse | Letter-spacing normalisé, point coral pulse (scale 0 → 1.6 → 1) |
| 1.2 s | Onde concentrique sur le point | Ellipse coral s'étend (scale 1 → 2.5, opacity 0.6 → 0) |
| 2.0 s | Tagline apparaît, état final | `niqo.` centré + "ACHÈTE EN CONFIANCE" fade-up depuis 10 px |

### Specs techniques (Figma 1:6)

| Paramètre | Valeur |
|---|---|
| Durée totale | 2 secondes |
| Easing | `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring léger avec légère surchauffe) |
| Animation 1 | Letter-spacing `5px → -1.5px` (resserrement du texte) |
| Animation 2 | Scale point coral `0 → 1.6 → 1` (pulse, puis stable) |
| Animation 3 | Onde `scale(1) → scale(2.5)`, opacity `0.6 → 0` |
| Animation 4 | Tagline `translateY(10px) opacity(0) → translateY(0) opacity(1)` |
| Loading time | ~1.5 s API ready (la splash tient jusqu'à résolution de l'auth Supabase) |

### État final

Logo `niqo.` centré verticalement avec tagline "ACHÈTE EN CONFIANCE" en Inter Caption 13 px, espacé en dessous.

### Recommandation technologique : Reanimated v3 (pas Lottie)

L'animation est **implémentable en Reanimated v3** car elle se compose de 4 animations simples séquencées (letter-spacing, scale, opacity, translate). La complexité est faible — pas de trajectoires complexes, pas de morphing de forme, pas de particules.

**Arguments contre Lottie :**
- Ajoute une dépendance native (`lottie-react-native`) et un binaire `.json` à maintenir
- Le letter-spacing animé (Animation 1) n'est pas supporté nativement dans Lottie sur React Native
- Reanimated v3 (avec `useSharedValue` + `withTiming` / `withSpring` + `withDelay`) gère tous les 4 cas
- L'easing `cubic-bezier(0.34, 1.56, 0.64, 1)` correspond à `withSpring` avec config `stiffness`/`damping`

**Décision : Reanimated v3 programmatique.**

---

## 6. Principes design

**Frame Figma :** [Design principles (`node-id=1-7`)](https://www.figma.com/design/aO5P9890olO8oJARLK9NdZ/Niqo-%E2%80%94-Brand-Identity---Design-System?node-id=1-7)

> "6 règles fondamentales pour garder Niqo cohérent à travers tous les écrans."

---

### Principe 01 — Confiance visible

Les actions principales (Contacter, Publier, Appliquer) utilisent le **noir Niqo** pour inspirer confiance. Le coral est réservé aux accents et CTA secondaires (wizard vendeur, badges).

*Implication code : les boutons `variant="primary"` sont noirs (`bg-niqo-black`). Le coral (`bg-niqo-coral`) est réservé au CTA du wizard vendeur et aux éléments d'accentuation.*

---

### Principe 02 — Coral parcimonieux

Le coral est un accent — point logo, FAB Publier, badges catégorie, notifications. Sur les actions positives uniquement. Si tout est coral, plus rien n'attire l'œil.

*Implication code : `bg-niqo-coral` est réservé aux accents. Les boutons d'action principale utilisent `bg-niqo-black`.*

---

### Principe 03 — Espaces respirants

Cards séparées par **12 px minimum** (`gap-3`). Padding intérieur de **16–32 px** (`p-4` à `p-8`). Jamais de contenu collé aux bordures. L'air rend l'interface lisible sur petits écrans Android low-end.

*Implication code : `p-0` et `gap-0` sont interdits dans les layouts de contenu. Minimum `p-4` sur toutes les cards.*

---

### Principe 04 — Coins arrondis 8 ou 12 px

**8 px** pour les boutons et badges (`rounded-btn`). **12 px** pour les cards et modales (`rounded-card`). Jamais de carrés durs (sauf séparateurs). Jamais de cercles sauf avatars et points coral.

*Implication code : `rounded-none` interdit sauf séparateurs. `rounded-full` réservé aux avatars et aux cercles coral de la splash.*

---

### Principe 05 — Monospace pour les chiffres

Prix, codes, numéros de téléphone — toujours en **JetBrains Mono**. Largeur fixe = alignement parfait. Lecture instantanée des montants FCFA même en scrollant rapidement.

*Implication code : tout `Text` affichant un montant FCFA, un numéro de téléphone, ou le code 6 caractères utilise `font-mono`. Les autres chiffres (pagination, compteurs UI) peuvent utiliser `font-body`.*

---

### Principe 06 — Mode sombre (Phase 2)

**Vrai noir `#0A0A0A`** prévu pour économiser la batterie OLED des Android low-end. Améliore aussi la lecture en plein soleil africain. **Différé Phase 2** — MVP en light mode uniquement.

*Implication code : les tokens dark (`niqo-dark-bg`) existent dans `tailwind.config.ts` mais ne sont pas consommés. Ne PAS ajouter de classes `dark:` en Phase 1.*

---

### Contraintes Africa (synthèse cross-principes)

Ces contraintes traversent tous les principes et s'appliquent à chaque écran :

| Contrainte | Règle |
|---|---|
| Réseau instable CI/CG | Tous les flows critiques (auth, création annonce, messagerie) ont un état hors-ligne avec message + bouton réessayer. Pas de crash sur `network error`. |
| Écrans low-end Android | Baseline 360 px (Tecno Spark / Itel A56). `flex` + `gap` sans `position: absolute` sauf exceptions. Touches ≥ 44×44 px. |
| Batterie OLED | Dark mode vrai noir `#0A0A0A` prévu Phase 2. Animations limitées (pas de loop infini sauf splash). |
| Plein soleil | Contraste WCAG AA minimum sur tous les textes. Le noir `#1A1A1A` sur `#FFFFFF` = ratio 18.1:1 (AAA). |
| Browse-first | Les écrans publics (Home, Search, AnnounceDetail) chargent sans compte. L'auth est déclenchée par l'action (contacter, favori, vendre), pas à l'entrée. |
| Dual mode Home | Onglets Annonces (marketplace classique) et Immo (immobilier) avec filtres dédiés par mode. Séparation étanche des résultats. |
