import { Bullet, LegalScreen, P, Section, Strong } from "@/components/ui/LegalBlocks";
import { LEGAL_VERSIONS } from "@/lib/legal";

// Conditions Générales d'Utilisation Niqo — version 1.1 (2026-05-10).
// Source canonique : docs/legal/cgu.md.
//
// Toute modification matérielle doit :
// 1. Mettre à jour docs/legal/cgu.md (frontmatter + corps)
// 2. Mettre à jour ce composant en cohérence
// 3. Incrémenter LEGAL_VERSIONS.cgu dans lib/legal.ts
// 4. Ajouter une entrée à docs/legal/CHANGELOG.md
// 5. Notifier les utilisateurs via bandeau in-app au moins 15 jours avant
//    l'entrée en vigueur (cf. CGU §14).

export default function CGUScreen() {
  return (
    <LegalScreen
      title="Conditions d'utilisation"
      version={LEGAL_VERSIONS.cgu.version}
      date={LEGAL_VERSIONS.cgu.date}
    >
      <Section title="1. Présentation de Niqo">
        <P>
          Niqo (« nous », « la plateforme ») est une marketplace entre
          particuliers (C2C) opérée par la société{" "}
          <Strong>Niqo Ltd</Strong>, immatriculée au Rwanda (Kigali). Niqo
          propose un service de <Strong>mise en relation</Strong> entre
          acheteurs et vendeurs en Côte d&apos;Ivoire et au Congo Brazzaville
          pour la vente de biens d&apos;occasion ou neufs entre particuliers,
          ainsi qu&apos;un mode séparé pour les annonces immobilières.
        </P>
        <P>
          <Strong>Niqo n&apos;est pas partie aux transactions</Strong> entre
          utilisateurs. Le paiement, la livraison et la conformité du bien
          sont gérés directement entre l&apos;acheteur et le vendeur
          (rencontre physique, paiement en espèces ou Mobile Money). Niqo
          facilite la mise en relation, garantit la confiance par la
          vérification d&apos;identité et la modération communautaire, et
          propose des services payants pour les vendeurs (boosts, badge
          vérifié, levée de suspension) régis par des{" "}
          <Strong>Conditions Générales de Vente</Strong> distinctes.
        </P>
        <P>
          <Strong>Statut juridique</Strong> : Niqo agit en qualité
          d&apos;<Strong>hébergeur</Strong> au sens du droit applicable
          (équivalents LCEN). À ce titre, Niqo n&apos;est pas tenue à une
          obligation générale de surveillance des contenus publiés par les
          utilisateurs, mais retire promptement tout contenu manifestement
          illicite dès qu&apos;elle en a connaissance.
        </P>
        <P>
          En créant un compte ou en utilisant la plateforme, tu (« utilisateur »,
          « tu ») acceptes les présentes CGU dans leur intégralité. Si tu
          n&apos;es pas d&apos;accord, n&apos;utilise pas Niqo.
        </P>
      </Section>

      <Section title="2. Conditions d'inscription">
        <P>Pour créer un compte, tu dois :</P>
        <Bullet>Être majeur (18 ans ou plus)</Bullet>
        <Bullet>
          Résider en Côte d&apos;Ivoire ou au Congo Brazzaville
        </Bullet>
        <Bullet>
          Disposer d&apos;une adresse email valide et d&apos;un numéro Mobile
          Money personnel
        </Bullet>
        <Bullet>
          Fournir des informations exactes (prénom, nom, ville, quartier,
          téléphone) et les tenir à jour
        </Bullet>
        <Bullet>
          T&apos;engager à n&apos;ouvrir qu&apos;<Strong>un seul compte personnel</Strong>
        </Bullet>
        <P>
          L&apos;ouverture de plusieurs comptes par la même personne, ou
          l&apos;usurpation d&apos;identité d&apos;un tiers, entraîne la
          suspension immédiate sans remboursement des services payés.
        </P>
      </Section>

      <Section title="3. Compte et sécurité">
        <P>
          Tu es responsable de la confidentialité de tes identifiants (email,
          mot de passe ou compte Google/Apple lié). En cas de doute sur un
          accès non autorisé, change immédiatement ton mot de passe et
          préviens-nous à <Strong>support@niqo.africa</Strong>.
        </P>
        <P>
          Toute action effectuée depuis ton compte est réputée effectuée par
          toi. Niqo ne pourra être tenue responsable des conséquences
          d&apos;un défaut de protection de tes identifiants.
        </P>
      </Section>

      <Section title="4. Comportement attendu — Interdictions">
        <P>En utilisant Niqo, tu t&apos;engages à ne pas :</P>
        <Bullet>
          Publier d&apos;annonce frauduleuse, mensongère ou non conforme à la
          loi du pays de publication
        </Bullet>
        <Bullet>
          Vendre des biens prohibés (cf. <Strong>Charte communautaire</Strong>{" "}
          pour la liste détaillée par pays : armes, drogues, médicaments
          soumis à ordonnance, espèces protégées CITES, contrefaçons,
          contenus pour adultes, données personnelles de tiers, services
          illégaux, etc.)
        </Bullet>
        <Bullet>
          Harceler, menacer, insulter ou discriminer d&apos;autres
          utilisateurs (chat, commentaires, signalements de mauvaise foi)
        </Bullet>
        <Bullet>
          Détourner la plateforme à des fins de phishing, spam, prospection
          commerciale non sollicitée
        </Bullet>
        <Bullet>
          Tenter de contourner les mécanismes de modération, scraper
          massivement les données, ou compromettre la sécurité technique
        </Bullet>
        <Bullet>
          Usurper l&apos;identité d&apos;un tiers ou créer un compte au nom
          d&apos;une organisation sans mandat
        </Bullet>
        <Bullet>
          Diffuser des images ou vidéos sans le consentement des personnes
          représentées (droit à l&apos;image)
        </Bullet>
        <P>
          Toute violation peut entraîner la suspension immédiate du compte
          et, si la gravité le justifie, le signalement aux autorités
          compétentes (ARTCI, ANRTIC, police, justice).
        </P>
      </Section>

      <Section title="5. Annonces et publication">
        <P>En publiant une annonce, tu garantis que :</P>
        <Bullet>
          Tu es propriétaire du bien et tu as le droit de le vendre
        </Bullet>
        <Bullet>
          Le titre, la description, l&apos;état, le prix et les photos
          reflètent fidèlement la réalité
        </Bullet>
        <Bullet>
          Le bien est conforme à la loi du pays de publication (CI ou CG)
        </Bullet>
        <Bullet>
          Tu es disponible pour répondre aux acheteurs et organiser la
          rencontre physique
        </Bullet>
        <Bullet>
          Tu disposes des droits sur les photos publiées (photos prises par
          toi ou autorisées)
        </Bullet>
        <P>
          Sans <Strong>vérification d&apos;identité</Strong>, tu peux publier
          au maximum 3 annonces simultanément. Au-delà, la vérification est
          requise (cf. §8 et CGV §3).
        </P>
        <P>
          Les annonces ont une durée de vie de <Strong>60 jours</Strong> et
          peuvent être prolongées de 28 jours supplémentaires. Une annonce
          non prolongée passe automatiquement en « expirée » et n&apos;est
          plus visible aux acheteurs.
        </P>
        <P>
          Niqo se réserve le droit de <Strong>retirer ou suspendre</Strong>{" "}
          toute annonce ne respectant pas les présentes CGU ou la Charte
          communautaire, sans préavis ni remboursement des services associés
          (boosts).
        </P>
      </Section>

      <Section title="6. Mise en relation et rencontre">
        <P>
          La plateforme permet à l&apos;acheteur de contacter le vendeur via
          une messagerie interne. Lorsque les deux parties sont
          d&apos;accord, elles peuvent{" "}
          <Strong>proposer puis confirmer un rendez-vous</Strong> avec lieu
          et date. Le bien est inspecté physiquement et le paiement se fait
          en direct (espèces, Mobile Money) entre les deux parties.
        </P>
        <P>
          <Strong>Niqo n&apos;intervient pas dans le paiement.</Strong> Aucun
          mécanisme d&apos;escrow ou de séquestre n&apos;est proposé. La
          plateforme ne peut donc pas garantir l&apos;exécution du contrat
          de vente entre vous, ni rembourser un acheteur insatisfait.
        </P>
        <P>
          <Strong>Conseils de sécurité</Strong> : privilégie les rencontres
          en lieux publics, en journée, accompagné si possible. Vérifie le
          bien avant de remettre l&apos;argent. Refuse les paiements
          anticipés à distance ou les transferts vers des tiers. Niqo ne te
          contactera jamais pour te demander tes identifiants ou un
          transfert d&apos;argent.
        </P>
      </Section>

      <Section title="7. Notation post-rendez-vous">
        <P>
          Après un rendez-vous confirmé, les deux parties peuvent se noter
          mutuellement (note de 1 à 5 et commentaire optionnel). En
          l&apos;absence de note manuelle dans les 7 jours, une note neutre
          de 3/5 est attribuée automatiquement.
        </P>
        <P>
          Les notes sont publiques et visibles sur le profil. Niqo se
          réserve le droit de modérer ou supprimer un commentaire injurieux,
          diffamatoire ou hors-sujet, sur signalement.
        </P>
      </Section>

      <Section title="8. Services payants — renvoi aux CGV">
        <P>
          Les services suivants font l&apos;objet de{" "}
          <Strong>Conditions Générales de Vente</Strong> distinctes (cf.
          document CGV) :
        </P>
        <Bullet>
          <Strong>Vérification d&apos;identité (KYC)</Strong> — 1 000 FCFA,
          badge « Vendeur Vérifié »
        </Bullet>
        <Bullet>
          <Strong>Boost annonce 7 jours</Strong> — 1 000 FCFA
        </Bullet>
        <Bullet>
          <Strong>Boost annonce 30 jours</Strong> — 3 000 FCFA
        </Bullet>
        <Bullet>
          <Strong>Levée de suspension</Strong> — 1 000 FCFA (sous réserve de
          décision favorable)
        </Bullet>
        <P>
          L&apos;achat d&apos;un service payant vaut acceptation expresse
          des CGV en plus des présentes CGU.
        </P>
      </Section>

      <Section title="9. Signalements et modération">
        <P>
          <Strong>9.1 Signalement par les utilisateurs</Strong>
        </P>
        <P>
          Tu peux signaler une annonce, un profil ou un message qui te
          semble enfreindre les présentes CGU ou la Charte communautaire.
          L&apos;équipe Niqo examine chaque signalement et décide de
          l&apos;action appropriée. Délai indicatif de traitement :{" "}
          <Strong>48 à 72 heures</Strong>.
        </P>
        <P>
          <Strong>3 signalements confirmés en 30 jours</Strong> entraînent
          la suspension automatique du compte. La levée peut être demandée
          moyennant une nouvelle vérification d&apos;identité et un
          paiement de 1 000 FCFA (cf. §9.3 procédure d&apos;appel).
        </P>
        <P>
          Les signalements abusifs ou de mauvaise foi entraînent la
          suspension de l&apos;auteur du signalement.
        </P>
        <P>
          <Strong>9.2 Notification de contenu illicite par un tiers</Strong>
        </P>
        <P>
          Toute personne (titulaire de droits, autorité, particulier non
          utilisateur) peut notifier à Niqo un contenu manifestement
          illicite (contrefaçon, atteinte à la vie privée, contenu
          diffamatoire, atteinte au droit à l&apos;image, infraction) en
          écrivant à <Strong>legal@niqo.africa</Strong> en précisant :
        </P>
        <Bullet>Identité du notifiant (nom, qualité, coordonnées)</Bullet>
        <Bullet>URL ou identifiant précis du contenu litigieux</Bullet>
        <Bullet>
          Description précise des faits et fondement juridique
        </Bullet>
        <Bullet>
          Déclaration sur l&apos;honneur que les informations sont exactes
        </Bullet>
        <Bullet>
          Justificatif (preuve de droits, décision de justice, plainte)
        </Bullet>
        <P>
          Niqo s&apos;engage à examiner toute notification dans un{" "}
          <Strong>délai raisonnable</Strong> (objectif : 72 heures pour les
          contenus manifestement illicites) et à retirer ou rendre
          inaccessible le contenu en cas de violation avérée.
        </P>
        <P>
          <Strong>9.3 Procédure d&apos;appel des sanctions</Strong>
        </P>
        <P>
          Tout utilisateur sanctionné peut former un appel par email à{" "}
          <Strong>legal@niqo.africa</Strong> dans les{" "}
          <Strong>15 jours</Strong> suivant la notification, en précisant
          l&apos;identifiant de compte, la référence de la sanction et les
          motifs de contestation. Niqo répond par écrit dans un délai de{" "}
          <Strong>15 jours</Strong>. La décision peut confirmer, lever ou
          ajuster la sanction.
        </P>
      </Section>

      <Section title="10. Propriété intellectuelle">
        <P>
          Tu conserves la propriété des contenus que tu publies (photos,
          textes d&apos;annonces). En publiant, tu accordes à Niqo une
          licence <Strong>non exclusive, mondiale, gratuite et pour la
          durée légale des droits d&apos;auteur</Strong> pour héberger,
          afficher, reproduire, redimensionner et adapter techniquement
          ces contenus dans le cadre du fonctionnement de la plateforme et
          de sa promotion. La licence cesse à la suppression du contenu
          par toi ou Niqo.
        </P>
        <P>
          La marque Niqo, le logo, le nom de domaine et l&apos;identité
          visuelle sont la propriété exclusive de Niqo Ltd. Toute
          reproduction sans accord écrit est interdite.
        </P>
      </Section>

      <Section title="11. Limitation de responsabilité">
        <P>
          Niqo s&apos;engage à fournir un service raisonnablement
          disponible et sécurisé. Toutefois, en sa qualité d&apos;hébergeur,
          Niqo ne saurait être tenue responsable :
        </P>
        <Bullet>
          De la qualité, de la conformité ou de l&apos;authenticité des
          biens vendus entre utilisateurs
        </Bullet>
        <Bullet>
          Des litiges, vols, escroqueries ou agressions survenus lors des
          rencontres physiques
        </Bullet>
        <Bullet>
          Des contenus publiés par les utilisateurs, sauf défaut de retrait
          après notification valide d&apos;un contenu manifestement
          illicite
        </Bullet>
        <Bullet>
          Des dommages indirects (perte de chance, perte de bénéfice, perte
          d&apos;exploitation)
        </Bullet>
        <Bullet>
          Des interruptions de service liées à la maintenance, à des cas
          de force majeure ou à des défaillances de prestataires tiers
          (Supabase, PawaPay, opérateurs Mobile Money, hébergeurs)
        </Bullet>
        <P>
          La responsabilité totale de Niqo, si elle est engagée par
          décision judiciaire, est plafonnée à la somme des paiements
          effectués par l&apos;utilisateur sur les 12 derniers mois
          précédant le fait générateur, ou à 50 000 FCFA si
          l&apos;utilisateur n&apos;a effectué aucun paiement.
        </P>
        <P>
          Aucune disposition des présentes CGU n&apos;a pour effet
          d&apos;exclure ou de limiter la responsabilité de Niqo en cas de
          dol, de faute lourde, ou d&apos;atteinte à un droit que la loi
          rend impératif.
        </P>
      </Section>

      <Section title="12. Sécurité et incidents">
        <P>
          Niqo met en œuvre des mesures techniques et organisationnelles
          pour protéger la plateforme (cf. Politique de confidentialité §8).
          En cas d&apos;<Strong>incident de sécurité</Strong> affectant tes
          données personnelles, Niqo te notifiera dans les{" "}
          <Strong>72 heures</Strong> suivant la prise de connaissance, et
          informera les autorités compétentes (ARTCI, ANRTIC, NCSA).
        </P>
        <P>
          Pour signaler une <Strong>vulnérabilité technique</Strong> ou un
          risque de sécurité : <Strong>security@niqo.africa</Strong>. Niqo
          s&apos;engage à examiner toute notification de bonne foi sans
          poursuite à l&apos;encontre du chercheur en sécurité agissant de
          manière responsable (responsible disclosure).
        </P>
      </Section>

      <Section title="13. Suspension et résiliation">
        <P>
          Niqo peut suspendre ou supprimer ton compte sans préavis en cas
          de violation des présentes CGU, de comportement frauduleux, ou
          de décision administrative ou judiciaire l&apos;exigeant. La
          procédure d&apos;appel prévue au §9.3 reste applicable.
        </P>
        <P>
          Tu peux supprimer ton compte à tout moment depuis l&apos;écran
          Profil. Cette suppression entraîne la purge de tes données
          personnelles dans les conditions précisées dans la Politique de
          confidentialité (sauf obligations légales de conservation).
        </P>
      </Section>

      <Section title="14. Modifications des CGU">
        <P>
          Niqo se réserve le droit de modifier les présentes CGU. Toute
          modification matérielle est notifiée via une bannière dans
          l&apos;application <Strong>au moins 15 jours</Strong> avant son
          entrée en vigueur, et incrémente la version du document. La
          poursuite de l&apos;utilisation après notification vaut
          acceptation. Si tu refuses, ton seul recours est de supprimer
          ton compte avant la date d&apos;entrée en vigueur.
        </P>
        <P>
          Les versions antérieures restent consultables sur demande à{" "}
          <Strong>legal@niqo.africa</Strong>.
        </P>
      </Section>

      <Section title="15. Loi applicable et juridiction">
        <P>
          Les présentes CGU sont régies par le <Strong>droit rwandais</Strong>
          {" "}(lieu d&apos;immatriculation de la société Niqo Ltd). En cas
          de litige, une résolution amiable sera recherchée prioritairement
          par email à <Strong>legal@niqo.africa</Strong> dans un délai de{" "}
          <Strong>30 jours</Strong> avant toute action judiciaire.
        </P>
        <P>
          À défaut, le litige sera porté devant les{" "}
          <Strong>tribunaux compétents de Kigali (Rwanda)</Strong>, sous
          réserve des dispositions impératives applicables aux consommateurs
          ivoiriens et congolais qui peuvent saisir leurs juridictions
          nationales conformément à leur droit local.
        </P>
        <P>
          Les utilisateurs résidant en Côte d&apos;Ivoire peuvent saisir
          l&apos;<Strong>ARTCI</Strong>. Les utilisateurs résidant au Congo
          Brazzaville peuvent saisir l&apos;<Strong>ANRTIC</Strong>.
        </P>
      </Section>

      <Section title="16. Représentant local et délégué à la protection des données">
        <P>
          Niqo Ltd est immatriculée au Rwanda. Pour les utilisateurs
          résidant en Côte d&apos;Ivoire et au Congo Brazzaville :
        </P>
        <Bullet>
          Le <Strong>Délégué à la Protection des Données (DPO)</Strong> est
          joignable à : <Strong>dpo@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          En l&apos;absence de représentant physique sur place au lancement,
          Niqo s&apos;engage à désigner un représentant local dans chaque
          pays d&apos;implantation <Strong>au plus tard 6 mois après le
          lancement public</Strong>, conformément aux exigences ARTCI et
          ANRTIC. Cette information sera mise à jour dans les Mentions
          légales.
        </Bullet>
      </Section>

      <Section title="17. Contact">
        <P>Pour toute question :</P>
        <Bullet>
          Support général : <Strong>support@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Questions juridiques / signalements de contenu illicite :{" "}
          <Strong>legal@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Données personnelles / DPO : <Strong>dpo@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Sécurité / vulnérabilités : <Strong>security@niqo.africa</Strong>
        </Bullet>
      </Section>
    </LegalScreen>
  );
}
