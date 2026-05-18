import { Bullet, LegalScreen, P, Section, Strong } from "@/components/ui/LegalBlocks";
import { LEGAL_VERSIONS } from "@/lib/legal";

// Charte communautaire Niqo — version 1.0 (2026-05-10).
// Source canonique : docs/legal/charte-communautaire.md.
//
// Précise les règles de comportement et la liste détaillée des biens
// interdits par pays (CI vs CG). Complète les CGU §4.

export default function CharteCommunautaireScreen() {
  return (
    <LegalScreen
      title="Charte communautaire"
      version={LEGAL_VERSIONS.charteCommunautaire.version}
      date={LEGAL_VERSIONS.charteCommunautaire.date}
    >
      <Section title="Préambule">
        <P>
          Cette charte précise les règles de comportement et la liste
          détaillée des biens interdits sur Niqo. Elle complète les
          Conditions Générales d&apos;Utilisation. <Strong>Le non-respect
          de cette charte peut entraîner le retrait d&apos;annonce,
          l&apos;avertissement, la suspension temporaire ou définitive du
          compte</Strong>, sans remboursement des services payés.
        </P>
      </Section>

      <Section title="1. Esprit Niqo">
        <P>
          Niqo connecte des particuliers ivoiriens et congolais pour
          vendre et acheter en confiance entre voisins, dans une logique
          d&apos;<Strong>économie de proximité</Strong> et de{" "}
          <Strong>réutilisation</Strong>.
        </P>
        <P>Trois principes :</P>
        <Bullet>
          <Strong>Respect</Strong> : on parle aux autres comme on aimerait
          qu&apos;on nous parle.
        </Bullet>
        <Bullet>
          <Strong>Honnêteté</Strong> : on décrit ce qu&apos;on vend, on
          tient ses engagements de RDV, on ne triche pas avec la note ou
          les signalements.
        </Bullet>
        <Bullet>
          <Strong>Légalité</Strong> : on vend uniquement ce qu&apos;on a
          le droit de vendre dans son pays.
        </Bullet>
      </Section>

      <Section title="2. Ce qui est attendu">
        <Bullet>
          <Strong>Description précise</Strong> : photos réelles, état
          honnêtement décrit, prix cohérent avec le marché.
        </Bullet>
        <Bullet>
          <Strong>Réactivité</Strong> : répondre dans un délai
          raisonnable, désactiver l&apos;annonce si l&apos;objet est
          vendu ailleurs.
        </Bullet>
        <Bullet>
          <Strong>Ponctualité</Strong> : être à l&apos;heure aux RDV,
          prévenir si imprévu.
        </Bullet>
        <Bullet>
          <Strong>Bienveillance</Strong> : langage poli, refus sans
          agressivité.
        </Bullet>
        <Bullet>
          <Strong>Vérité dans les notes</Strong> : noter selon
          l&apos;expérience réelle, pas en représailles.
        </Bullet>
      </Section>

      <Section title="3. Ce qui est interdit (comportements)">
        <Bullet>
          <Strong>Harcèlement, menaces, insultes, racisme, sexisme,
          homophobie, discrimination</Strong>
        </Bullet>
        <Bullet>
          <Strong>Faux signalements</Strong> répétés contre un même
          utilisateur sans motif sérieux
        </Bullet>
        <Bullet>
          <Strong>Spam et prospection commerciale</Strong> non sollicitée
          (envoi en masse, MLM, recrutement pyramidal)
        </Bullet>
        <Bullet>
          <Strong>Contournement de la modération</Strong> : multi-comptes
          pour échapper à une suspension
        </Bullet>
        <Bullet>
          <Strong>Phishing</Strong> : se faire passer pour Niqo,
          demander identifiants ou codes Mobile Money
        </Bullet>
        <Bullet>
          <Strong>Usurpation d&apos;identité</Strong>
        </Bullet>
        <Bullet>
          <Strong>Demandes de paiement anticipé à distance</Strong>{" "}
          (Western Union, virement instantané sans rencontre) : c&apos;est
          l&apos;arnaque la plus fréquente. Niqo recommande{" "}
          <Strong>toujours</Strong> la rencontre physique.
        </Bullet>
        <Bullet>
          <Strong>Détournement</Strong> : scraper, automatiser,
          compromettre la sécurité technique
        </Bullet>
        <Bullet>
          <Strong>Diffusion de photos de tiers sans consentement</Strong>{" "}
          (droit à l&apos;image, notamment d&apos;enfants)
        </Bullet>
      </Section>

      <Section title="4. Biens interdits — par pays">
        <P>
          ⚠ La liste suivante n&apos;est pas exhaustive. Si un doute
          existe sur la légalité d&apos;un bien, contacter{" "}
          <Strong>legal@niqo.africa</Strong> avant de publier.
        </P>

        <P>
          <Strong>4.1 Interdictions communes (CI + CG)</Strong>
        </P>
        <Bullet>
          <Strong>Sécurité et armes</Strong> : armes à feu (guerre, chasse,
          poing), munitions, explosifs, armes blanches non standard,
          armes neutralisées sans preuve, tasers, gilets pare-balles,
          drones modifiés
        </Bullet>
        <Bullet>
          <Strong>Drogues et substances réglementées</Strong> :
          stupéfiants, précurseurs chimiques, médicaments sur ordonnance,
          antibiotiques, contraceptifs hormonaux, tabac et alcool
          revendus par particuliers, e-cigarettes nicotinées
        </Bullet>
        <Bullet>
          <Strong>Vivant et nature</Strong> : espèces protégées CITES
          (ivoire, écailles de pangolin, peaux), animaux exotiques,
          trophées de chasse non déclarés, plantes endémiques protégées
        </Bullet>
        <Bullet>
          <Strong>Argent, identité, données</Strong> : billets et devises
          (sauf collection), CNI / passeport / permis, données
          personnelles de tiers, comptes Niqo ou réseaux sociaux,
          diplômes / faux documents
        </Bullet>
        <Bullet>
          <Strong>Contrefaçons et IP</Strong> : vêtements / sacs / montres
          / cosmétiques contrefaits, logiciels piratés, jeux / films /
          séries piratés, clés Windows / Office issues de revente non
          autorisée, décodeurs satellite piratés
        </Bullet>
        <Bullet>
          <Strong>Santé et hygiène</Strong> : sang humain, organes,
          fluides corporels, lait maternel, sous-vêtements usagés,
          aliments périssables sans date claire, cosmétiques périmés
        </Bullet>
        <Bullet>
          <Strong>Adulte et choquant</Strong> : contenus pornographiques,
          services sexuels tarifés, symboles haineux, apologie violence /
          terrorisme
        </Bullet>
        <Bullet>
          <Strong>Services illégaux</Strong> : faux témoignages, faux
          avis, travail au noir, piratage, blanchiment, transferts
          informels en violation de la réglementation
        </Bullet>

        <P>
          <Strong>4.2 Spécificités Côte d&apos;Ivoire</Strong>
        </P>
        <Bullet>
          Or natif et diamants bruts non certifiés (process Kimberley)
        </Bullet>
        <Bullet>
          Cacao en sortie de plantation hors circuit officiel CCC
        </Bullet>
        <Bullet>Pétrole, gaz, hydrocarbures sans licence</Bullet>
        <Bullet>
          Médicaments : vente strictement réservée aux pharmacies
          agréées par le Ministère de la Santé
        </Bullet>
        <Bullet>
          Armes traditionnelles de chasse encadrées : pas de publication
          sans titre de propriété et autorisation préfectorale
        </Bullet>
        <Bullet>Espèces protégées : se référer à l&apos;OIPR</Bullet>

        <P>
          <Strong>4.3 Spécificités Congo Brazzaville</Strong>
        </P>
        <Bullet>
          Bois précieux sans certificat d&apos;origine et autorisation
          d&apos;exportation (essences protégées)
        </Bullet>
        <Bullet>
          Coltan, diamant brut, or natif sans circuit officiel
        </Bullet>
        <Bullet>
          Viande de brousse / gibier non issu d&apos;une chasse encadrée
          et déclarée
        </Bullet>
        <Bullet>Pétrole, gaz, hydrocarbures sans licence</Bullet>
        <Bullet>
          Médicaments : vente strictement réservée aux pharmacies
          agréées
        </Bullet>
        <Bullet>
          Espèces protégées : pangolins, gorilles, chimpanzés, perroquets
          gris du Gabon, ivoire — interdiction absolue
        </Bullet>
      </Section>

      <Section title="5. Catégories sensibles autorisées sous conditions">
        <Bullet>
          <Strong>Véhicules</Strong> : carte grise et identité du vendeur
          doivent correspondre. Niqo peut demander un justificatif.
        </Bullet>
        <Bullet>
          <Strong>Téléphones, ordinateurs, tablettes</Strong> :
          désimlockés ou mention claire de blocage opérateur. IMEI volés
          interdits.
        </Bullet>
        <Bullet>
          <Strong>Bijoux et pièces de valeur</Strong> : preuve
          d&apos;origine sur signalement.
        </Bullet>
        <Bullet>
          <Strong>Immobilier</Strong> (mode séparé) : droits réels sur le
          bien (titre, mandat). Pas de réservation contre paiement à
          distance.
        </Bullet>
        <Bullet>
          <Strong>Animaux domestiques</Strong> : seulement chiens / chats
          courants, mention âge, vaccinations. Pas de portée non sevrée,
          pas d&apos;élevage commercial sans déclaration.
        </Bullet>
      </Section>

      <Section title="6. Procédure de signalement">
        <P>
          <Strong>6.1 Comment signaler</Strong>
        </P>
        <P>
          Chaque annonce, profil, ou message dispose d&apos;un bouton
          « Signaler » dans l&apos;application. Choisis le motif le plus
          précis et ajoute une description si nécessaire. Évite de
          signaler par simple désaccord.
        </P>
        <P>
          <Strong>6.2 Examen et délais</Strong>
        </P>
        <P>
          L&apos;équipe Niqo examine chaque signalement dans un délai
          indicatif de <Strong>48 à 72 heures</Strong> (jours ouvrés).
          Décisions possibles : traité (valide), rejeté, ou en cours.
        </P>
        <P>
          <Strong>6.3 Sanctions graduées</Strong>
        </P>
        <Bullet>
          <Strong>Niveau 1</Strong> (manquement mineur, premier incident) :
          avertissement écrit + retrait de l&apos;annonce
        </Bullet>
        <Bullet>
          <Strong>Niveau 2</Strong> (récidive ou modéré) : suspension de
          7 jours + retrait
        </Bullet>
        <Bullet>
          <Strong>Niveau 3</Strong> (grave : arnaque, violence verbale) :
          suspension de 30 jours + retrait
        </Bullet>
        <Bullet>
          <Strong>Niveau 4</Strong> (très grave ou récidive après
          suspension) : suspension définitive + ban des coordonnées
        </Bullet>
        <Bullet>
          <Strong>Auto</Strong> : 3 signalements confirmés dans 30 jours
          glissants → suspension automatique
        </Bullet>
        <P>
          <Strong>6.4 Recours et appel</Strong>
        </P>
        <P>
          Un utilisateur sanctionné dispose d&apos;un droit d&apos;appel à{" "}
          <Strong>legal@niqo.africa</Strong> dans les 15 jours suivant la
          notification (cf. CGU §9.3). La décision d&apos;appel est rendue
          dans les 15 jours. La levée de suspension peut nécessiter le
          paiement du service de levée (1 000 FCFA, cf. CGV §3.4).
        </P>
      </Section>

      <Section title="7. Sécurité physique et conseils">
        <Bullet>
          <Strong>Rencontre en lieu public</Strong> : marché, station-
          service, café fréquenté, en journée
        </Bullet>
        <Bullet>
          <Strong>Accompagnement</Strong> pour les transactions de valeur
        </Bullet>
        <Bullet>
          <Strong>Inspection avant paiement</Strong> : vérifie l&apos;objet,
          son fonctionnement, les accessoires
        </Bullet>
        <Bullet>
          <Strong>Refus des arnaques classiques</Strong> : pas de paiement
          anticipé à distance, pas d&apos;envoi de papiers
          d&apos;identité, pas de partage de codes PIN ou OTP
        </Bullet>
        <Bullet>
          <Strong>Doute</Strong> : fais confiance à ton instinct, signale
          et écarte-toi
        </Bullet>
        <P>
          Niqo n&apos;est pas responsable des incidents survenant lors
          des rencontres physiques (cf. CGU §11). En cas d&apos;agression,
          contacte la police immédiatement.
        </P>
      </Section>

      <Section title="8. Confidentialité des échanges">
        <P>
          Les messages échangés sur Niqo sont privés entre l&apos;acheteur
          et le vendeur, et accessibles à l&apos;équipe Niqo uniquement
          en cas de signalement ou d&apos;enquête de sécurité (cf.
          Politique de confidentialité). Ne diffuse pas le contenu de tes
          échanges sans le consentement de ton interlocuteur, sauf
          preuve à fournir aux autorités.
        </P>
      </Section>

      <Section title="9. Modification de la charte">
        <P>
          Cette charte peut évoluer. Toute modification matérielle est
          notifiée dans l&apos;application 15 jours avant son entrée en
          vigueur. Le journal des changements est consultable dans le
          CHANGELOG légal.
        </P>
      </Section>

      <Section title="10. Contact">
        <Bullet>
          Signalements de contenu illicite par des tiers :{" "}
          <Strong>legal@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Doutes sur la légalité d&apos;un bien avant publication :{" "}
          <Strong>legal@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Support général : <Strong>support@niqo.africa</Strong>
        </Bullet>
      </Section>
    </LegalScreen>
  );
}
