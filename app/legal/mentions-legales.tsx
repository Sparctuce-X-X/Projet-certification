import { Bullet, LegalScreen, P, Section, Strong } from "@/components/ui/LegalBlocks";
import { LEGAL_VERSIONS } from "@/lib/legal";

// Mentions légales Niqo — source canonique : docs/legal/mentions-legales.md.
// Identité officielle NIQO LTD : extraite du certificat RDB Rwanda
// (cf. _shared/niqo-legal.ts pour les Edge Functions / PDF).

export default function MentionsLegalesScreen() {
  return (
    <LegalScreen
      title="Mentions légales"
      version={LEGAL_VERSIONS.mentionsLegales.version}
      date={LEGAL_VERSIONS.mentionsLegales.date}
    >
      <Section title="1. Éditeur du service">
        <P>
          <Strong>NIQO LTD</Strong> — société immatriculée au Rwanda.
        </P>
        <Bullet>
          Forme juridique : Société de droit rwandais — Private Company
          Limited By Shares
        </Bullet>
        <Bullet>
          Loi applicable : Article 23 of Law N° 007/2021 of 05/02/2021
          régissant les sociétés au Rwanda
        </Bullet>
        <Bullet>
          TIN (Tax Identification Number RDB) :{" "}
          <Strong>150644832</Strong>
        </Bullet>
        <Bullet>Date d&apos;enregistrement : 2025-11-10</Bullet>
        <Bullet>
          Régulateur : Office of the Registrar General (RDB — Rwanda
          Development Board)
        </Bullet>
        <Bullet>
          Activité enregistrée : J6201 — Computer programming activities
        </Bullet>
        <Bullet>
          Capital social : 1 000 000 RWF (1 000 actions × 1 000 RWF)
        </Bullet>
        <Bullet>
          Siège social : KG 622 St, Rebero, Rugando, Kimihurura, Gasabo,
          Kigali, Rwanda
        </Bullet>
        <Bullet>
          Email contact : <Strong>support@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Email juridique : <Strong>legal@niqo.africa</Strong>
        </Bullet>
      </Section>

      <Section title="2. Directeur de la publication">
        <P>
          <Strong>Dominique Huang</Strong>, fondateur et représentant légal
          de NIQO LTD.
        </P>
        <P>
          Contact direction de la publication :{" "}
          <Strong>legal@niqo.africa</Strong>
        </P>
      </Section>

      <Section title="3. Hébergeurs et prestataires techniques">
        <P>
          <Strong>3.1 Hébergeur principal des données</Strong>
        </P>
        <Bullet>Supabase Inc.</Bullet>
        <Bullet>Localisation : Union européenne (Irlande)</Bullet>
        <Bullet>Site : supabase.com</Bullet>
        <Bullet>
          Rôle : base de données PostgreSQL, authentification, stockage de
          fichiers, fonctions serverless
        </Bullet>
        <P>
          <Strong>3.2 Hébergeur du site web et de l&apos;admin</Strong>
        </P>
        <Bullet>Vercel Inc.</Bullet>
        <Bullet>Localisation : UE / États-Unis (CDN global)</Bullet>
        <Bullet>Site : vercel.com</Bullet>
        <Bullet>
          Rôle : hébergement de niqo.africa et de l&apos;interface
          d&apos;administration
        </Bullet>
        <P>
          <Strong>3.3 Prestataire de paiement</Strong>
        </P>
        <Bullet>PawaPay — pawapay.io</Bullet>
        <Bullet>
          Rôle : traitement des paiements Mobile Money (Orange Money, MTN
          MoMo, Moov Money, Airtel Money, Wave) pour les services payants
        </Bullet>
        <P>
          <Strong>3.4 Prestataire d&apos;envoi d&apos;emails</Strong>
        </P>
        <Bullet>Resend — resend.com</Bullet>
        <Bullet>Rôle : emails transactionnels (KYC, admin)</Bullet>
        <P>
          <Strong>3.5 Notifications push</Strong>
        </P>
        <Bullet>Expo Push Notifications (Expo, Inc., États-Unis)</Bullet>
        <Bullet>Apple Push Notification Service (Apple Inc.)</Bullet>
        <Bullet>
          Firebase Cloud Messaging (Google LLC) — Phase 2 pour Android
        </Bullet>
      </Section>

      <Section title="4. Application mobile">
        <Bullet>Nom : Niqo</Bullet>
        <Bullet>
          Plateformes : iOS (Apple App Store) + Android (Google Play
          Store, Phase 2)
        </Bullet>
        <Bullet>Éditeur dans les stores : NIQO LTD</Bullet>
        <Bullet>
          App Store iOS :
          https://apps.apple.com/app/niqo-annonces-afrique/id6769410032
          (Apple App ID 6769410032)
        </Bullet>
      </Section>

      <Section title="5. Site web">
        <Bullet>
          Nom de domaine : <Strong>niqo.africa</Strong>
        </Bullet>
        <Bullet>Propriétaire : NIQO LTD</Bullet>
        <Bullet>
          Sous-domaines administratifs : admin.niqo.africa (réservé à
          l&apos;administration interne)
        </Bullet>
      </Section>

      <Section title="6. Propriété intellectuelle">
        <P>
          L&apos;ensemble des éléments composant l&apos;application Niqo
          et le site web (marques, logos, designs, photographies, textes
          éditoriaux, code source) est la propriété exclusive de{" "}
          <Strong>NIQO LTD</Strong>, à l&apos;exception des contenus
          publiés par les utilisateurs (annonces, photos, messages, avis),
          qui restent la propriété de leurs auteurs.
        </P>
        <P>
          Niqo bénéficie d&apos;une licence d&apos;utilisation pour ces
          contenus dans les conditions précisées à l&apos;article 10 des
          CGU.
        </P>
        <P>
          Toute reproduction, représentation, modification, publication ou
          adaptation de tout ou partie des éléments propriétaires de Niqo,
          par quelque moyen que ce soit, sans l&apos;autorisation
          préalable écrite de NIQO LTD, est interdite et constitue une
          contrefaçon sanctionnée par la loi.
        </P>
      </Section>

      <Section title="7. Crédits et conformité tierce">
        <Bullet>
          Polices : Space Grotesk, Inter, JetBrains Mono — distribuées
          sous licence Open Font License (OFL)
        </Bullet>
        <Bullet>Icônes : Lucide — licence ISC</Bullet>
        <Bullet>
          Frameworks open-source : React, React Native, Expo, Next.js,
          Tailwind CSS, Supabase, et leurs dépendances respectives
        </Bullet>
      </Section>

      <Section title="8. Représentant local et DPO">
        <Bullet>
          Délégué à la Protection des Données (DPO) :{" "}
          <Strong>dpo@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Représentant local au Congo Brazzaville : à désigner dans les{" "}
          <Strong>6 mois</Strong> suivant le lancement public,
          conformément aux exigences ANRTIC
        </Bullet>
        <P>
          Cette page sera mise à jour dès la désignation effective. Le
          représentant local en Côte d&apos;Ivoire sera désigné lors de
          l&apos;extension Phase 2 conformément aux exigences ARTCI.
        </P>
      </Section>

      <Section title="9. Signaler un contenu illicite">
        <P>
          Toute personne souhaitant signaler un contenu manifestement
          illicite (contrefaçon, atteinte à la vie privée, diffamation,
          contenu violent ou pornographique non sollicité) peut écrire à{" "}
          <Strong>legal@niqo.africa</Strong> en suivant la procédure
          définie à l&apos;article 9.2 des CGU (notice-and-takedown).
        </P>
      </Section>

      <Section title="10. Contact">
        <Bullet>
          Support général : <Strong>support@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Questions juridiques : <Strong>legal@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Données personnelles / DPO : <Strong>dpo@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Vulnérabilités / sécurité :{" "}
          <Strong>security@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Facturation / remboursements :{" "}
          <Strong>billing@niqo.africa</Strong>
        </Bullet>
      </Section>
    </LegalScreen>
  );
}
