import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Smartphone, Mail, Trash2, Clock } from "lucide-react";
import { LegalFooter } from "@/components/legal/LegalFooter";

export const metadata: Metadata = {
  title: "Supprimer mon compte Niqo — Niqo",
  description:
    "Procédure pour supprimer ton compte Niqo et tes données personnelles. Suppression immédiate depuis l'app, ou par email à dpo@niqo.africa.",
  alternates: { canonical: "/suppression-compte" },
};

const DATA_DELETED: Array<{ label: string; detail: string }> = [
  {
    label: "Profil",
    detail: "Prénom, photo de profil, ville, pays, date d'inscription.",
  },
  {
    label: "Numéro de téléphone",
    detail: "Chiffré via Supabase Vault, supprimé immédiatement.",
  },
  {
    label: "Email et authentification",
    detail: "Compte Google/Apple/Email, mots de passe, sessions.",
  },
  {
    label: "Annonces publiées",
    detail: "Toutes les annonces (actives, vendues, expirées) et leurs photos.",
  },
  {
    label: "Messages",
    detail: "Conversations et messages envoyés ou reçus.",
  },
  {
    label: "Favoris et historique de recherche",
    detail: "Liste de favoris et requêtes récentes.",
  },
  {
    label: "Documents de vérification d'identité",
    detail: "CNI recto/verso et selfie supprimés du stockage chiffré.",
  },
  {
    label: "Notifications et tokens push",
    detail: "Tokens Expo Push révoqués.",
  },
];

const DATA_RETAINED: Array<{ label: string; detail: string; duration: string }> = [
  {
    label: "Données comptables",
    detail:
      "Transactions PawaPay (boost, KYC, levée de suspension), factures électroniques, identifiants de paiement.",
    duration: "10 ans — obligation fiscale rwandaise",
  },
  {
    label: "Avis donnés et reçus",
    detail:
      "Anonymisés (le nom est remplacé par « Utilisateur supprimé »), conservés pour préserver l'historique communautaire des autres utilisateurs.",
    duration: "Indéfinie",
  },
  {
    label: "Signalements traités",
    detail:
      "Signalements émis et reçus avec leur décision, anonymisés. Permet de maintenir le système de modération communautaire.",
    duration: "Indéfinie",
  },
  {
    label: "Logs techniques de sécurité",
    detail:
      "Tentatives de connexion, erreurs serveur, audits d'accès admin. Aucune donnée personnelle identifiante.",
    duration: "12 mois",
  },
];

