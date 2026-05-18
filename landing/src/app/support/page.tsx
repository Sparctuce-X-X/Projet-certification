import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail, MessageSquare, Shield, AlertTriangle } from "lucide-react";
import { LegalFooter } from "@/components/legal/LegalFooter";

export const metadata: Metadata = {
  title: "Support — Niqo",
  description:
    "Centre d'aide Niqo. Contact support, signalement d'abus, questions sur la vérification d'identité, paiements Mobile Money.",
  alternates: { canonical: "/support" },
};

const CONTACT_CHANNELS: Array<{
  email: string;
  label: string;
  description: string;
  icon: typeof Mail;
}> = [
  {
    email: "support@niqo.africa",
    label: "Support général",
    description:
      "Questions sur l'app, problème de connexion, annonces qui n'apparaissent pas, boosts qui ne se sont pas activés.",
    icon: MessageSquare,
  },
  {
    email: "billing@niqo.africa",
    label: "Facturation & remboursements",
    description:
      "Paiement Mobile Money débité sans contrepartie, contestation d'un boost ou d'une vérification.",
    icon: Mail,
  },
  {
    email: "legal@niqo.africa",
    label: "Signalement de contenu illicite",
    description:
      "Annonce frauduleuse, contrefaçon, atteinte à la vie privée, contenu illégal. Procédure notice-and-takedown.",
    icon: AlertTriangle,
  },
  {
    email: "dpo@niqo.africa",
    label: "Données personnelles (DPO)",
    description:
      "Demande d'accès, de rectification, de suppression de vos données. Droit à l'oubli.",
    icon: Shield,
  },
  {
    email: "security@niqo.africa",
    label: "Vulnérabilités & sécurité",
    description:
      "Signaler une faille de sécurité. Responsible disclosure encouragé.",
    icon: Shield,
  },
];

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "Comment Niqo garantit-il la sécurité des transactions ?",
    a: "Niqo n'intervient pas dans le paiement entre acheteur et vendeur. Le paiement se fait en direct (cash ou Mobile Money) au moment du rendez-vous physique. La sécurité repose sur 4 piliers : vérification d'identité (CNI + selfie), notation après rencontre, modération communautaire, et suspension automatique en cas d'abus.",
  },
  {
    q: "Mon paiement Mobile Money a été débité mais mon boost n'est pas actif.",
    a: "Les paiements sont confirmés par webhook PawaPay sous 60 secondes en général. Si après 5 minutes ton boost n'est pas actif, contacte billing@niqo.africa avec ton numéro de téléphone et l'heure approximative du paiement.",
  },
  {
    q: "Comment supprimer mon compte Niqo ?",
    a: "Depuis l'app : Profil → Paramètres → Supprimer mon compte. Toutes tes données (annonces, photos, messages) sont purgées immédiatement. Action irréversible.",
  },
  {
    q: "Pourquoi ma vérification d'identité a-t-elle été refusée ?",
    a: "Les motifs les plus fréquents : photo floue, CNI partiellement masquée, selfie ne correspondant pas au document. Le paiement de 1 000 FCFA n'est pas remboursable mais tu peux soumettre à nouveau (frais à payer de nouveau).",
  },
  {
    q: "Je suis victime d'une arnaque, que faire ?",
    a: "1. Signale l'utilisateur via le bouton ⓘ sur son profil ou son annonce. Au-delà de 3 signalements confirmés en 30 jours, le compte est automatiquement suspendu. 2. Si tu as perdu de l'argent, contacte ton opérateur Mobile Money pour tenter une réversion. 3. Pour les cas graves, contacte directement les autorités locales (police).",
  },
  {
    q: "Dans quels pays Niqo est-il disponible ?",
    a: "Lancement initial en Côte d'Ivoire (Abidjan) et au Congo Brazzaville (Brazzaville). Expansion prévue en 2026-2027 : Sénégal, Cameroun, Mali, Togo, Bénin.",
  },
];

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-niqo-white text-niqo-black flex flex-col">
      <header className="border-b border-niqo-gray-200 sticky top-0 bg-niqo-white/95 backdrop-blur z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2 active:opacity-60 hover:opacity-80 rounded-md"
            aria-label="Retour à l'accueil Niqo"
          >
            <ArrowLeft size={22} />
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold truncate">
            Support
          </h1>
        </div>
      </header>

      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold leading-tight mb-3">
            Besoin d&apos;aide<span className="text-niqo-coral">.</span>
          </h2>
          <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-2">
            On répond sous <strong className="font-semibold text-niqo-black">24h ouvrées</strong> (lundi-vendredi, fuseau Afrique de l&apos;Ouest GMT+0).
          </p>
          <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-8">
            Avant d&apos;écrire, regarde la FAQ ci-dessous — la réponse y est peut-être déjà.
          </p>

          <section aria-labelledby="contacts-heading" className="mb-12">
            <h3
              id="contacts-heading"
              className="font-[family-name:var(--font-display)] text-xl font-bold mt-8 mb-4 text-niqo-black"
            >
              Nous contacter
            </h3>
            <ul className="space-y-3">
              {CONTACT_CHANNELS.map(({ email, label, description, icon: Icon }) => (
                <li
                  key={email}
                  className="border border-niqo-gray-200 rounded-lg p-4 hover:border-niqo-coral transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-9 h-9 rounded-md bg-niqo-coral/10 flex items-center justify-center">
                      <Icon size={18} className="text-niqo-coral" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-[family-name:var(--font-display)] font-semibold text-niqo-black text-base">
                        {label}
                      </div>
                      <a
                        href={`mailto:${email}`}
                        className="font-[family-name:var(--font-mono)] text-sm text-niqo-coral hover:underline break-all"
                      >
                        {email}
                      </a>
                      <p className="text-[14px] leading-relaxed text-niqo-gray-800 mt-1.5">
                        {description}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="faq-heading">
            <h3
              id="faq-heading"
              className="font-[family-name:var(--font-display)] text-xl font-bold mt-8 mb-4 text-niqo-black"
            >
              Questions fréquentes
            </h3>
            <dl className="space-y-5">
              {FAQ_ITEMS.map(({ q, a }) => (
                <div key={q} className="border-l-2 border-niqo-gray-200 pl-4">
                  <dt className="font-[family-name:var(--font-body)] font-semibold text-niqo-black text-[15px] mb-1.5">
                    {q}
                  </dt>
                  <dd className="text-[15px] leading-relaxed text-niqo-gray-800">
                    {a}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="mt-12 p-5 rounded-lg bg-niqo-coral/5 border border-niqo-coral/20">
            <p className="text-[14px] leading-relaxed text-niqo-gray-800">
              <strong className="font-semibold text-niqo-black">Niqo LTD</strong> — Société immatriculée au Rwanda Development Board sous le numéro <span className="font-[family-name:var(--font-mono)] text-niqo-black">150644832</span>. Voir les{" "}
              <Link href="/legal/mentions-legales" className="text-niqo-coral underline hover:no-underline">
                mentions légales
              </Link>{" "}
              pour les coordonnées complètes de l&apos;éditeur.
            </p>
          </div>
        </article>
      </main>

      <LegalFooter />
    </div>
  );
}
