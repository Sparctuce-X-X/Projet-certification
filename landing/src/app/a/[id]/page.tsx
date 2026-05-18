import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  BadgeCheck,
  MapPin,
  Smartphone,
  Star,
} from "lucide-react";

import { LegalLinksNav } from "@/components/legal/LegalFooter";
import { createClient } from "@/lib/supabase/server";

const PHOTOS_BUCKET = "annonces-photos";
const SITE_URL = "https://niqo.africa";

function priceCurrencyForPays(pays: string): string {
  // CI = UEMOA → XOF · CG = CEMAC → XAF · fallback XOF (zone principale du MVP)
  const code = pays?.toUpperCase();
  if (code === "CG" || code === "CM" || code === "GA" || code === "TD") return "XAF";
  return "XOF";
}

interface AnnoncePublic {
  id: string;
  titre: string;
  description: string;
  prix: number;
  ville: string;
  pays: string;
  etat: string | null;
  statut: string;
  photos: string[];
  vendeur_id: string;
  type_offre: string | null;
  is_boosted: boolean;
}

interface SellerPublic {
  prenom: string | null;
  is_verified: boolean;
  note_vendeur: number;
  nb_ventes: number;
}

function formatPrice(value: number): string {
  return value.toLocaleString("fr-FR").replace(/ /g, " ");
}

function publicPhotoUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${baseUrl}/storage/v1/object/public/${PHOTOS_BUCKET}/${path}`;
}

async function fetchAnnoncePublic(id: string): Promise<AnnoncePublic | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("annonces")
    .select(
      "id, titre, description, prix, ville, pays, etat, statut, photos, vendeur_id, type_offre, is_boosted"
    )
    .eq("id", id)
    .eq("statut", "active") // RLS impose déjà ça pour anon, on est explicite
    .maybeSingle();

  if (error || !data) return null;
  return data as AnnoncePublic;
}

async function fetchSellerPublic(userId: string): Promise<SellerPublic | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_user_public_profile", {
    p_user_id: userId,
  });
  if (error || !data) return null;
  const raw = data as Record<string, unknown>;
  return {
    prenom: (raw.prenom as string) ?? null,
    is_verified: Boolean(raw.is_verified),
    note_vendeur: Number(raw.note_vendeur ?? 0),
    nb_ventes: Number(raw.nb_ventes ?? 0),
  };
}

// ── OG meta : preview riche dans WhatsApp/iMessage/Telegram ──────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const annonce = await fetchAnnoncePublic(id);
  if (!annonce) {
    return {
      title: "Annonce indisponible · Niqo",
      robots: { index: false, follow: false },
    };
  }

  const title = `${annonce.titre} — ${formatPrice(annonce.prix)} FCFA · Niqo`;
  const description = `${annonce.ville} · ${annonce.description.slice(0, 140)}${annonce.description.length > 140 ? "…" : ""}`;
  const ogImage = annonce.photos[0] ? publicPhotoUrl(annonce.photos[0]) : undefined;

  return {
    title,
    description,
    alternates: {
      canonical: `/a/${id}`,
    },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Niqo",
      url: `${SITE_URL}/a/${id}`,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function AnnoncePublicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const annonce = await fetchAnnoncePublic(id);
  if (!annonce) notFound();

  const seller = await fetchSellerPublic(annonce.vendeur_id);
  const deepLink = `niqo://announce/${annonce.id}`;
  const isImmo = annonce.type_offre != null;
  const priceSuffix = annonce.type_offre === "location" ? " / mois" : "";

  const canonicalUrl = `${SITE_URL}/a/${annonce.id}`;
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: annonce.titre,
    description: annonce.description || annonce.titre,
    sku: annonce.id,
    image: annonce.photos.map((p) => publicPhotoUrl(p)),
    ...(annonce.etat
      ? {
          itemCondition:
            annonce.etat === "neuf"
              ? "https://schema.org/NewCondition"
              : "https://schema.org/UsedCondition",
        }
      : {}),
    offers: {
      "@type": "Offer",
      url: canonicalUrl,
      price: annonce.prix,
      priceCurrency: priceCurrencyForPays(annonce.pays),
      availability: "https://schema.org/InStock",
      itemCondition: annonce.etat === "neuf"
        ? "https://schema.org/NewCondition"
        : "https://schema.org/UsedCondition",
      areaServed: {
        "@type": "City",
        name: annonce.ville,
      },
      ...(seller?.prenom
        ? {
            seller: {
              "@type": "Person",
              name: seller.prenom,
            },
          }
        : {}),
    },
    ...(seller && seller.nb_ventes > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: seller.note_vendeur,
            reviewCount: seller.nb_ventes,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  return (
    <div className="min-h-screen bg-niqo-gray-50">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
      {/* Header sticky avec brand + CTA inline */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-niqo-gray-200">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-baseline" aria-label="Niqo">
            <span className="font-display text-xl font-bold text-niqo-black">
              niqo
            </span>
            <span className="font-display text-xl font-bold text-niqo-coral">
              .
            </span>
          </Link>
          <a
            href={deepLink}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-niqo-coral text-white text-sm font-medium hover:bg-niqo-coral/90 transition-colors"
          >
            Ouvrir dans l&apos;app
            <ArrowUpRight className="w-4 h-4" strokeWidth={2.4} />
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Galerie photos — stack vertical (MVP, pas de carousel JS) */}
        {annonce.photos.length > 0 && (
          <div className="space-y-2">
            <div className="relative aspect-square w-full bg-niqo-gray-100 rounded-2xl overflow-hidden">
              <Image
                src={publicPhotoUrl(annonce.photos[0])}
                alt={annonce.titre}
                fill
                sizes="(max-width: 768px) 100vw, 672px"
                priority
                className="object-cover"
              />
              {annonce.is_boosted && (
                <div className="absolute top-3 left-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-niqo-coral text-white text-xs font-semibold">
                  Sponsorisé
                </div>
              )}
            </div>
            {annonce.photos.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {annonce.photos.slice(1, 5).map((path) => (
                  <div
                    key={path}
                    className="relative aspect-square bg-niqo-gray-100 rounded-lg overflow-hidden"
                  >
                    <Image
                      src={publicPhotoUrl(path)}
                      alt={annonce.titre}
                      fill
                      sizes="(max-width: 768px) 25vw, 168px"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Titre + prix */}
        <div className="space-y-2">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-niqo-black leading-tight">
            {annonce.titre}
          </h1>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl sm:text-4xl font-bold text-niqo-coral">
              {formatPrice(annonce.prix)}
            </span>
            <span className="font-mono text-lg text-niqo-gray-800">
              FCFA{priceSuffix}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-niqo-gray-500">
            <MapPin className="w-4 h-4" strokeWidth={2.2} />
            <span>{annonce.ville}</span>
            {annonce.etat && !isImmo && (
              <>
                <span className="text-niqo-gray-200 mx-1">·</span>
                <span className="capitalize">État {annonce.etat.replace("_", " ")}</span>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {annonce.description && (
          <div className="bg-white border border-niqo-gray-200 rounded-2xl p-5">
            <p className="text-niqo-gray-800 text-base leading-relaxed whitespace-pre-line">
              {annonce.description}
            </p>
          </div>
        )}

        {/* Vendeur */}
        {seller && (
          <div className="bg-white border border-niqo-gray-200 rounded-2xl p-5">
            <p className="text-xs font-mono uppercase tracking-wider text-niqo-gray-500 mb-3">
              Vendeur
            </p>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-niqo-coral/10 flex items-center justify-center text-niqo-coral font-display font-bold text-lg">
                {seller.prenom?.charAt(0).toUpperCase() ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-display font-semibold text-niqo-black truncate">
                    {seller.prenom ?? "Vendeur Niqo"}
                  </p>
                  {seller.is_verified && (
                    <BadgeCheck
                      className="w-4 h-4 text-niqo-success shrink-0"
                      strokeWidth={2.4}
                      aria-label="Vendeur vérifié"
                    />
                  )}
                </div>
                {seller.nb_ventes > 0 && (
                  <p className="text-xs text-niqo-gray-500 flex items-center gap-1 mt-0.5">
                    <Star
                      className="w-3 h-3 fill-niqo-warning text-niqo-warning"
                      strokeWidth={2}
                    />
                    {seller.note_vendeur.toFixed(1)} · {seller.nb_ventes} vente
                    {seller.nb_ventes > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CTA principal — Ouvrir dans l'app */}
        <a
          href={deepLink}
          className="block w-full h-14 rounded-xl bg-niqo-coral text-white font-semibold text-base hover:bg-niqo-coral/90 transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          <Smartphone className="w-5 h-5" strokeWidth={2.4} />
          Contacter le vendeur dans l&apos;app
        </a>

        {/* Fallback — Télécharger */}
        <div className="bg-white border border-niqo-gray-200 rounded-2xl p-5 text-center space-y-3">
          <p className="text-sm text-niqo-gray-800">
            Tu n&apos;as pas encore l&apos;app Niqo&nbsp;?
          </p>
          <p className="text-xs text-niqo-gray-500">
            Télécharge-la pour contacter le vendeur, négocier, et acheter en toute confiance.
          </p>
          {/* Placeholder badges — à remplacer par les vrais liens stores post-publish */}
          <div className="flex justify-center gap-3 pt-1">
            <a
              href="https://apps.apple.com/app/niqo-annonces-afrique/id6769410032"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-11 px-4 rounded-lg bg-niqo-black text-white text-sm font-medium hover:bg-niqo-gray-800 transition-colors cursor-pointer"
              aria-label="Télécharger Niqo sur l'App Store"
            >
              App Store
            </a>
            <a
              href="#" // TODO: lien Google Play post-publish
              className="inline-flex items-center justify-center h-11 px-4 rounded-lg bg-niqo-black text-white text-sm font-medium hover:bg-niqo-gray-800 transition-colors cursor-pointer"
              aria-label="Télécharger sur Google Play"
            >
              Google Play
            </a>
          </div>
        </div>
      </main>

      <footer className="max-w-2xl mx-auto px-4 py-8 text-center text-xs text-niqo-gray-500 space-y-4">
        <p>
          Niqo · La marketplace de confiance en Afrique francophone ·{" "}
          <Link href="/" className="text-niqo-coral hover:underline">
            niqo.africa
          </Link>
        </p>
        <LegalLinksNav />
      </footer>
    </div>
  );
}
