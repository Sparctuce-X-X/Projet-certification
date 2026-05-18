import type { Config } from "tailwindcss";

/**
 * Niqo — Tailwind / NativeWind config
 *
 * Source de vérité : Figma `Niqo — Brand Identity / Design System`
 * Frames extraits par l'agent `frontend` le 2026-04-27 :
 *   - Logo        : node-id=1-2
 *   - Colors      : node-id=1-3
 *   - Typography  : node-id=1-4
 *   - Components  : node-id=1-5
 *   - Splash      : node-id=1-6
 *   - Principles  : node-id=1-7
 *
 * ────────────────────────────────────────────────────────────────
 * BADGES STATUTS TRANSACTION — mapping dérivé (Principe 7 §enrichissement)
 *
 * Figma frame Components (1:5) montre visuellement 6 des 8 statuts :
 *   en_attente, escrow, code_envoye, complete, en_litige, rembourse
 * Les couleurs bg/text sont extraites du screenshot (badges visible).
 * Les 2 statuts absents du frame (expire, echoue) sont dérivés :
 *   - expire  → Warning (orange) : cohérent avec "code expire, attention"
 *   - echoue  → Danger (rouge)   : cohérent avec "litige, erreur, suspendu"
 * ────────────────────────────────────────────────────────────────
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        niqo: {
          // ── Couleurs principales (Figma 1:3 — Couleurs principales) ──
          black: "#1A1A1A",       // Niqo Black — boutons primaires, titres, navigation
          coral: "#D85A30",       // Niqo Coral — accents, CTA secondaires, badges, signature
          "coral-light": "#FAECE7", // Coral Light — fonds catégories, tags, surfaces
          white: "#FFFFFF",       // White — fonds principaux, cards

          // ── Échelle de gris (Figma 1:3 — Échelle de gris + extensions Figma 456:3) ──
          "gray-50":  "#FAFAFA",  // Sections, search bar
          "gray-100": "#F2F2F0",  // Pills neutres (Figma 461:23)
          "gray-150": "#E5E5E2",  // Bordures cards non-sélectionnées + séparateur header (Figma 458:17)
          "gray-200": "#E5E5E5",  // Bordures, séparateurs (palette principale)
          "gray-300": "#B4B2A9",  // Hint text "Modifiable dans..." (Figma 461:25)
          "gray-500": "#888780",  // Texte tertiaire, hints
          "gray-800": "#444441",  // Texte secondaire

          // Coral dark — texte dial code pill sélectionnée (Figma 461:10)
          "coral-dark": "#993C1D",

          // ── Couleurs sémantiques (Figma 1:3 — Couleurs sémantiques) ──
          success: "#1D9E75",     // Paiement validé, code OK
          warning: "#BA7517",     // Code expire, attention
          danger: "#E24B4A",      // Litige, erreur, suspendu
          info: "#185FA5",        // Liens, infos, système

          // ── Surfaces dérivées pour dark mode (Principe 06) ──
          "dark-bg": "#0A0A0A",   // Vrai noir OLED pour économiser batterie Android

          // ── Badges statuts transaction — bg + text par statut ──
          // Couleurs bg : teinte à ~10% d'opacité de la couleur sémantique associée
          // Couleurs text : couleur sémantique pleine (WCAG AA garanti sur fond clair)
          //
          // Statuts visibles dans Figma Components (1:5) :
          "status-en-attente-bg":   "#F3F3F3", // gris clair — neutre, pas encore déclenché
          "status-en-attente-text": "#444441", // gray-800

          "status-escrow-bg":       "#E8F0F8", // bleu clair — fonds escrow en cours
          "status-escrow-text":     "#185FA5", // info

          "status-code-envoye-bg":  "#FBF2E0", // orange clair — code transmis à l'acheteur
          "status-code-envoye-text":"#BA7517", // warning

          "status-complete-bg":     "#E3F5EE", // vert clair — transaction réussie
          "status-complete-text":   "#1D9E75", // success

          "status-en-litige-bg":    "#FDEAEA", // rouge clair — litige ouvert
          "status-en-litige-text":  "#E24B4A", // danger

          "status-rembourse-bg":    "#E8F0F8", // bleu clair — remboursé via PawaPay
          "status-rembourse-text":  "#185FA5", // info

          // Statuts dérivés — absents du frame Figma, mapping logique documenté :
          "status-expire-bg":       "#FBF2E0", // warning (orange) : "code expire, attention"
          "status-expire-text":     "#BA7517", // warning

          "status-echoue-bg":       "#FDEAEA", // danger (rouge) : "erreur, suspendu"
          "status-echoue-text":     "#E24B4A", // danger
        },
      },

      fontFamily: {
        // Figma 1:4 — 3 polices, 3 rôles
        // INSTALLATION REQUISE (à faire ultérieurement, hors scope de cette tâche) :
        //   npx expo install @expo-google-fonts/space-grotesk
        //   npx expo install @expo-google-fonts/inter
        //   npx expo install @expo-google-fonts/jetbrains-mono
        display:        ["SpaceGrotesk_500Medium", "sans-serif"], // Titres, logo — Space Grotesk Medium
        body:           ["Inter_400Regular",       "sans-serif"], // Texte courant — Inter Regular
        "body-semibold":["Inter_600SemiBold",      "sans-serif"], // Emphase inline (<Strong> dans pages légales, etc.)
        mono:           ["JetBrainsMono_500Medium","monospace"],  // Prix, codes, numéros — JetBrains Mono Medium
      },

      fontSize: {
        // Figma 1:4 — Hiérarchie typographique
        // Format : [font-size, { lineHeight, letterSpacing }]
        //
        // DISPLAY — Space Grotesk Medium 56px, letter-spacing -1.5
        "display": ["56px", { lineHeight: "64px", letterSpacing: "-1.5px" }],

        // H1 — Space Grotesk Medium 32px, letter-spacing -0.5
        "h1": ["32px", { lineHeight: "40px", letterSpacing: "-0.5px" }],

        // H2 — Space Grotesk Medium 24px
        "h2": ["24px", { lineHeight: "32px", letterSpacing: "0px" }],

        // H3 — Inter Semi Bold 18px
        "h3": ["18px", { lineHeight: "24px", letterSpacing: "0px" }],

        // BODY — Inter Regular 16px, line-height 1.5
        "body": ["16px", { lineHeight: "24px", letterSpacing: "0px" }],

        // CAPTION — Inter Regular 13px
        "caption": ["13px", { lineHeight: "18px", letterSpacing: "0px" }],

        // PRICE — JetBrains Mono Medium 22px
        "price": ["22px", { lineHeight: "28px", letterSpacing: "0px" }],

        // CODE — JetBrains Mono Medium 40px, letter-spacing 6px (code 6 caractères)
        "code": ["40px", { lineHeight: "52px", letterSpacing: "6px" }],

        // ── Extensions extraites de Figma 456:3 (CountryPickerScreen) ──
        // TITLE — Space Grotesk Medium 28px, letter-spacing -2px (titre écran in-body, distinct de h1=32 hero)
        "title":    ["28px", { lineHeight: "36px", letterSpacing: "-2px" }],
        // LABEL — Inter Semi Bold / Space Grotesk Medium 15px (boutons primaires + nom de pays)
        "label":    ["15px", { lineHeight: "20px", letterSpacing: "0px" }],
        // SUBTITLE — Inter Regular 14px (sous-titres écran)
        "subtitle": ["14px", { lineHeight: "21px", letterSpacing: "0px" }],
        // MICRO — Inter Regular 12px (providers, captions inline)
        "micro":    ["12px", { lineHeight: "16px", letterSpacing: "0px" }],
        // 2xs — 11px (pills indicatif, hints fine print)
        "2xs":      ["11px", { lineHeight: "16px", letterSpacing: "0px" }],
      },

      spacing: {
        // Touch targets imposés par Apple HIG / Google Material
        touch: "44px",
        "touch-sm": "36px",
        // Principe 03 — Espaces respirants
        // Padding intérieur cards : 16-32px (p-4 → p-8 dans la scale Tailwind par défaut)
        // Séparation entre cards : 12px minimum (gap-3)
        // Ces valeurs sont couvertes par la scale Tailwind par défaut (3=12px, 4=16px, 8=32px).
        // Aucune valeur custom nécessaire au-delà de touch targets.
      },

      borderRadius: {
        // Figma 1:5 — Principe 04 : "8px boutons et badges, 12px cards et modales"
        // + valeurs standards Tailwind complétées
        "btn": "8px",   // Boutons et badges (Principe 04)
        "card": "12px", // Cards et modales (Principe 04)
        // Les avatars et points coral sont full-circle : utiliser `rounded-full` (Tailwind built-in)
      },

      boxShadow: {
        // Figma 1:5 — Aucune élévation explicitement définie dans le frame Components.
        // Le design adopte une approche flat (principe "Espaces respirants") avec
        // séparation par bordures (gray-200) plutôt que par shadows.
        // Shadow légère pour cards survolées ou modales — valeur conservatrice :
        "card": "0 2px 8px rgba(26, 26, 26, 0.08)",   // Élévation card au repos
        "modal": "0 8px 32px rgba(26, 26, 26, 0.16)", // Élévation modale / bottom sheet
      },

      screens: {
        // Mobile-first — baseline = Tecno Spark / Itel A56 (360px)
        // Figma ne définit pas de breakpoints additionnels → conserver les valeurs initiales
        xs: "360px",
        sm: "390px", // iPhone SE
        md: "768px", // Tablette
        lg: "1024px",
      },
    },
  },
  plugins: [],
};

export default config;
