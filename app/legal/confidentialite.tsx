import { Bullet, LegalScreen, P, Section, Strong, SubTitle } from "@/components/ui/LegalBlocks";
import { LEGAL_VERSIONS } from "@/lib/legal";

// Politique de confidentialité Niqo — version 1.1 (2026-05-10).
// Source canonique : docs/legal/confidentialite.md.
//
// Cadre légal applicable :
//   - 🇨🇮 Loi 2024-30 (Côte d'Ivoire) — régulateur ARTCI
//   - 🇨🇬 Loi 2023-15 (Congo Brazzaville) — régulateur ANRTIC
//   - 🇷🇼 Loi 2021-058 (Rwanda) — régulateur NCSA, lieu d'immatriculation
//
// Toute modification matérielle doit incrémenter LEGAL_VERSIONS.privacy
// dans lib/legal.ts et être ajoutée à docs/legal/CHANGELOG.md.

export default function ConfidentialiteScreen() {
  return (
    <LegalScreen
      title="Politique de confidentialité"
      version={LEGAL_VERSIONS.privacy.version}
      date={LEGAL_VERSIONS.privacy.date}
    >
      <Section title="1. Préambule">
        <P>
          Cette Politique de confidentialité décrit comment Niqo collecte,
          utilise, partage et protège tes données personnelles. Elle
          complète les Conditions Générales d&apos;Utilisation et
          s&apos;applique à toute personne utilisant l&apos;application
          mobile, le site web (niqo.africa) et les services Niqo.
        </P>
        <P>
          En utilisant Niqo, tu reconnais avoir pris connaissance de cette
          politique. Si tu n&apos;es pas d&apos;accord, n&apos;utilise pas
          la plateforme.
        </P>
      </Section>

      <Section title="2. Responsable de traitement et DPO">
        <P>
          Le responsable de traitement de tes données est la société{" "}
          <Strong>Niqo Ltd</Strong>, immatriculée au Rwanda (Kigali).
        </P>
        <P>
          Le <Strong>Délégué à la Protection des Données (DPO)</Strong> est
          joignable à : <Strong>dpo@niqo.africa</Strong>.
        </P>
        <P>
          Un <Strong>représentant local</Strong> sera désigné en Côte
          d&apos;Ivoire et au Congo Brazzaville dans les 6 mois suivant le
          lancement public, conformément aux exigences ARTCI et ANRTIC.
          Cette information sera publiée dans les Mentions légales.
        </P>
      </Section>

      <Section title="3. Données collectées et finalités">
        <P>
          Niqo collecte uniquement les données strictement nécessaires au
          fonctionnement du service. Voici la liste exhaustive :
        </P>

        <SubTitle>Données d&apos;identification</SubTitle>
        <Bullet>Email (obligatoire pour créer un compte)</Bullet>
        <Bullet>Prénom, nom, ville, quartier (saisis par toi)</Bullet>
        <Bullet>
          Numéro de téléphone Mobile Money (chiffré côté serveur via Supabase
          Vault, jamais exposé en clair via l&apos;API publique)
        </Bullet>
        <Bullet>Pays (CI ou CG, choisi au 1er lancement)</Bullet>
        <Bullet>Photo de profil (avatar) si tu en uploades une</Bullet>
        <P>
          Finalité : créer ton compte, te permettre d&apos;être contacté,
          afficher ton profil public.
        </P>
        <P>Base légale : exécution du contrat (CGU).</P>

        <SubTitle>Données de vérification d&apos;identité (KYC)</SubTitle>
        <Bullet>Photo recto et verso de ta CNI ou passeport</Bullet>
        <Bullet>Selfie en direct</Bullet>
        <Bullet>
          Date et version du consentement explicite (obligatoire avant
          soumission)
        </Bullet>
        <P>
          Finalité : vérifier ton identité, lutter contre les faux comptes
          et la fraude. Conservation : 30 jours en cas de refus, 6 mois
          après validation, puis suppression automatique. Fichiers
          chiffrés au repos, accessibles uniquement à l&apos;équipe
          d&apos;administration Niqo (logs d&apos;accès tracés).
        </P>
        <P>
          Base légale : consentement explicite (case à cocher au début du
          wizard KYC).
        </P>

        <SubTitle>Données de contenu (annonces, messages, avis)</SubTitle>
        <Bullet>
          Annonces publiées : titre, description, photos, prix, ville,
          quartier, catégorie, état, statut
        </Bullet>
        <Bullet>
          Messages échangés via la messagerie interne (texte, type,
          horodatage)
        </Bullet>
        <Bullet>
          Avis et notes post-rendez-vous (1 à 5, commentaire optionnel)
        </Bullet>
        <Bullet>Signalements émis ou reçus, motif et description</Bullet>
        <Bullet>
          Rendez-vous proposés ou confirmés (lieu, date, statut)
        </Bullet>
        <P>
          Finalité : faire fonctionner la marketplace, assurer la
          modération communautaire, calculer les scores de réputation.
        </P>
        <P>Base légale : exécution du contrat.</P>

        <SubTitle>Données de paiement</SubTitle>
        <Bullet>
          Type de service (vérification, boost), montant, statut, horodatage
        </Bullet>
        <Bullet>
          Identifiant de transaction PawaPay (numéro de référence Mobile
          Money — pas le numéro du payeur conservé en clair)
        </Bullet>
        <P>
          Finalité : tracer les paiements liés aux services Niqo,
          facturation, comptabilité, lutte contre la fraude.
        </P>
        <P>
          Base légale : exécution du contrat + obligations légales
          comptables (conservation 10 ans selon le droit rwandais).
        </P>
        <P>
          <Strong>Niqo ne stocke PAS</Strong> les données de carte bancaire
          ni les codes PIN Mobile Money. Ces informations sont gérées
          directement par PawaPay et les opérateurs Mobile Money (Orange,
          MTN, Airtel, Moov, Wave).
        </P>

        <SubTitle>Données techniques</SubTitle>
        <Bullet>
          Token de notification push (alertes : nouveau message, RDV
          confirmé, etc.)
        </Bullet>
        <Bullet>
          Logs d&apos;authentification (date de connexion, fournisseur
          OAuth, IP — gérés par Supabase)
        </Bullet>
        <Bullet>
          Préférences locales (pays, recherches récentes — stockées sur
          ton téléphone via AsyncStorage, pas envoyées au serveur)
        </Bullet>
        <Bullet>
          Cookies de session pour le site web — cf. Politique cookies
        </Bullet>
        <P>
          Finalité : sécurité, support technique, expérience utilisateur.
        </P>
        <P>Base légale : intérêt légitime (sécurité du service).</P>
      </Section>

      <Section title="4. Sources des données">
        <P>Toutes tes données proviennent :</P>
        <Bullet>De toi (saisie volontaire dans l&apos;app)</Bullet>
        <Bullet>
          De ton fournisseur OAuth si tu utilises Connexion Google ou Apple
          (email + nom uniquement)
        </Bullet>
        <Bullet>
          Du processus de paiement (PawaPay nous transmet le statut, pas
          ton solde ni ton historique global)
        </Bullet>
        <Bullet>
          Générées par l&apos;application (push tokens, logs, scores
          calculés)
        </Bullet>
        <P>
          Niqo n&apos;achète aucune donnée à des tiers et ne fait pas de
          géolocalisation passive.
        </P>
      </Section>

      <Section title="5. Partenaires et sous-traitants">
        <P>
          Niqo s&apos;appuie sur des prestataires techniques pour fournir
          le service. Ils traitent tes données pour le compte de Niqo,
          sous contrat strict de confidentialité :
        </P>
        <Bullet>
          <Strong>Supabase</Strong> (base de données, authentification,
          stockage de fichiers, fonctions serverless) — UE / Irlande
        </Bullet>
        <Bullet>
          <Strong>PawaPay</Strong> (paiements Mobile Money) — Rwanda /
          Kenya
        </Bullet>
        <Bullet>
          <Strong>Resend</Strong> (emails transactionnels) — UE /
          États-Unis
        </Bullet>
        <Bullet>
          <Strong>Expo / Apple Push / Google FCM</Strong> (notifications
          push) — États-Unis
        </Bullet>
        <Bullet>
          <Strong>Google et Apple</Strong> (auth OAuth si tu te connectes
          avec leur compte) — États-Unis
        </Bullet>
        <Bullet>
          <Strong>Vercel</Strong> (hébergement du site web et de
          l&apos;admin) — UE / États-Unis
        </Bullet>
        <P>
          Aucune de ces données n&apos;est revendue à des tiers à des fins
          publicitaires. Niqo ne fait pas de profilage publicitaire.
        </P>
      </Section>

      <Section title="6. Transferts internationaux">
        <P>
          Tes données sont hébergées principalement chez Supabase (Union
          européenne, Irlande). Certains traitements transitent par les
          États-Unis (Resend, Expo, Apple Push, Google FCM, Vercel) sous
          le cadre des <Strong>clauses contractuelles types</Strong> (CCT)
          adoptées par la Commission européenne, ou des standards
          équivalents reconnus par le Rwanda, la CI et le Congo.
        </P>
        <P>
          Pour obtenir copie des CCT applicables ou en savoir plus sur les
          garanties contractuelles : <Strong>dpo@niqo.africa</Strong>.
        </P>
      </Section>

      <Section title="7. Durée de conservation">
        <Bullet>
          <Strong>Compte actif</Strong> : tant que tu utilises Niqo
        </Bullet>
        <Bullet>
          <Strong>Compte inactif</Strong> : 5 ans après la dernière
          connexion, puis anonymisation
        </Bullet>
        <Bullet>
          <Strong>CNI / pièce d&apos;identité</Strong> : 30 jours en cas
          de refus, 6 mois après validation
        </Bullet>
        <Bullet>
          <Strong>Annonces vendues ou expirées</Strong> : 90 jours puis
          anonymisation
        </Bullet>
        <Bullet>
          <Strong>Messages</Strong> : conservés tant que les deux comptes
          participants existent ; soft delete possible par modération
        </Bullet>
        <Bullet>
          <Strong>Avis et signalements traités</Strong> : conservation
          indéfinie (historique communautaire) — anonymisés en cas de
          suppression du compte de l&apos;auteur
        </Bullet>
        <Bullet>
          <Strong>Données comptables</Strong> (paiements vérification,
          boosts) : 10 ans pour conformité fiscale rwandaise
        </Bullet>
        <Bullet>
          <Strong>Logs techniques</Strong> (auth, requêtes) : 30 jours
        </Bullet>
        <Bullet>
          <Strong>Logs d&apos;audit admin</Strong> : 5 ans
        </Bullet>
        <Bullet>
          <Strong>Tokens de notifications push</Strong> : tant que valides
          + 90 jours après désinstallation
        </Bullet>
      </Section>

      <Section title="8. Sécurité">
        <P>
          Niqo met en œuvre les mesures techniques et organisationnelles
          suivantes :
        </P>
        <Bullet>
          Chiffrement TLS pour tous les échanges entre l&apos;app et le
          serveur
        </Bullet>
        <Bullet>
          Chiffrement au repos pour les données sensibles (téléphone, CNI,
          secrets internes via Supabase Vault)
        </Bullet>
        <Bullet>
          Politiques de sécurité au niveau ligne (RLS) activées sur{" "}
          <Strong>toutes</Strong> les tables
        </Bullet>
        <Bullet>
          Auth forte par OAuth (Google, Apple) ou mot de passe avec
          hashage Argon2 (Supabase Auth)
        </Bullet>
        <Bullet>
          Logs d&apos;accès aux données sensibles tracés (table d&apos;audit
          admin)
        </Bullet>
        <Bullet>Cloisonnement des secrets (clés API jamais exposées)</Bullet>
        <Bullet>Anti-brute-force sur les tentatives de connexion</Bullet>
        <Bullet>
          Filtrage de contenu sur la messagerie (mots interdits)
        </Bullet>
        <P>
          <Strong>8.1 Notification d&apos;incident</Strong>
        </P>
        <P>
          En cas de violation de données affectant tes informations
          personnelles, Niqo te notifiera par email et notification push
          dans les <Strong>72 heures</Strong> suivant la prise de
          connaissance, et informera les autorités compétentes (ARTCI,
          ANRTIC, NCSA).
        </P>
        <P>
          <Strong>8.2 Signaler une vulnérabilité</Strong>
        </P>
        <P>
          Pour signaler une vulnérabilité technique (responsible
          disclosure) : <Strong>security@niqo.africa</Strong>.
        </P>
      </Section>

      <Section title="9. Tes droits">
        <P>
          Conformément aux lois ARTCI 2024-30 (CI), ANRTIC 2023-15 (CG) et
          NCSA 2021-058 (Rwanda), tu disposes des droits suivants :
        </P>
        <Bullet>
          <Strong>Droit d&apos;accès</Strong> : obtenir une copie de tes
          données
        </Bullet>
        <Bullet>
          <Strong>Droit de rectification</Strong> : corriger des données
          inexactes (modifiable directement depuis l&apos;app pour la
          plupart)
        </Bullet>
        <Bullet>
          <Strong>Droit à l&apos;effacement</Strong> (droit à l&apos;oubli) :
          supprimer ton compte et tes données depuis l&apos;écran Profil.
          Suppression immédiate sauf pour les données comptables (10 ans)
          et les contributions communautaires (anonymisées).
        </Bullet>
        <Bullet>
          <Strong>Droit d&apos;opposition</Strong> à un traitement basé sur
          l&apos;intérêt légitime
        </Bullet>
        <Bullet>
          <Strong>Droit à la limitation</Strong> : geler temporairement le
          traitement pendant un litige
        </Bullet>
        <Bullet>
          <Strong>Droit à la portabilité</Strong> : recevoir tes données
          dans un format structuré (JSON ou CSV)
        </Bullet>
        <Bullet>
          <Strong>Droit de retirer ton consentement</Strong> à tout moment
          (cas du KYC) — sans effet rétroactif
        </Bullet>
        <Bullet>
          <Strong>Droit de définir le sort de tes données</Strong> en cas
          de décès (sur demande des proches avec acte de décès)
        </Bullet>
        <Bullet>
          <Strong>Droit de ne pas faire l&apos;objet d&apos;une décision
          automatisée</Strong> à effet juridique significatif (la
          suspension auto est révocable par appel humain — cf. CGU §9.3)
        </Bullet>
        <P>
          Pour exercer ces droits, écris à <Strong>dpo@niqo.africa</Strong>
          {" "}depuis l&apos;adresse email associée à ton compte. Réponse
          sous <Strong>30 jours maximum</Strong> (extensible 30 jours pour
          les demandes complexes).
        </P>
      </Section>

      <Section title="10. Cookies et stockage local">
        <P>
          <Strong>Application mobile</Strong> : aucun cookie publicitaire
          ni tracker tiers. Les données stockées localement (AsyncStorage
          natif) sont : pays choisi, recherches récentes, cache annonces
          vues, session d&apos;authentification (Keychain iOS / Keystore
          Android). Effacées à la désinstallation.
        </P>
        <P>
          <Strong>Site web (niqo.africa)</Strong> : cookies fonctionnels
          strictement nécessaires uniquement (session admin Supabase). Pas
          de cookie publicitaire ni tracker tiers. Détail dans la{" "}
          <Strong>Politique cookies</Strong> dédiée.
        </P>
      </Section>

      <Section title="11. Mineurs">
        <P>
          Niqo est strictement réservé aux personnes majeures (18 ans ou
          plus). Si nous découvrons qu&apos;un compte appartient à un
          mineur, le compte est immédiatement suspendu et les données
          supprimées dans les meilleurs délais.
        </P>
        <P>
          Si tu es parent ou tuteur d&apos;un mineur utilisant Niqo,
          écris-nous à <Strong>dpo@niqo.africa</Strong>.
        </P>
      </Section>

      <Section title="12. Modifications de cette politique">
        <P>
          Cette Politique peut être mise à jour pour refléter des
          évolutions du service ou de la réglementation. Toute modification
          matérielle te sera notifiée via une bannière dans
          l&apos;application <Strong>au moins 15 jours</Strong> avant son
          entrée en vigueur. Les versions antérieures restent consultables
          sur demande à <Strong>dpo@niqo.africa</Strong>.
        </P>
      </Section>

      <Section title="13. Recours auprès des autorités">
        <P>
          Si tu estimes que tes droits ne sont pas respectés malgré nos
          efforts, tu peux saisir l&apos;autorité de protection des données
          de ton pays :
        </P>
        <Bullet>
          🇨🇮 <Strong>ARTCI</Strong> (Côte d&apos;Ivoire) — artci.ci
        </Bullet>
        <Bullet>
          🇨🇬 <Strong>ANRTIC</Strong> (Congo Brazzaville) — anrtic.cg
        </Bullet>
        <Bullet>
          🇷🇼 <Strong>NCSA</Strong> (Rwanda) — cyber.gov.rw
        </Bullet>
      </Section>

      <Section title="14. Contact">
        <P>Pour toute question relative à tes données personnelles :</P>
        <Bullet>
          DPO : <Strong>dpo@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Support général : <Strong>support@niqo.africa</Strong>
        </Bullet>
        <Bullet>
          Sécurité / vulnérabilités : <Strong>security@niqo.africa</Strong>
        </Bullet>
      </Section>
    </LegalScreen>
  );
}