export default function AccountDeletionPage() {
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
            Supprimer mon compte
          </h1>
        </div>
      </header>

      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold leading-tight mb-3">
            Supprimer ton compte Niqo<span className="text-niqo-coral">.</span>
          </h2>
          <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-2">
            Tu peux supprimer ton compte Niqo et tes données personnelles à tout moment,{" "}
            <strong className="font-semibold text-niqo-black">gratuitement</strong> et sans justification.
          </p>
          <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-8">
            La suppression est <strong className="font-semibold text-niqo-black">immédiate et irréversible</strong>.
            Nous te recommandons de retirer tes annonces actives et de prévenir tes interlocuteurs en cours avant de procéder.
          </p>

          <section aria-labelledby="method-inapp-heading" className="mb-10">
            <h3
              id="method-inapp-heading"
              className="font-[family-name:var(--font-display)] text-xl font-bold mt-8 mb-4 text-niqo-black flex items-center gap-2"
            >
              <Smartphone size={20} className="text-niqo-coral" aria-hidden />
              Méthode 1 — Depuis l&apos;application (recommandé)
            </h3>
            <ol className="space-y-3 text-[15px] leading-relaxed text-niqo-gray-800 list-decimal pl-5">
              <li>Ouvre l&apos;application Niqo sur ton téléphone</li>
              <li>
                Va dans l&apos;onglet <strong className="font-semibold text-niqo-black">Profil</strong> (icône en bas à droite)
              </li>
              <li>Scroll tout en bas de l&apos;écran Profil</li>
              <li>
                Appuie sur le lien <strong className="font-semibold text-niqo-black">Supprimer mon compte</strong> (sous le bouton « Se déconnecter »)
              </li>
              <li>Confirme ta décision dans la fenêtre qui s&apos;ouvre</li>
              <li>
                Tes données sont purgées dans la foulée et tu es déconnecté
              </li>
            </ol>
          </section>

          <section aria-labelledby="method-email-heading" className="mb-10">
            <h3
              id="method-email-heading"
              className="font-[family-name:var(--font-display)] text-xl font-bold mt-8 mb-4 text-niqo-black flex items-center gap-2"
            >
              <Mail size={20} className="text-niqo-coral" aria-hidden />
              Méthode 2 — Par email
            </h3>
            <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-3">
              Si tu ne peux plus accéder à ton compte (téléphone perdu, mot de passe oublié, etc.), envoie un email à :
            </p>
            <a
              href="mailto:dpo@niqo.africa?subject=Demande%20de%20suppression%20de%20compte"
              className="inline-block font-[family-name:var(--font-mono)] text-base text-niqo-coral hover:underline mb-3"
            >
              dpo@niqo.africa
            </a>
            <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-2">Inclus dans ton message :</p>
            <ul className="space-y-1.5 text-[15px] leading-relaxed text-niqo-gray-800 list-disc pl-5">
              <li>L&apos;adresse email associée à ton compte Niqo</li>
              <li>Ton numéro de téléphone (si tu le connais)</li>
              <li>Ton prénom tel qu&apos;il apparaît sur ton profil</li>
            </ul>
            <p className="text-[15px] leading-relaxed text-niqo-gray-800 mt-3">
              Nous traitons les demandes sous{" "}
              <strong className="font-semibold text-niqo-black">7 jours ouvrés maximum</strong> et te confirmons la suppression par email.
            </p>
          </section>

          <section aria-labelledby="data-deleted-heading" className="mb-10">
            <h3
              id="data-deleted-heading"
              className="font-[family-name:var(--font-display)] text-xl font-bold mt-8 mb-4 text-niqo-black flex items-center gap-2"
            >
              <Trash2 size={20} className="text-niqo-coral" aria-hidden />
              Données supprimées immédiatement
            </h3>
            <dl className="space-y-3">
              {DATA_DELETED.map(({ label, detail }) => (
                <div key={label} className="border-l-2 border-niqo-coral pl-4">
                  <dt className="font-[family-name:var(--font-body)] font-semibold text-niqo-black text-[15px] mb-1">
                    {label}
                  </dt>
                  <dd className="text-[14px] leading-relaxed text-niqo-gray-800">{detail}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="data-retained-heading" className="mb-10">
            <h3
              id="data-retained-heading"
              className="font-[family-name:var(--font-display)] text-xl font-bold mt-8 mb-4 text-niqo-black flex items-center gap-2"
            >
              <Clock size={20} className="text-niqo-coral" aria-hidden />
              Données conservées et durées
            </h3>
            <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-4">
              Pour des raisons légales, fiscales et de protection de la communauté, certaines données sont conservées au-delà de la suppression du compte. Elles sont anonymisées chaque fois que cela est possible.
            </p>
            <dl className="space-y-4">
              {DATA_RETAINED.map(({ label, detail, duration }) => (
                <div key={label} className="border border-niqo-gray-200 rounded-lg p-4">
                  <dt className="font-[family-name:var(--font-body)] font-semibold text-niqo-black text-[15px] mb-1">
                    {label}
                  </dt>
                  <dd className="text-[14px] leading-relaxed text-niqo-gray-800 mb-2">{detail}</dd>
                  <p className="font-[family-name:var(--font-mono)] text-[13px] text-niqo-coral">
                    Durée : {duration}
                  </p>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="rights-heading" className="mb-10">
            <h3
              id="rights-heading"
              className="font-[family-name:var(--font-display)] text-xl font-bold mt-8 mb-4 text-niqo-black"
            >
              Tes autres droits
            </h3>
            <p className="text-[15px] leading-relaxed text-niqo-gray-800 mb-3">
              En complément du droit à la suppression, tu disposes des droits suivants sur tes données personnelles :
            </p>
            <ul className="space-y-1.5 text-[15px] leading-relaxed text-niqo-gray-800 list-disc pl-5">
              <li>
                <strong className="font-semibold text-niqo-black">Droit d&apos;accès</strong> : obtenir une copie de toutes tes données
              </li>
              <li>
                <strong className="font-semibold text-niqo-black">Droit de rectification</strong> : corriger des informations inexactes
              </li>
              <li>
                <strong className="font-semibold text-niqo-black">Droit à la portabilité</strong> : recevoir tes données dans un format réutilisable
              </li>
              <li>
                <strong className="font-semibold text-niqo-black">Droit d&apos;opposition</strong> : refuser certains traitements
              </li>
            </ul>
            <p className="text-[15px] leading-relaxed text-niqo-gray-800 mt-3">
              Voir le détail dans notre{" "}
              <Link href="/legal/confidentialite" className="text-niqo-coral underline hover:no-underline">
                Politique de confidentialité
              </Link>
              .
            </p>
          </section>

          <div className="mt-12 p-5 rounded-lg bg-niqo-coral/5 border border-niqo-coral/20">
            <p className="text-[14px] leading-relaxed text-niqo-gray-800">
              <strong className="font-semibold text-niqo-black">Niqo LTD</strong> — Société immatriculée au Rwanda Development Board sous le numéro <span className="font-[family-name:var(--font-mono)] text-niqo-black">150644832</span>. Délégué à la protection des données :{" "}
              <a href="mailto:dpo@niqo.africa" className="text-niqo-coral underline hover:no-underline font-[family-name:var(--font-mono)]">
                dpo@niqo.africa
              </a>
              . Voir les{" "}
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
