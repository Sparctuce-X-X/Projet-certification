import {
  Shield,
  MessageCircle,
  Star,
  MapPin,
  CheckCircle,
  ArrowUpRight,
  BadgeCheck,
  Quote,
  TrendingUp,
  Check,
} from "lucide-react";
import Image from "next/image";
import { FadeUp, ScaleIn } from "@/components/AnimatedSection";
import { LegalLinksNav } from "@/components/legal/LegalFooter";
import { PhoneMockup } from "@/components/PhoneMockup";

const STORE_LINKS = {
  playStore: "#", // TODO: lien Google Play (Phase 2 launch Android)
  appStore: "https://apps.apple.com/app/niqo-annonces-afrique/id6769410032",
};

// Drapeaux SVG officiels (couleurs ISO 3166) — exception au token system
function FlagCI({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 9 6" className={className} aria-hidden>
      <rect width="3" height="6" fill="#FF8200" />
      <rect x="3" width="3" height="6" fill="#FFFFFF" />
      <rect x="6" width="3" height="6" fill="#009E60" />
    </svg>
  );
}

function FlagCG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 9 6" className={className} aria-hidden>
      <rect width="9" height="6" fill="#FBDE4A" />
      <polygon points="0,0 7,0 0,6" fill="#009543" />
      <polygon points="9,0 9,6 2,6" fill="#DC241F" />
    </svg>
  );
}

// Avatars contrôlés — coral + black + success seulement, en rotation
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #D85A30 0%, #A8421F 100%)",
  "linear-gradient(135deg, #1A1A1A 0%, #444441 100%)",
  "linear-gradient(135deg, #D85A30 0%, #1A1A1A 100%)",
  "linear-gradient(135deg, #1D9E75 0%, #145A43 100%)",
  "linear-gradient(135deg, #444441 0%, #1A1A1A 100%)",
];

type CityCode = "CI" | "CG";

const UNSPLASH = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=120&h=120&fit=crop&q=60`;

const CITIES: Array<{
  name: string;
  country: string;
  code: CityCode;
  listings: { title: string; price: string; area: string; image: string }[];
  today: number;
}> = [
  {
    name: "Brazzaville",
    country: "Congo",
    code: "CG",
    listings: [
      {
        title: "MacBook Air M2",
        price: "650 000",
        area: "Bacongo",
        image: UNSPLASH("1717865499857-ec35ce6e65fa"),
      },
      {
        title: "Canapé 3 places cuir",
        price: "120 000",
        area: "Poto-Poto",
        image: UNSPLASH("1578112010316-b44c50d27b2b"),
      },
      {
        title: "Console PS5 + 2 manettes",
        price: "320 000",
        area: "Mfilou",
        image: UNSPLASH("1670535787435-63a39a5b8d32"),
      },
    ],
    today: 87,
  },
];

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "Niqo est gratuit ?",
    a: "Oui, totalement gratuit pour acheter et publier tes premières annonces. Niqo se rémunère uniquement sur des services optionnels pour les vendeurs : vérification d'identité (1 000 FCFA), boost d'annonce (à partir de 1 000 FCFA), et abonnement Pro à venir. Aucune commission sur les ventes, aucun frais caché.",
  },
  {
    q: "Quelle différence avec WhatsApp ou Facebook Marketplace ?",
    a: "Sur WhatsApp ou Facebook, n'importe qui peut se faire passer pour un vendeur fiable. Pas de vérification d'identité, pas de système de notation, pas de modération. Niqo apporte les 4 piliers : vérification CNI + selfie, notation après chaque RDV, modération communautaire (3 signalements = suspension auto), et historique public sur chaque profil.",
  },
  {
    q: "Comment me faire vérifier ?",
    a: "Tu envoies une photo de ta CNI (recto + verso) + un selfie depuis l'app. Notre équipe valide en moins de 24h, et le badge « Vendeur vérifié » apparaît sur ton profil et toutes tes annonces. La vérification coûte 1 000 FCFA (one-shot, à vie). Obligatoire pour publier plus de 3 annonces.",
  },
  {
    q: "Que se passe-t-il si je tombe sur une arnaque ?",
    a: "Tu peux signaler n'importe quel utilisateur, annonce ou message en un clic. 3 signalements confirmés en 30 jours suspendent automatiquement le compte. Le téléphone et l'email du fraudeur sont blacklistés. La levée de suspension demande 1 000 FCFA + revue admin — ce qui décourage les récidivistes.",
  },
  {
    q: "Niqo touche-t-il à mon argent ?",
    a: "Non, jamais. L'acheteur et le vendeur s'arrangent en direct le jour du RDV : cash, Mobile Money entre eux, virement, comme ils veulent. Niqo n'intervient pas dans le flux financier. C'est volontaire — pour rester simple, rapide et sans frais bancaires qui mangeraient les petits montants.",
  },
  {
    q: "C'est dispo dans quels pays ?",
    a: "Lancement officiel à Brazzaville (République du Congo). Abidjan, Dakar et Douala arrivent en Phase 2. Niqo est conçu pour l'Afrique francophone — interface 100 % en français, prix en FCFA, paiements Mobile Money locaux (Airtel Money, MTN Mobile Money).",
  },
];

const FAQ_PAGE_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: {
      "@type": "Answer",
      text: a,
    },
  })),
} as const;

const STATS: Array<{ value: string; suffix: string; label: string }> = [
  { value: "4.8", suffix: "★", label: "Note moyenne post-RDV" },
  { value: "500", suffix: "+", label: "Utilisateurs en bêta" },
  { value: "0", suffix: "%", label: "Commission sur tes ventes" },
  { value: "< 24", suffix: "h", label: "Validation vérification" },
];

const TRUST_BAR_ITEMS: Array<{ label: string; highlight?: string }> = [
  { label: "Présent à", highlight: "Brazzaville" },
  { label: "Données chiffrées ·", highlight: "RGPD" },
  { label: "Modération humaine", highlight: "24h" },
];

const COMMITMENTS: Array<{ label: string; detail: string }> = [
  {
    label: "Zéro commission sur tes ventes",
    detail:
      "On vit des services optionnels aux vendeurs — boosts, vérification, Pack Pro. Jamais des transactions entre toi et l'acheteur.",
  },
  {
    label: "Niqo ne touche pas à ton argent",
    detail:
      "Acheteur et vendeur s'arrangent en direct le jour du RDV. Cash, Mobile Money. Nous, on facilite la rencontre.",
  },
  {
    label: "Modération humaine, 24h max",
    detail:
      "Filtre auto sur les messages, signalements validés à la main par notre équipe. 3 signalements confirmés = suspension.",
  },
  {
    label: "Identités réelles, pas des pseudos",
    detail:
      "Vérification CNI recto + verso + selfie. Validé manuellement. Obligatoire au-delà de 3 annonces.",
  },
];

const TESTIMONIALS = [
  {
    initials: "AK",
    name: "Aïcha K.",
    role: "Acheteuse · Bacongo",
    quote:
      "J'ai acheté mon iPhone à un vendeur vérifié. Rendez-vous dans un café, vérification, paiement cash. Zéro stress.",
    rating: 5,
  },
  {
    initials: "PM",
    name: "Patrick M.",
    role: "Vendeur vérifié · Poto-Poto",
    quote:
      "Mes annonces partent en 48h. Le badge vérifié change tout : les acheteurs me font confiance dès le premier message.",
    rating: 5,
  },
  {
    initials: "SD",
    name: "Sékou D.",
    role: "Vendeur Pro · Talangaï",
    quote:
      "WhatsApp c'était l'enfer pour gérer plusieurs annonces. Niqo centralise tout, et le système de notation me protège.",
    rating: 5,
  },
];

function PlayStoreBadge({ variant = "dark" }: { variant?: "dark" | "white" }) {
  const bg =
    variant === "white"
      ? "bg-white text-niqo-black hover:bg-niqo-gray-50"
      : "bg-niqo-black text-white hover:bg-niqo-black/90";
  return (
    <a
      href={STORE_LINKS.playStore}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2.5 ${bg} px-6 py-3.5 rounded-2xl transition-colors duration-200 cursor-pointer min-h-[44px]`}
    >
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" aria-hidden>
        <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.302 2.302-2.302 2.302-2.624-2.302 2.624-2.302zM5.864 2.658L16.8 8.99l-2.302 2.302-8.635-8.635z" />
      </svg>
      <span className="text-left">
        <span className="block text-[10px] leading-none opacity-70">
          Disponible sur
        </span>
        <span className="block text-sm font-semibold leading-tight">
          Google Play
        </span>
      </span>
    </a>
  );
}

