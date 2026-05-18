import { Bullet, LegalScreen, P, Section, Strong } from "@/components/ui/LegalBlocks";
import { LEGAL_VERSIONS } from "@/lib/legal";

// Conditions Générales de Vente Niqo — version 1.0 (2026-05-10).
// Source canonique : docs/legal/cgv.md.
//
// Régit l'achat des services payants Niqo (KYC, boost, levée suspension).
// Contient l'exclusion expresse du droit de rétractation pour services
// numériques exécutés immédiatement (§6) — légalement requis pour la
// non-remboursabilité.

export default function CGVScreen() {
  return (
    <LegalScreen
      title="Conditions générales de vente"
      version={LEGAL_VERSIONS.cgv.version}
      date={LEGAL_VERSIONS.cgv.date}
    >
      <Section title="1. Préambule">
        <P>
          Les présentes Conditions Générales de Vente (« CGV ») régissent
          l&apos;achat des services payants proposés par{" "}
          <Strong>Niqo Ltd</Strong> (Rwanda) à ses utilisateurs particuliers
          domiciliés en Côte d&apos;Ivoire ou au Congo Brazzaville.
        </P>
        <P>
          Elles complètent et ne remplacent pas les Conditions Générales
          d&apos;Utilisation (CGU) de la plateforme. En cas de
          contradiction, les CGV prévalent pour tout ce qui concerne
          l&apos;achat d&apos;un service payant.
        </P>
        <P>
          L&apos;acceptation des CGV est matérialisée par la{" "}
          <Strong>case à cocher explicite</Strong> présentée avant tout
          paiement.
        </P>
      </Section>

      <Section title="2. Vendeur des services">
        <Bullet>Société : Niqo Ltd</Bullet>
        <Bullet>Forme : société immatriculée au Rwanda (Kigali)</Bullet>
        <Bullet>Représentant légal : Dominique Huang</Bullet>
        <Bullet>
          Email contact : <Strong>support@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Email facturation : <Strong>billing@niqo.africa</Strong>
        </Bullet>
        <P>
          L&apos;adresse postale complète et le numéro d&apos;immatriculation
          figurent dans les Mentions légales.
        </P>
      </Section>

      <Section title="3. Description des services payants">
        <P>
          <Strong>3.1 Vérification d&apos;identité (KYC) — 1 000 FCFA TTC</Strong>
        </P>
        <P>
          Validation manuelle par l&apos;équipe Niqo sous{" "}
          <Strong>24 à 48 heures</Strong>. Délivre le badge « Vendeur
          Vérifié » et déplafonne les annonces (au-delà de 3
          simultanées). En cas de refus pour pièce illisible, non-conformité
          ou soupçon de fraude, une nouvelle soumission nécessite{" "}
          <Strong>un nouveau paiement</Strong>.
        </P>
        <P>
          <Strong>3.2 Boost annonce 7 jours — 1 000 FCFA TTC</Strong>
        </P>
        <P>
          Mise en avant de l&apos;annonce sur l&apos;Accueil et la
          Recherche pendant 7 jours consécutifs + badge « Sponsorisé ».
          Cumul possible (un nouveau boost prolonge la durée).
        </P>
        <P>
          <Strong>3.3 Boost annonce 30 jours — 3 000 FCFA TTC</Strong>
        </P>
        <P>Mise en avant pendant 30 jours consécutifs. Cumul possible.</P>
        <P>
          <Strong>3.4 Levée de suspension — 1 000 FCFA TTC</Strong>
        </P>
        <P>
          Examen de la demande par l&apos;équipe Niqo. La levée n&apos;est
          pas garantie : elle dépend de la nature du motif de suspension
          et de la décision discrétionnaire de l&apos;équipe. En cas de
          refus, <Strong>le paiement n&apos;est pas remboursé</Strong> :
          il rémunère le travail d&apos;examen.
        </P>
        <P>
          <Strong>3.5 Services Phase 2</Strong>
        </P>
        <P>
          Pack Vendeur Pro (5 000 FCFA/mois) et Annonce vedette homepage
          (5 000 FCFA/semaine) seront ajoutés ultérieurement avec un
          avenant aux CGV publié 15 jours avant leur mise en production.
        </P>
      </Section>

      <Section title="4. Conditions et processus de commande">
        <P>
          <Strong>4.1 Capacité juridique</Strong>
        </P>
        <P>
          L&apos;acheteur déclare être majeur (18 ans ou plus), agir en
          qualité de consommateur, et disposer de la pleine capacité
          juridique pour contracter.
        </P>
        <P>
          <Strong>4.2 Processus de commande</Strong>
        </P>
        <Bullet>Sélection du service dans l&apos;application</Bullet>
        <Bullet>
          Affichage du <Strong>prix TTC</Strong> et de la description du
          service
        </Bullet>
        <Bullet>
          Présentation de l&apos;<Strong>écran de consentement</Strong> :
          acceptation des CGV + acceptation expresse du démarrage immédiat +
          renonciation expresse au droit de rétractation (cf. §6)
        </Bullet>
        <Bullet>
          Déclenchement du paiement Mobile Money via PawaPay
        </Bullet>
        <Bullet>
          Confirmation par notification + email de la commande
        </Bullet>
        <P>
          L&apos;acheteur reçoit un récapitulatif par email tenant lieu de
          confirmation et de <Strong>facture simplifiée</Strong>.
        </P>
        <P>
          <Strong>4.3 Disponibilité</Strong>
        </P>
        <P>
          Les services sont disponibles 24/7 sous réserve de la
          disponibilité de PawaPay et des opérateurs Mobile Money. En cas
          d&apos;indisponibilité, l&apos;achat peut échouer et
          l&apos;utilisateur est invité à réessayer ultérieurement.
        </P>
      </Section>

      <Section title="5. Prix et paiement">
        <P>
          <Strong>5.1 Prix</Strong>
        </P>
        <P>
          Tous les prix sont indiqués en <Strong>FCFA TTC</Strong>. Niqo
          se réserve le droit de modifier ses tarifs à tout moment ; les
          nouveaux tarifs s&apos;appliquent uniquement aux commandes
          postérieures, jamais rétroactivement.
        </P>
        <P>
          <Strong>5.2 Modes de paiement acceptés</Strong>
        </P>
        <P>
          Paiement exclusivement par Mobile Money via PawaPay :
        </P>
        <Bullet>
          <Strong>Côte d&apos;Ivoire</Strong> : Orange Money, MTN MoMo,
          Moov Money, Wave
        </Bullet>
        <Bullet>
          <Strong>Congo Brazzaville</Strong> : Airtel Money, MTN MoMo
        </Bullet>
        <P>
          Niqo ne stocke ni les coordonnées bancaires ni les codes PIN
          Mobile Money. Le paiement transite directement entre
          l&apos;opérateur et PawaPay.
        </P>
        <P>
          <Strong>5.3 Sécurité du paiement</Strong>
        </P>
        <P>
          Le paiement est sécurisé par PawaPay selon les standards de
          l&apos;industrie. En cas de litige sur la réalité du débit, la
          preuve de paiement (SMS opérateur, identifiant PawaPay) doit
          être adressée à <Strong>billing@niqo.africa</Strong>.
        </P>
        <P>
          <Strong>5.4 Facturation</Strong>
        </P>
        <P>
          Niqo émet une facture électronique simplifiée par email à
          chaque commande, conservée 10 ans pour conformité fiscale
          rwandaise. Une facture détaillée est disponible sur demande à{" "}
          <Strong>billing@niqo.africa</Strong>.
        </P>
      </Section>

      <Section title="6. Droit de rétractation — exclusion expresse">
        <P>
          <Strong>6.1 Principe : exclusion pour services pleinement exécutés</Strong>
        </P>
        <P>
          Conformément au régime applicable aux <Strong>services
          numériques exécutés immédiatement</Strong> :
        </P>
        <Bullet>
          L&apos;utilisateur <Strong>demande expressément</Strong> que
          l&apos;exécution du service commence dès la confirmation du
          paiement, sans attendre l&apos;expiration d&apos;un quelconque
          délai de rétractation.
        </Bullet>
        <Bullet>
          L&apos;utilisateur <Strong>renonce expressément</Strong> à son
          droit de rétractation pour ces services qui sont, de par leur
          nature, pleinement exécutés dès l&apos;activation.
        </Bullet>
        <P>
          Cette demande et cette renonciation sont matérialisées par une{" "}
          <Strong>case à cocher distincte</Strong> sur l&apos;écran de
          paiement.
        </P>
        <P>
          <Strong>6.2 Conséquence : non-remboursabilité</Strong>
        </P>
        <P>
          Les paiements ne sont pas remboursables, y compris si :
        </P>
        <Bullet>L&apos;utilisateur change d&apos;avis après le paiement</Bullet>
        <Bullet>
          L&apos;annonce boostée est marquée vendue, suspendue, retirée
          ou supprimée avant la fin du boost
        </Bullet>
        <Bullet>
          La vérification d&apos;identité est refusée pour pièce illisible,
          non-conformité ou soupçon de fraude
        </Bullet>
        <Bullet>
          La demande de levée de suspension est refusée par l&apos;équipe
        </Bullet>
        <Bullet>
          Le compte est supprimé par l&apos;utilisateur ou suspendu pour
          violation des CGU
        </Bullet>
        <P>
          <Strong>6.3 Cas de remboursement</Strong>
        </P>
        <P>Un remboursement est néanmoins accordé dans les cas suivants :</P>
        <Bullet>
          <Strong>Échec technique imputable à Niqo</Strong> : service jamais
          activé en raison d&apos;un dysfonctionnement de la plateforme
          (boost non appliqué, KYC jamais examiné dans un délai
          déraisonnable {">"} 7 jours sans justification). Délai : sous 14
          jours après constat.
        </Bullet>
        <Bullet>
          <Strong>Double facturation</Strong> : le second paiement est
          intégralement remboursé.
        </Bullet>
        <Bullet>
          <Strong>Erreur manifeste</Strong> : tout cas où la responsabilité
          de Niqo est manifestement engagée et le service non rendu.
        </Bullet>
        <P>
          Demande à formuler à <Strong>billing@niqo.africa</Strong> avec
          preuve de paiement et description précise.
        </P>
      </Section>

      <Section title="7. Garanties">
        <P>
          Niqo garantit que les services sont conformes à leur description
          au moment de l&apos;achat. La responsabilité de Niqo est limitée
          au remboursement du prix payé pour le service défaillant
          (cf. CGU §11).
        </P>
        <P>Niqo ne garantit pas que :</P>
        <Bullet>
          Le boost générera des ventes ou un volume précis de contacts
        </Bullet>
        <Bullet>
          La vérification d&apos;identité protégera contre toute fraude
        </Bullet>
        <Bullet>La levée de suspension sera accordée</Bullet>
        <P>
          Ces effets dépendent de facteurs externes (qualité de
          l&apos;annonce, marché local, comportement des autres
          utilisateurs).
        </P>
      </Section>

      <Section title="8. Responsabilité">
        <P>
          La responsabilité de Niqo au titre des présentes CGV est
          limitée au montant du service acheté. Aucune disposition
          n&apos;exclut la responsabilité de Niqo en cas de dol, de faute
          lourde, ou d&apos;atteinte à un droit que la loi rend impératif.
        </P>
        <P>Niqo n&apos;est pas responsable :</P>
        <Bullet>
          Des conséquences indirectes (perte de chance commerciale, perte
          de bénéfice)
        </Bullet>
        <Bullet>
          Des défaillances de PawaPay ou des opérateurs Mobile Money
        </Bullet>
        <Bullet>
          Des actes ou abstentions de l&apos;acheteur (annonce non
          répondue, RDV non honoré)
        </Bullet>
      </Section>

      <Section title="9. Force majeure">
        <P>
          Niqo n&apos;est pas responsable des manquements résultant
          d&apos;un cas de force majeure : panne réseau étendue,
          défaillance d&apos;un opérateur Mobile Money ou de PawaPay,
          interruption électrique, décision administrative ou judiciaire,
          conflit social, événement climatique majeur, pandémie, etc.
        </P>
      </Section>

      <Section title="10. Réclamations et litiges">
        <P>
          <Strong>10.1 Réclamation amiable</Strong>
        </P>
        <P>
          Toute réclamation doit être adressée à{" "}
          <Strong>billing@niqo.africa</Strong> en précisant identifiant de
          compte, identifiant de transaction PawaPay, description du
          litige et justificatifs. Réponse sous{" "}
          <Strong>15 jours</Strong>.
        </P>
        <P>
          <Strong>10.2 Médiation et juridiction</Strong>
        </P>
        <P>
          À défaut de résolution amiable dans les{" "}
          <Strong>30 jours</Strong>, le litige sera soumis aux juridictions
          compétentes définies au §15 des CGU. Les utilisateurs ivoiriens
          et congolais conservent la faculté de saisir leurs juridictions
          nationales en application de leur droit local de la consommation.
        </P>
      </Section>

      <Section title="11. Données personnelles">
        <P>
          Le traitement des données personnelles dans le cadre des achats
          (y compris les données de paiement) est régi par la{" "}
          <Strong>Politique de confidentialité</Strong> Niqo. Les données
          comptables sont conservées <Strong>10 ans</Strong> conformément
          aux obligations fiscales rwandaises.
        </P>
      </Section>

      <Section title="12. Modifications des CGV">
        <P>
          Niqo peut modifier les présentes CGV. Toute modification
          matérielle est notifiée via une bannière dans l&apos;application{" "}
          <Strong>au moins 15 jours</Strong> avant son entrée en vigueur.
          Les CGV applicables à une commande sont celles en vigueur au
          moment de la confirmation du paiement.
        </P>
      </Section>

      <Section title="13. Loi applicable">
        <P>
          Les présentes CGV sont régies par le{" "}
          <Strong>droit rwandais</Strong>, sous réserve des dispositions
          impératives plus favorables au consommateur ivoirien ou
          congolais.
        </P>
      </Section>

      <Section title="14. Contact">
        <Bullet>
          Support / questions sur un service :{" "}
          <Strong>support@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Facturation, remboursement, litige :{" "}
          <Strong>billing@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Données personnelles : <Strong>dpo@niqo.africa</Strong>
        </Bullet>
      </Section>
    </LegalScreen>
  );
}