function AppStoreBadge({ variant = "dark" }: { variant?: "dark" | "white" }) {
  const bg =
    variant === "white"
      ? "bg-white text-niqo-black hover:bg-niqo-gray-50"
      : "bg-niqo-black text-white hover:bg-niqo-black/90";
  return (
    <a
      href={STORE_LINKS.appStore}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2.5 ${bg} px-6 py-3.5 rounded-2xl transition-colors duration-200 cursor-pointer min-h-[44px]`}
    >
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" aria-hidden>
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
      <span className="text-left">
        <span className="block text-[10px] leading-none opacity-70">
          Télécharger sur
        </span>
        <span className="block text-sm font-semibold leading-tight">
          App Store
        </span>
      </span>
    </a>
  );
}

function StarRow({ count = 5 }: { count?: number }) {
  return (
    <div
      role="img"
      aria-label={`${count} étoiles sur 5`}
      className="flex gap-0.5"
    >
      {Array.from({ length: count }).map((_, i) => (
        <Star
          key={i}
          className="w-4 h-4 fill-niqo-coral text-niqo-coral"
          aria-hidden
        />
      ))}
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="flex-1 overflow-x-hidden bg-niqo-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_PAGE_LD) }}
      />
      {/* ── Floating navbar ─────────────────────────────────────────────── */}
      <nav className="fixed top-4 inset-x-4 z-50 max-w-6xl mx-auto">
        <div className="bg-white/85 backdrop-blur-xl border border-niqo-gray-200/80 rounded-2xl shadow-sm">
          <div className="px-5 sm:px-6 h-14 flex items-center justify-between">
            <a
              href="#top"
              className="flex items-baseline cursor-pointer min-h-[44px] -mx-2 px-2 py-2"
              aria-label="Accueil Niqo"
            >
              <span className="font-display text-xl font-bold text-niqo-black">
                niqo
              </span>
              <span className="font-display text-xl font-bold text-niqo-coral">
                .
              </span>
            </a>

            {/* Liens desktop — cachés en mobile */}
            <div className="hidden md:flex items-center gap-3 lg:gap-5">
              <a
                href="#decouvrir"
                className="font-medium text-sm text-niqo-gray-800 hover:text-niqo-black transition-colors duration-200 cursor-pointer min-h-[44px] inline-flex items-center px-3"
              >
                Découvrir
              </a>
              <a
                href="#faq"
                className="font-medium text-sm text-niqo-gray-800 hover:text-niqo-black transition-colors duration-200 cursor-pointer min-h-[44px] inline-flex items-center px-3"
              >
                FAQ
              </a>
            </div>

            <a
              href="#download"
              className="bg-niqo-black text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-niqo-black/85 transition-colors duration-200 cursor-pointer min-h-[44px] inline-flex items-center"
            >
              Télécharger
            </a>
          </div>
        </div>
      </nav>

      {/* ── HERO éditorial XXL ──────────────────────────────────────────── */}
      <section
        id="top"
        className="relative pt-24 sm:pt-32 pb-16 sm:pb-28 overflow-hidden"
      >
        {/* Aurora coral en fond */}
        <div
          className="absolute -top-40 -right-32 w-[700px] h-[700px] rounded-full opacity-60 blur-[140px]"
          style={{
            background:
              "radial-gradient(circle, #FAECE7 0%, #D85A30 35%, transparent 70%)",
          }}
          aria-hidden
        />
        <div
          className="absolute top-1/3 -left-40 w-[500px] h-[500px] rounded-full opacity-30 blur-[120px]"
          style={{
            background:
              "radial-gradient(circle, #FAECE7 0%, transparent 70%)",
          }}
          aria-hidden
        />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          {/* Tag location */}
          <FadeUp>
            <div className="inline-flex items-center gap-2 bg-white border border-niqo-gray-200 px-3 sm:px-4 py-2 rounded-full shadow-sm mb-6 sm:mb-8 max-w-full">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-niqo-success opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-niqo-success" />
              </span>
              <span className="font-medium text-xs sm:text-sm text-niqo-gray-800">
                En ligne à <strong className="text-niqo-black">Brazzaville</strong>
              </span>
            </div>
          </FadeUp>

          {/* Mega type — bord à bord */}
          <FadeUp delay={0.05}>
            <h1
              className="font-display font-bold text-niqo-black"
              style={{
                fontSize: "var(--text-mega)",
                lineHeight: "var(--text-mega--line-height)",
                letterSpacing: "var(--text-mega--letter-spacing)",
              }}
            >
              Achète.
              <br />
              Vends.
              <br />
              <span className="text-niqo-coral">En confiance.</span>
            </h1>
          </FadeUp>

          {/* Subline + actions + mockup */}
          <div className="mt-8 sm:mt-12 lg:mt-16 grid lg:grid-cols-12 gap-10 lg:gap-8 items-end">
            <div className="lg:col-span-7">
              <FadeUp delay={0.15}>
                <p className="text-base sm:text-lg lg:text-xl text-niqo-gray-800 max-w-xl leading-relaxed">
                  La marketplace mobile de Brazzaville. Vendeurs vérifiés à
                  la pièce d&apos;identité, chat sécurisé, rendez-vous en
                  personne. Paie cash ou Mobile Money — Niqo ne touche pas à
                  ton argent.
                </p>
              </FadeUp>

              <FadeUp delay={0.25}>
                <div className="mt-8 flex flex-wrap gap-3">
                  <PlayStoreBadge />
                  <AppStoreBadge />
                </div>
              </FadeUp>

              <FadeUp delay={0.35}>
                <div className="mt-10 flex items-center gap-5">
                  <div className="flex -space-x-2.5">
                    {["AK", "PM", "SD", "RC", "MO"].map((init, i) => (
                      <div
                        key={init}
                        className="w-9 h-9 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-semibold text-white"
                        style={{
                          background:
                            AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length],
                        }}
                      >
                        {init}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <StarRow />
                      <span className="font-mono text-sm font-medium text-niqo-black">
                        4.8
                      </span>
                    </div>
                    <p className="text-xs text-niqo-gray-500 mt-0.5">
                      <span className="font-mono font-medium text-niqo-gray-800">
                        500+
                      </span>{" "}
                      utilisateurs en bêta
                    </p>
                  </div>
                </div>
              </FadeUp>
            </div>

            {/* Mockup — désaxé, ancré à droite */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <PhoneMockup className="lg:-mr-6 lg:rotate-[3deg]" priority />
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAND + TRUST STRIP — crédibilité one-two punch ────────── */}
      <section className="relative z-10 border-y border-niqo-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {/* 4 chiffres Niqo en JetBrains Mono */}
          <FadeUp>
            <div
              className="grid grid-cols-2 sm:grid-cols-4"
              role="list"
              aria-label="Chiffres clés Niqo"
            >
              {STATS.map((stat, i) => {
                const mobileLeft =
                  i % 2 === 1 ? "border-l border-niqo-gray-200" : "";
                const mobileTop =
                  i >= 2 ? "border-t border-niqo-gray-200 sm:border-t-0" : "";
                const desktopLeft =
                  i > 0 ? "sm:border-l sm:border-niqo-gray-200" : "";
                return (
                  <div
                    key={stat.label}
                    role="listitem"
                    className={`px-3 sm:px-6 py-7 sm:py-9 flex flex-col items-center text-center ${mobileLeft} ${mobileTop} ${desktopLeft}`}
                  >
                    <div className="flex items-baseline gap-0.5">
                      <span className="font-mono text-3xl sm:text-4xl lg:text-5xl font-bold text-niqo-black tracking-tight">
                        {stat.value}
                      </span>
                      <span className="font-mono text-xl sm:text-2xl lg:text-3xl font-bold text-niqo-coral">
                        {stat.suffix}
                      </span>
                    </div>
                    <div className="mt-1.5 sm:mt-2.5 text-[10px] sm:text-xs font-medium uppercase tracking-wider text-niqo-gray-500 leading-tight max-w-[140px]">
                      {stat.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </FadeUp>

          {/* Trust strip — entité + conformité + modération */}
          <FadeUp delay={0.1}>
            <div className="border-t border-niqo-gray-200 py-3.5 sm:py-4 flex flex-wrap items-center justify-center gap-x-2.5 sm:gap-x-4 gap-y-1.5">
              {TRUST_BAR_ITEMS.map((item, i) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-2 font-mono text-[10px] sm:text-xs uppercase tracking-wider text-niqo-gray-500"
                >
                  {i > 0 && (
                    <span
                      aria-hidden
                      className="inline-block w-1 h-1 rounded-full bg-niqo-gray-200 mr-1.5 sm:mr-2.5"
                    />
                  )}
                  <span>
                    {item.label}
                    {item.highlight ? (
                      <>
                        {" "}
                        <span className="text-niqo-gray-800 font-semibold">
                          {item.highlight}
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── BENTO trust 4 piliers ───────────────────────────────────────── */}
      <section className="py-14 sm:py-20 lg:py-28 bg-niqo-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 mb-10 sm:mb-12 lg:mb-16 items-end">
            <div className="lg:col-span-7">
              <FadeUp>
                <p className="text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-3">
                  La confiance par défaut
                </p>
                <h2
                  className="font-display font-bold text-niqo-black"
                  style={{
                    fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
                    lineHeight: "0.98",
                    letterSpacing: "-0.035em",
                  }}
                >
                  4 piliers,
                  <br />
                  <span className="text-niqo-coral">zéro arnaque</span>.
                </h2>
              </FadeUp>
            </div>
            <div className="lg:col-span-5">
              <FadeUp delay={0.1}>
                <p className="text-base text-niqo-gray-800 max-w-md leading-relaxed">
                  WhatsApp et Facebook ne te protègent pas. Niqo intègre la
                  confiance directement dans le produit — vérifications,
                  notation, modération communautaire.
                </p>
              </FadeUp>
            </div>
          </div>

          {/* Bento grid — 6 colonnes, asymétrique */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 sm:gap-5 auto-rows-[minmax(0,_1fr)]">
            {/* Card 1 — Vérification (large) */}
            <ScaleIn className="lg:col-span-4 lg:row-span-2">
              <div className="h-full bg-niqo-black rounded-3xl p-6 sm:p-8 lg:p-10 text-white relative overflow-hidden">
                <div
                  className="absolute -top-20 -right-20 w-64 h-64 rounded-full opacity-30 blur-3xl"
                  style={{ background: "#D85A30" }}
                  aria-hidden
                />
                <div className="relative">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-niqo-coral/15 backdrop-blur-sm mb-6">
                    <Shield className="w-7 h-7 text-niqo-coral" />
                  </div>
                  <h3 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 leading-tight">
                    Vérifié à la pièce d&apos;identité.
                  </h3>
                  <p className="text-white/70 leading-relaxed max-w-md mb-8">
                    CNI recto/verso + selfie. Validation manuelle en moins de
                    24h. Le badge est visible sur chaque profil et chaque
                    annonce.
                  </p>

                  {/* Mini badge mockup */}
                  <div className="inline-flex items-center gap-3 bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl px-4 py-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                      style={{ background: AVATAR_GRADIENTS[0] }}
                    >
                      AK
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm">Aïcha K.</span>
                        <BadgeCheck className="w-4 h-4 text-niqo-success fill-niqo-success/15" />
                      </div>
                      <span className="text-xs text-white/60">
                        Vendeur vérifié · 12 ventes
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </ScaleIn>

            {/* Card 2 — Notation */}
            <ScaleIn delay={0.05} className="lg:col-span-2">
              <div className="h-full bg-white rounded-3xl p-6 lg:p-7 border border-niqo-gray-200 flex flex-col">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-niqo-coral-light mb-5">
                  <Star className="w-6 h-6 text-niqo-coral fill-niqo-coral" />
                </div>
                <h3 className="font-display text-xl font-bold text-niqo-black mb-2">
                  Noté après chaque RDV.
                </h3>
                <p className="text-sm text-niqo-gray-800 leading-relaxed mb-5">
                  1 à 5 étoiles + commentaire. Auto 3/5 si pas de réponse en
                  7j. Historique public.
                </p>
                <div className="mt-auto pt-3 border-t border-niqo-gray-100">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-3xl font-bold text-niqo-black">
                      4.8
                    </span>
                    <StarRow />
                  </div>
                </div>
              </div>
            </ScaleIn>

            {/* Card 3 — Chat sécurisé */}
            <ScaleIn delay={0.1} className="lg:col-span-2">
              <div className="h-full bg-white rounded-3xl p-6 lg:p-7 border border-niqo-gray-200 flex flex-col">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-niqo-coral-light mb-5">
                  <MessageCircle className="w-6 h-6 text-niqo-coral" />
                </div>
                <h3 className="font-display text-xl font-bold text-niqo-black mb-2">
                  Chat tracé, pas WhatsApp.
                </h3>
                <p className="text-sm text-niqo-gray-800 leading-relaxed mb-5">
                  Toute la négociation reste dans l&apos;app. Modération anti
                  arnaque automatique sur les mots-clés sensibles.
                </p>
                <div className="mt-auto space-y-1.5">
                  <div className="bg-niqo-gray-50 rounded-xl rounded-bl-sm px-3 py-2 text-xs text-niqo-black max-w-[80%]">
                    Bonjour, c&apos;est dispo ?
                  </div>
                  <div className="bg-niqo-coral text-white rounded-xl rounded-br-sm px-3 py-2 text-xs max-w-[80%] ml-auto">
                    Oui ! On peut se voir demain ?
                  </div>
                </div>
              </div>
            </ScaleIn>

            {/* Card 4 — RDV physique (large horizontal) */}
            <ScaleIn delay={0.15} className="lg:col-span-6">
              <div className="bg-gradient-to-br from-niqo-coral-light to-white rounded-3xl p-6 sm:p-8 lg:p-10 border border-niqo-coral/10 flex flex-col sm:flex-row gap-6 sm:gap-10 items-start sm:items-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white shadow-sm shrink-0">
                  <MapPin className="w-7 h-7 text-niqo-coral" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-2xl sm:text-3xl font-bold text-niqo-black mb-2 leading-tight">
                    RDV en personne. Paiement direct.
                  </h3>
                  <p className="text-base text-niqo-gray-800 leading-relaxed max-w-xl">
                    Niqo facilite la rencontre, pas la transaction. Tu vois le
                    produit, tu paies cash ou Mobile Money, tu repars. Pas de
                    commission, pas d&apos;escrow.
                  </p>
                </div>
                <div className="hidden sm:flex flex-col items-end gap-1">
                  <span className="font-mono text-4xl font-bold text-niqo-coral">
                    0%
                  </span>
                  <span className="text-xs text-niqo-gray-500 uppercase tracking-wider">
                    de commission
                  </span>
                </div>
              </div>
            </ScaleIn>
          </div>
        </div>
      </section>

      {/* ── SHOWCASE produits + ancrage Brazzaville (Abidjan teasing) ──── */}
      <section className="py-14 sm:py-20 lg:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-10 sm:mb-12 lg:mb-16 max-w-3xl">
            <FadeUp>
              <p className="text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-3">
                Hyper-local
              </p>
              <h2
                className="font-display font-bold text-niqo-black"
                style={{
                  fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
                  lineHeight: "0.98",
                  letterSpacing: "-0.035em",
                }}
              >
                Ce qui se vend
                <br />
                <span className="text-niqo-coral">aujourd&apos;hui</span>.
              </h2>
            </FadeUp>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {CITIES.map((city, idx) => (
              <FadeUp key={city.name} delay={idx * 0.1}>
                <div className="bg-niqo-gray-50 rounded-3xl p-5 sm:p-6 lg:p-8 h-full flex flex-col">
                  {/* Header ville */}
                  <div className="flex items-start justify-between gap-3 mb-5 sm:mb-6">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        {city.code === "CI" ? (
                          <FlagCI className="w-5 h-[14px] rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" />
                        ) : (
                          <FlagCG className="w-5 h-[14px] rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" />
                        )}
                        <span className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-niqo-gray-500 truncate">
                          {city.country}
                        </span>
                      </div>
                      <h3 className="font-display text-2xl sm:text-3xl font-bold text-niqo-black">
                        {city.name}
                      </h3>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="inline-flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-niqo-success" />
                        <span className="font-mono text-2xl sm:text-3xl font-bold text-niqo-success">
                          +{city.today}
                        </span>
                      </div>
                      <div className="text-[9px] sm:text-[10px] text-niqo-gray-500 uppercase tracking-wider mt-0.5 leading-tight">
                        annonces<br />aujourd&apos;hui
                      </div>
                    </div>
                  </div>

                  {/* Annonces */}
                  <div className="space-y-3 flex-1">
                    {city.listings.map((listing) => (
                      <div
                        key={listing.title}
                        className="group bg-white rounded-2xl p-4 flex items-center gap-4 border border-transparent hover:border-niqo-coral/30 transition-colors duration-200 cursor-default"
                      >
                        <div className="relative w-14 h-14 rounded-xl shrink-0 overflow-hidden bg-niqo-gray-100">
                          <Image
                            src={listing.image}
                            alt={listing.title}
                            fill
                            sizes="56px"
                            className="object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-niqo-black truncate">
                            {listing.title}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <MapPin className="w-3 h-3 text-niqo-gray-500" />
                            <span className="text-xs text-niqo-gray-500">
                              {listing.area}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-base font-bold text-niqo-black">
                            {listing.price}
                          </div>
                          <div className="text-[10px] text-niqo-gray-500 uppercase tracking-wider">
                            FCFA
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 pt-6 border-t border-niqo-gray-200">
                    <span className="text-sm text-niqo-gray-800">
                      Toutes catégories · Tous quartiers
                    </span>
                  </div>
                </div>
              </FadeUp>
            ))}

            {/* Carte teasing Abidjan — Phase 2 */}
            <FadeUp delay={0.15}>
              <div className="relative bg-niqo-gray-50 rounded-3xl p-5 sm:p-6 lg:p-8 h-full flex flex-col overflow-hidden">
                <div
                  className="absolute -top-20 -right-20 w-48 h-48 rounded-full opacity-30 blur-3xl"
                  style={{
                    background:
                      "radial-gradient(circle, #FAECE7 0%, transparent 70%)",
                  }}
                  aria-hidden
                />
                <div className="relative flex items-start justify-between gap-3 mb-5 sm:mb-6">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <FlagCI className="w-5 h-[14px] rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.06)] opacity-60" />
                      <span className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-niqo-gray-500 truncate">
                        Côte d&apos;Ivoire
                      </span>
                    </div>
                    <h3 className="font-display text-2xl sm:text-3xl font-bold text-niqo-gray-500">
                      Abidjan
                    </h3>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1.5 bg-white border border-niqo-coral/20 px-2.5 py-1 rounded-full">
                      <span className="relative flex h-1.5 w-1.5 shrink-0">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-niqo-coral opacity-60 animate-ping" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-niqo-coral" />
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-niqo-coral font-semibold">
                        Bientôt
                      </span>
                    </span>
                  </div>
                </div>

                <div className="relative flex-1 flex flex-col items-center justify-center text-center py-8 sm:py-10">
                  <p className="font-display text-xl sm:text-2xl font-bold text-niqo-black mb-2 max-w-xs leading-tight">
                    Niqo arrive à Abidjan.
                  </p>
                  <p className="text-sm text-niqo-gray-800 leading-relaxed max-w-xs mb-6">
                    Cocody, Plateau, Treichville. Inscris-toi à la liste d&apos;attente pour être prévenu·e au lancement.
                  </p>
                  <a
                    href="mailto:hello@niqo.africa?subject=Liste%20d%27attente%20Abidjan"
                    className="inline-flex items-center gap-2 bg-niqo-black text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-niqo-black/85 transition-colors duration-200 cursor-pointer min-h-[44px]"
                  >
                    Rejoindre la liste d&apos;attente
                    <ArrowUpRight className="w-4 h-4" strokeWidth={2.4} />
                  </a>
                </div>

                <div className="relative mt-6 pt-6 border-t border-niqo-gray-200">
                  <span className="text-sm text-niqo-gray-500">
                    Phase 2 · Dakar &amp; Douala à suivre
                  </span>
                </div>
              </div>
            </FadeUp>
          </div>
        </div>
      </section>

      {/* ── COMMENT ÇA MARCHE — 3 steps éditoriaux ──────────────────────── */}
      <section className="py-14 sm:py-20 lg:py-28 bg-niqo-black text-white relative overflow-hidden">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] opacity-25 blur-[140px]"
          style={{
            background:
              "radial-gradient(ellipse, #D85A30 0%, transparent 70%)",
          }}
          aria-hidden
        />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16 sm:mb-20">
            <FadeUp>
              <p className="text-sm font-mono uppercase tracking-widest text-niqo-coral mb-3">
                Trois étapes
              </p>
              <h2
                className="font-display font-bold"
                style={{
                  fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
                  lineHeight: "0.98",
                  letterSpacing: "-0.035em",
                }}
              >
                Trouve. Contacte.
                <br />
                <span className="text-niqo-coral">Rencontre.</span>
              </h2>
            </FadeUp>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6">
            {[
              {
                step: "01",
                title: "Trouve",
                description:
                  "Parcours les annonces près de chez toi. Filtre par ville, catégorie, prix, état.",
              },
              {
                step: "02",
                title: "Contacte",
                description:
                  "Envoie un message au vendeur dans l'app. Négocie et propose un RDV en sécurité.",
              },
              {
                step: "03",
                title: "Rencontre",
                description:
                  "Vérifie le produit en personne. Paie cash ou Mobile Money. Note ton expérience.",
              },
            ].map((item, i) => (
              <FadeUp key={item.step} delay={0.1 * i}>
                <div className="relative">
                  <div
                    className="font-mono font-bold text-niqo-coral/15 mb-4"
                    style={{
                      fontSize: "clamp(5rem, 12vw, 9rem)",
                      lineHeight: "0.85",
                      letterSpacing: "-0.04em",
                    }}
                  >
                    {item.step}
                  </div>
                  <h3 className="font-display text-2xl font-bold text-white mb-3 -mt-4">
                    {item.title}
                    <span className="text-niqo-coral">.</span>
                  </h3>
                  <p className="text-base text-white/65 leading-relaxed max-w-xs">
                    {item.description}
                  </p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── DÉCOUVRE L'APP — 3 mockups side-by-side ─────────────────────── */}
      <section
        id="decouvrir"
        className="py-14 sm:py-20 lg:py-28 bg-niqo-gray-50 overflow-hidden scroll-mt-24"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-14 sm:mb-20 max-w-3xl">
            <FadeUp>
              <p className="text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-3">
                L&apos;app en détail
              </p>
              <h2
                className="font-display font-bold text-niqo-black"
                style={{
                  fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
                  lineHeight: "0.98",
                  letterSpacing: "-0.035em",
                }}
              >
                Tout ce qu&apos;il te faut.
                <br />
                <span className="text-niqo-coral">Rien de plus</span>.
              </h2>
            </FadeUp>
          </div>

          {/* Mobile : carousel snap horizontal · Desktop : grid 3-col */}
          <div
            role="region"
            aria-label="Aperçu de l'application Niqo en 3 écrans"
            className="scrollbar-hide flex snap-x snap-mandatory overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 gap-6 pb-6 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:mx-0 lg:px-0 lg:items-end lg:pb-0"
          >
            {/* Mockup 1 — Home */}
            <div
              role="group"
              aria-roledescription="diapositive"
              aria-label="1 sur 3 — Écran d'accueil"
              className="snap-center shrink-0 w-[88vw] max-w-[360px] lg:w-auto lg:max-w-none flex flex-col items-center text-center"
            >
              <PhoneMockup screen="home" delay={0} />
              <div className="mt-6 lg:mt-8 max-w-xs">
                <p className="text-xs sm:text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-2">
                  01 · Trouve
                </p>
                <h3 className="font-display text-lg sm:text-xl lg:text-2xl font-bold text-niqo-black mb-2 leading-tight">
                  Toutes les annonces près de toi.
                </h3>
                <p className="text-sm text-niqo-gray-800 leading-relaxed">
                  Filtre par ville, catégorie, prix. Vrais utilisateurs, vraies
                  photos.
                </p>
              </div>
            </div>

            {/* Mockup 2 — Chat */}
            <div
              role="group"
              aria-roledescription="diapositive"
              aria-label="2 sur 3 — Chat sécurisé avec confirmation de RDV"
              className="snap-center shrink-0 w-[88vw] max-w-[360px] lg:w-auto lg:max-w-none flex flex-col items-center text-center lg:-translate-y-6"
            >
              <PhoneMockup screen="chat" delay={0.1} />
              <div className="mt-6 lg:mt-8 max-w-xs">
                <p className="text-xs sm:text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-2">
                  02 · Discute
                </p>
                <h3 className="font-display text-lg sm:text-xl lg:text-2xl font-bold text-niqo-black mb-2 leading-tight">
                  Chat sécurisé. RDV organisé dans l&apos;app.
                </h3>
                <p className="text-sm text-niqo-gray-800 leading-relaxed">
                  Négocie, propose un lieu, confirme. Le bandeau{" "}
                  <span className="font-semibold text-niqo-success">
                    RDV confirmé
                  </span>{" "}
                  reste visible jusqu&apos;à la rencontre.
                </p>
              </div>
            </div>

            {/* Mockup 3 — Profile */}
            <div
              role="group"
              aria-roledescription="diapositive"
              aria-label="3 sur 3 — Profil vendeur vérifié"
              className="snap-center shrink-0 w-[88vw] max-w-[360px] lg:w-auto lg:max-w-none flex flex-col items-center text-center"
            >
              <PhoneMockup screen="profile" delay={0.2} />
              <div className="mt-6 lg:mt-8 max-w-xs">
                <p className="text-xs sm:text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-2">
                  03 · Vérifié
                </p>
                <h3 className="font-display text-lg sm:text-xl lg:text-2xl font-bold text-niqo-black mb-2 leading-tight">
                  Profil de confiance, historique public.
                </h3>
                <p className="text-sm text-niqo-gray-800 leading-relaxed">
                  Anneau vert + badge pour les vendeurs fiables. Notes, ventes,
                  ancienneté — tout est visible avant le premier message.
                </p>
              </div>
            </div>
          </div>

          {/* Hint scroll mobile uniquement */}
          <p className="lg:hidden mt-2 text-center text-xs text-niqo-gray-500">
            Glisse pour voir les 3 écrans →
          </p>
        </div>
      </section>

      {/* ── TÉMOIGNAGES ─────────────────────────────────────────────────── */}
      <section className="py-14 sm:py-20 lg:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="mb-10 sm:mb-12 lg:mb-16 max-w-3xl">
            <FadeUp>
              <p className="text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-3">
                Communauté Niqo
              </p>
              <h2
                className="font-display font-bold text-niqo-black"
                style={{
                  fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
                  lineHeight: "0.98",
                  letterSpacing: "-0.035em",
                }}
              >
                Ils utilisent Niqo
                <br />
                <span className="text-niqo-coral">tous les jours</span>.
              </h2>
            </FadeUp>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <ScaleIn key={t.name} delay={i * 0.08}>
                <article className="h-full bg-niqo-gray-50 rounded-3xl p-6 lg:p-7 flex flex-col">
                  <Quote
                    className="w-8 h-8 text-niqo-coral mb-4 shrink-0"
                    aria-hidden
                  />
                  <p className="text-base text-niqo-gray-800 leading-relaxed mb-6 flex-1">
                    « {t.quote} »
                  </p>
                  <StarRow count={t.rating} />
                  <div className="mt-5 pt-5 border-t border-niqo-gray-200 flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                      style={{
                        background:
                          AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length],
                      }}
                    >
                      {t.initials}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-niqo-black">
                        {t.name}
                      </div>
                      <div className="text-xs text-niqo-gray-500">
                        {t.role}
                      </div>
                    </div>
                  </div>
                </article>
              </ScaleIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── MANIFESTO — Pourquoi Niqo existe ────────────────────────────── */}
      <section className="py-14 sm:py-20 lg:py-28 bg-niqo-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <FadeUp>
            <p className="text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-3">
              Notre engagement
            </p>
            <h2
              className="font-display font-bold text-niqo-black"
              style={{
                fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
                lineHeight: "0.98",
                letterSpacing: "-0.035em",
              }}
            >
              Pourquoi Niqo
              <br />
              <span className="text-niqo-coral">existe</span>.
            </h2>
          </FadeUp>

          <FadeUp delay={0.1}>
            <div className="mt-10 space-y-5 text-lg sm:text-xl text-niqo-gray-800 leading-relaxed max-w-2xl">
              <p>
                On a vu nos proches se faire arnaquer sur WhatsApp. Des
                vendeurs honnêtes que personne ne croit. Des acheteurs qui se
                déplacent pour rien.
              </p>
              <p>
                WhatsApp et Facebook ne sont pas conçus pour ça.{" "}
                <strong className="text-niqo-black font-semibold">
                  Niqo, oui.
                </strong>
              </p>
              <p>
                Pas de paiement entre utilisateurs. Pas de commission. Pas
                d&apos;intermédiaire. Juste les outils pour vendre et acheter
                en confiance — et la responsabilité de garder cette confiance
                intacte.
              </p>
            </div>
          </FadeUp>

          <FadeUp delay={0.2}>
            <div className="mt-12 sm:mt-14 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6 max-w-2xl">
              {COMMITMENTS.map((c) => (
                <div key={c.label} className="flex items-start gap-3.5">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-niqo-coral-light flex items-center justify-center mt-0.5">
                    <Check
                      className="w-4 h-4 text-niqo-coral"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  </div>
                  <div>
                    <div className="font-display text-base font-semibold text-niqo-black leading-snug">
                      {c.label}
                    </div>
                    <div className="text-sm text-niqo-gray-500 leading-relaxed mt-1">
                      {c.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── FAQ — gérer les objections frontalement ─────────────────────── */}
      <section
        id="faq"
        className="py-14 sm:py-20 lg:py-28 bg-niqo-gray-50 scroll-mt-24"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="mb-10 sm:mb-12 lg:mb-16 max-w-2xl">
            <FadeUp>
              <p className="text-sm font-mono uppercase tracking-widest text-niqo-coral-dark mb-3">
                Questions fréquentes
              </p>
              <h2
                className="font-display font-bold text-niqo-black"
                style={{
                  fontSize: "clamp(2.25rem, 6vw, 4.5rem)",
                  lineHeight: "0.98",
                  letterSpacing: "-0.035em",
                }}
              >
                Tout ce que tu te demandes
                <span className="text-niqo-coral">.</span>
              </h2>
            </FadeUp>
          </div>

          <div className="space-y-3">
            {FAQ_ITEMS.map((item, i) => (
              <FadeUp key={item.q} delay={i * 0.04}>
                <details className="group bg-white rounded-2xl border border-niqo-gray-200 overflow-hidden open:border-niqo-coral/40 transition-colors duration-200">
                  <summary className="cursor-pointer list-none px-5 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-4">
                    <h3 className="font-display text-base sm:text-lg font-semibold text-niqo-black">
                      {item.q}
                    </h3>
                    <span
                      aria-hidden
                      className="shrink-0 w-8 h-8 rounded-full bg-niqo-gray-50 flex items-center justify-center text-niqo-black group-open:bg-niqo-coral group-open:text-white transition-colors duration-200"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="w-4 h-4 transition-transform duration-200 group-open:rotate-45"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </summary>
                  <div className="px-5 sm:px-6 pb-5 sm:pb-6 -mt-1">
                    <p className="text-sm sm:text-base text-niqo-gray-800 leading-relaxed max-w-2xl">
                      {item.a}
                    </p>
                  </div>
                </details>
              </FadeUp>
            ))}
          </div>

          {/* Lien support en bas */}
          <FadeUp delay={0.3}>
            <div className="mt-10 text-center">
              <p className="text-sm text-niqo-gray-500">
                D&apos;autres questions ?{" "}
                <a
                  href="mailto:support@niqo.africa"
                  className="font-medium text-niqo-coral hover:text-niqo-black transition-colors duration-200 cursor-pointer"
                >
                  support@niqo.africa
                </a>
              </p>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── CTA download final — full bleed coral ───────────────────────── */}
      <section
        id="download"
        className="relative py-16 sm:py-24 lg:py-32 bg-niqo-coral overflow-hidden scroll-mt-24"
      >
        <div
          className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, #FFFFFF 0%, transparent 70%)",
          }}
          aria-hidden
        />
        <div
          className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full opacity-25 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, #1A1A1A 0%, transparent 70%)",
          }}
          aria-hidden
        />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <FadeUp>
            <h2
              className="font-display font-bold text-white"
              style={{
                fontSize: "clamp(2.5rem, 8vw, 6rem)",
                lineHeight: "0.95",
                letterSpacing: "-0.04em",
              }}
            >
              Rejoins
              <br />
              la communauté
              <span className="text-niqo-black">.</span>
            </h2>
          </FadeUp>
          <FadeUp delay={0.1}>
            <p className="mt-6 text-lg text-white/85 max-w-md mx-auto">
              Niqo est gratuit. iOS et Android. Lance ton premier RDV
              aujourd&apos;hui.
            </p>
          </FadeUp>
          <FadeUp delay={0.2}>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <PlayStoreBadge variant="white" />
              <AppStoreBadge variant="white" />
            </div>
          </FadeUp>
          <FadeUp delay={0.3}>
            <div className="mt-10 inline-flex items-center gap-2 text-sm text-niqo-black bg-white px-4 py-2 rounded-full font-medium">
              <CheckCircle className="w-4 h-4 text-niqo-success" />
              <span>Aucune commission · Aucun frais caché</span>
            </div>
          </FadeUp>

          <FadeUp delay={0.4}>
            <p className="mt-8 text-sm text-white/80">
              Pas encore prêt·e à télécharger ?{" "}
              <a
                href="mailto:hello@niqo.africa?subject=Pr%C3%A9viens-moi%20au%20lancement"
                className="font-semibold text-white hover:text-niqo-black underline underline-offset-4 decoration-2 transition-colors duration-200 inline-flex items-center gap-1 min-h-[44px] py-2"
              >
                Préviens-moi au lancement officiel
                <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2.4} />
              </a>
            </p>
          </FadeUp>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-niqo-gray-200 py-10 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
            <div className="flex items-baseline">
              <span className="font-display text-xl font-bold text-niqo-black">
                niqo
              </span>
              <span className="font-display text-xl font-bold text-niqo-coral">
                .
              </span>
            </div>
            <a
              href="mailto:support@niqo.africa"
              className="text-sm text-niqo-gray-500 hover:text-niqo-coral transition-colors duration-200 cursor-pointer inline-flex items-center gap-1 min-h-[44px] py-3"
            >
              support@niqo.africa
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
            <p className="text-xs text-niqo-gray-500">
              &copy; {new Date().getFullYear()} Niqo LTD · Tous droits
              réservés.
            </p>
          </div>
          <LegalLinksNav />
        </div>
      </footer>
    </main>
  );
}
