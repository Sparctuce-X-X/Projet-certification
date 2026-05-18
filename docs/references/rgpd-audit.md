# Niqo — Audit RGPD

> Document de conformité. À remplir après **chaque** feature qui touche à des données personnelles.
> Cadre légal : CI loi 2024-30 (ARTCI), CG loi 2023-15 (ANRTIC), Rwanda 2021-058 (NCSA), RGPD UE (bonnes pratiques).
> Cf. `CLAUDE.md` §RGPD pour la checklist complète des 10 points.

---

## Entrée #1 — Inscription / Connexion (Auth Supabase)

- **Date** : 2026-04-28
- **Feature** : Inscription email + Vault téléphone + RPC `get_my_phone()` + droit à l'oubli (`delete_my_account`)
- **Branche** : `Authentification`
- **Fichiers concernés** :
  - `app/auth/email.tsx` (form signup/signin)
  - `app/auth/callback.tsx` (callback OAuth)
  - `lib/auth/AuthProvider.tsx` (session + profile)
  - `lib/supabase.ts` (client + helpers)
  - `docs/migrations/01_users.sql` (table `public.users` + RLS + trigger)
  - `docs/migrations/02_users_phone_vault.sql` (chiffrement téléphone)
  - `docs/migrations/03_user_account_deletion.sql` (RPC droit à l'oubli)
  - `docs/migrations/04_users_purge_suspended_cron.sql` (rétention 30j)

### 1. Données collectées

| Donnée | Source | Stockage |
|---|---|---|
| `email` | Saisie user (signup) ou OAuth provider | `auth.users.email` + `public.users.email` (clair) |
| `prenom`, `nom` | Saisie user / OAuth claims (`given_name`, `family_name`) | `public.users.prenom/nom` (clair) |
| `telephone` (Mobile Money) | Saisie user au signup | `public.users.telephone bytea` (AES-256 via Vault) |
| `pays` (CI/CG) | `AsyncStorage.niqo_country` au CountryPicker | `public.users.pays` (enum) |
| `ville` | Saisie user au signup | `public.users.ville` (clair) |
| `quartier` | Saisie user au signup | `public.users.quartier` (clair) |
| `password` | Saisie user au signup | `auth.users.encrypted_password` (bcrypt côté GoTrue) |
| `auth_provider` | Inferré (`email`/`google`/`apple`) | `public.users.auth_provider` (enum) |
| `avatar_url` | OAuth providers, plus tard `/profile` upload | `public.users.avatar_url` (URL vers Supabase Storage) |

**Pas collecté** : date de naissance, photo identité, IP, géoloc précise, carte bancaire (PawaPay handle Mobile Money seul), historique de navigation, contacts du téléphone.

### 2. But du traitement

- **Authentification** : identifier l'user de manière unique (email + password)
- **Communication** : permettre au vendeur et acheteur de se contacter (téléphone) pour rendez-vous physique d'échange
- **Paiement Mobile Money** : envoyer/recevoir les fonds via PawaPay (téléphone = identifiant Mobile Money)
- **Géolocalisation marchande** : matcher annonces locales (`pays` filter au minimum, `ville`/`quartier` pour affinité)
- **Identification publique partielle** : afficher prénom + ville sur les annonces pour la confiance acheteur

But **légitime** et **proportionné** : oui — chaque donnée a un usage produit direct, aucune n'est collectée "au cas où".

### 3. Minimisation

- ✅ Pas de date de naissance — pas requise pour le service
- ✅ Pas de photo identité MVP — KYC reporté Phase 2 (CDC §non-goals)
- ✅ Pas d'IP loggée custom (Supabase logs basiques uniquement)
- ✅ `pays` est requis pour le filtre annonces, c'est le minimum vital
- ⚠ `quartier` est demandé au signup — débat interne : si user à Bouaké et le quartier est moins discriminant, demander quand même ? Décision : oui, car aide les annonces locales et optionnel à terme dans `/profile`. Évaluer après 100 signups.

### 4. Stockage & sécurité

| Couche | Mécanisme |
|---|---|
| Transport | TLS 1.3 (Supabase REST + WebSocket) |
| Au repos — `email`, `prenom`, `nom`, `ville`, `quartier`, `pays` | Postgres clair, RLS `users_own_profile` (`auth.uid() = id`) bloque toute lecture cross-user |
| Au repos — `telephone` | `bytea` chiffré AES-256 via `pgp_sym_encrypt` (pgcrypto). Clé stockée dans `vault.secrets` (Supabase Vault). Lecture uniquement via RPC `get_my_phone()` (SECURITY DEFINER, gate `auth.uid()`) |
| Au repos — `password` | Bcrypt côté GoTrue (`auth.users.encrypted_password`). Jamais accessible via REST. |
| Mobile — session JWT | `expo-secure-store` (Keychain iOS / Android Keystore, AES hardware-backed). Fallback AsyncStorage si SecureStore indispo. |
| RLS supplémentaire | Colonne `telephone bytea` lisible via PostgREST mais retourne du bytea inutilisable sans clé Vault → defense-in-depth |

### 5. Consentement

- ✅ **Checkbox CGU + Politique de confidentialité** au signup, requis avant submit (cf. `app/auth/email.tsx` `acceptedTerms` state, ajouté 2026-04-28).
- ✅ Liens tappables vers `niqo.africa/legal/cgu` et `niqo.africa/legal/confidentialite` (pages externes en attendant routes in-app).
- ✅ Pas de pre-check par défaut — l'user doit cocher activement.
- ⚠ **Granularité** : actuellement consentement bloc CGU+Confidentialité ensemble. Granularité fine (consentement marketing séparé, etc.) reportée Phase 2 quand on aura un canal marketing.
- ⚠ **OAuth Google/Apple** : le consentement est implicite (le user accepte le partage des claims du provider). À documenter dans la page Confidentialité.

### 6. Droit à l'oubli

- ✅ **Bouton "Supprimer mon compte"** dans `/profile` (ajouté 2026-04-28).
- ✅ Double confirmation Alert avant exécution (irréversible).
- ✅ RPC `public.delete_my_account()` SECURITY DEFINER → `delete from auth.users where id = auth.uid()`.
- ✅ FK `public.users.id REFERENCES auth.users(id) ON DELETE CASCADE` → suppression atomique des deux lignes.
- ⚠ **Limites actuelles** : aucune table dépendante (annonces, transactions, messages) n'existe encore. Quand elles existeront, il faudra **anonymiser** plutôt que delete pour les transactions (rétention fiscale 10 ans CI/CG). Voir TODO §rétention.

### 7. Rétention

| Donnée | Durée | Mécanisme |
|---|---|---|
| Compte actif | Indéfiniment tant que l'user reste | — |
| Compte suspendu (`is_active = false`) | 30 jours puis purge auto | `pg_cron` job `niqo-purge-suspended-users` (3am UTC daily) — cf. migration 04 |
| Sessions JWT | Access token 1h, refresh token 30j (auto-refresh) | GoTrue defaults |
| Logs Auth Supabase | 30 jours (free tier), 7j (Pro tier audit logs) | Supabase défaut |

**TODOs futurs** (à mentionner ici quand les features seront codées) :
- Annonces : 60j auto-expire (CDC) — créer `pg_cron` purge dans `02_annonces.sql`
- Transactions : **10 ans** rétention fiscale CI/CG — anonymisation seulement, pas delete
- Litiges/Avis : idem transactions
- Messages : à débattre — 12 mois ? Lifecycle annonce ?

### 8. Tiers

| Tiers | Données partagées | Localisation | DPA |
|---|---|---|---|
| Supabase | Tout (host DB + auth + storage) | eu-west-3 (Paris) | DPA standard Supabase auto-accepté à l'inscription. **À vérifier en S1-2 admin** |
| PawaPay | `telephone` (E.164) lors deposits/payouts | Africa (selon provider) | **Pas encore signé** — à faire avant S6-7 paiements |
| Expo Push (S8+) | Device push token uniquement | Apple APNs / Google FCM | Standards Apple/Google |
| Apple/Google OAuth | Email + nom + photo profil | Apple/Google | DPA implicite via Sign in with Apple/Google docs |

❌ **Ne jamais** envoyer de PII dans les payloads push (Apple/Google les voient en clair).
❌ **Ne jamais** logger `telephone` ou `email` dans Sentry/console en prod.

### 9. Accès interne

- **Admin Dominique Huang** : seul humain avec accès Supabase Dashboard (service_role, lecture totale).
  - 🔴 **TODO** : activer 2FA sur le compte Supabase admin (S1-2).
- **Aucun autre humain** n'a accès aux données.
- Logs d'accès custom non encore implémentés. Supabase Audit Logs activés par défaut (Pro tier requis pour rétention >30j).

### 10. Plan en cas de breach

Cf. `docs/incident-response.md` (template créé 2026-04-28).
- **Notification ARTCI/ANRTIC sous 72h** obligatoire (CI loi 2024-30 art. 34, CG loi 2023-15 art. 28).
- Notification users impactés en parallèle.

---

## TODOs ouvertes pour cette feature (#1)

- [ ] Activer 2FA sur le compte admin Supabase (S1-2)
- [ ] Vérifier DPA Supabase signé / archivé
- [ ] Signer DPA PawaPay avant S6-7
- [ ] Implémenter purge auto annonces 60j dans `02_annonces.sql` quand la feature shippera
- [ ] Politique de rétention 10 ans transactions (anonymisation, pas delete) — design à figer en S6-7
- [ ] Logs d'accès admin custom (S11)
- [ ] Rédiger les pages `/legal/cgu` et `/legal/confidentialite` (URLs actuelles 404)
- [ ] Re-confirmation user lors d'une mise à jour majeure des CGU (Phase 2)
- [ ] Granularité du consentement (marketing séparé, etc.) — Phase 2

---

## Entrée #2 — Modification du profil + avatar

- **Date** : 2026-04-28
- **Feature** : Écran d'édition du profil — modification des champs identité/localisation/coordonnées + email (avec lien de confirmation) + upload photo avatar
- **Branche** : `main` (suite de `profil`)
- **Fichiers concernés** :
  - `app/profile/edit.tsx` (form édition + avatar picker)
  - `app/profile.tsx` (bouton "Modifier" + `useFocusEffect` refetch téléphone)
  - `app/home.tsx` (`useFocusEffect` re-lit `niqo_country` au focus)
  - `lib/profile.ts` (helpers `updateProfile` / `updateMyPhone` / `updateEmail` / `uploadAvatar`)
  - `lib/auth/AuthProvider.tsx` (méthode `refreshProfile`)
  - `app.json` (plugin `expo-image-picker` + permissions iOS caméra/photos)
  - `docs/migrations/09_profile_updates.sql` (bucket `avatars` + RLS storage + RPC `update_my_phone` + trigger sync `auth.users.email` → `public.users.email`) [renommée de 05 lors du merge develop]

### 1. Données collectées (incrément vs entrée #1)

| Donnée | Source | Stockage | Statut |
|---|---|---|---|
| `avatar` (image binaire) | Galerie ou caméra device via `expo-image-picker` | Supabase Storage bucket `avatars`, path `{user_id}/avatar-{timestamp}.{ext}`, **public read** | **NEW** |
| `avatar_url` | Calculé après upload | `public.users.avatar_url` (URL publique CDN Supabase) | NEW remplissage (colonne pré-existait) |

Tous les autres champs (`prenom`, `nom`, `pays`, `ville`, `quartier`, `telephone`, `email`) sont **modifiables** via cette feature mais déjà documentés dans entrée #1 (collecte au signup). Pas de nouveau champ texte.

### 2. But du traitement

- **Avatar** : identification visuelle vendeur/acheteur, renforce la confiance pour les rendez-vous physiques d'échange (escrow + remise main propre). Affichage public sur cards annonces et profil vendeur.
- **Édition champs identité/localisation** : permet à l'user de corriger une faute de frappe au signup, mettre à jour suite à un déménagement (CI ↔ CG, changement ville/quartier).
- **Changement de Mobile Money** : permet à l'user de changer de SIM/opérateur en mettant à jour son `telephone`.
- **Changement d'email** : récupération d'accès si perte du compte mail initial, changement de FAI.

But **légitime** et **proportionné** : oui — droit RGPD fondamental de **rectification des données** (art. 16 RGPD UE, art. 21 loi CI 2024-30, art. 18 loi CG 2023-15).

### 3. Minimisation

- ✅ **Pas de nouvelle catégorie** de PII — juste avatar + édition de champs existants.
- ✅ Avatar **optionnel** — l'user n'est jamais forcé d'uploader une photo.
- ✅ **Crop forcé carré** (`allowsEditing: true, aspect: [1,1]`) — réduit la surface d'info contextuelle (lieu, personnes en arrière-plan).
- ✅ **Compression** (`quality: 0.8`) — réduit la résolution → moins d'EXIF/détails identifiants involontaires.
- ⚠ **EXIF metadata** : `expo-image-picker` n'a **pas** de stripping explicite — la photo peut contenir GPS, modèle device, timestamp. **À évaluer** : est-ce que le picker iOS/Android par défaut strip les EXIF ? Si non, ajouter `expo-image-manipulator` pour ré-encoder. → TODO ci-dessous.
- ⚠ Path Storage `{user_id}/avatar-{timestamp}.{ext}` : l'UUID `{user_id}` est dans le path public. Pas un secret (l'UUID n'est pas exposé via REST sauf via les annonces du user), mais ce n'est pas opaque non plus. Acceptable car (a) bucket public read par design, (b) UUID v4 = non énumérable.

### 4. Stockage & sécurité

| Couche | Mécanisme |
|---|---|
| Transport upload/download | TLS 1.3 (Supabase Storage REST) |
| Au repos — fichier image | Supabase Storage S3 (chiffré au repos par défaut côté Supabase). **Public read** par design (tout user/anonyme peut afficher). |
| RLS `storage.objects` (avatars) | 4 policies dans migration 09 : `select` ouverte, `insert/update/delete` gated par `(storage.foldername(name))[1] = auth.uid()::text` → **propriétaire seul peut écrire ses fichiers**. |
| Au repos — `users.avatar_url` | URL publique CDN Supabase, lisible via REST (gate par RLS `users_own_profile`) |
| RPC `update_my_phone` | SECURITY DEFINER, gate `auth.uid() is not null`, ré-encrypte à chaque update via `public.encrypt_phone()` (Vault inchangé) |
| Trigger sync email | `on_auth_user_email_updated` AFTER UPDATE OF email sur `auth.users` → `public.users.email`. Fire UNIQUEMENT après confirmation du lien magique par l'user. |

### 5. Consentement

- ✅ **Permissions OS explicites** pour caméra et photothèque, demandées au moment du tap (pas pré-demandées au launch) :
  - iOS : `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` (cf. `app.json` plugin `expo-image-picker`)
  - Android : permissions auto-gérées par le plugin (`READ_EXTERNAL_STORAGE` / `CAMERA`)
- ✅ **Modification de PII existantes** : consentement implicite — l'user édite ses propres données qu'il a déjà accepté de fournir au signup. Pas besoin de re-consentement (art. 21 RGPD UE).
- ✅ **Changement d'email — double confirmation** : `supabase.auth.updateUser({ email })` envoie un lien magique sur la nouvelle adresse (et sur l'ancienne si "Secure email change" activé dans le dashboard, recommandé). L'email **ne change que si l'user clique le lien** → consentement actif.
- ⚠ **Pas de re-consentement CGU** lors de la modification : OK car les CGU n'ont pas changé. Si une mise à jour majeure des CGU intervient, prévoir une re-confirmation (déjà TODO entrée #1).

### 6. Droit à l'oubli

- ✅ **Cascade DB** OK : `public.users.id REFERENCES auth.users(id) ON DELETE CASCADE` (entrée #1).
- ✅ **Cleanup Storage à la suppression** (fix 2026-04-28) : `lib/supabase.ts:deleteMyAccount()` purge maintenant le bucket `avatars/{user_id}/` AVANT d'appeler la RPC `delete_my_account`. L'ordre est critique — l'inverse laisserait des fichiers orphelins (la RLS bloque `delete` une fois la session invalidée). Si la purge throw, on abort le delete : mieux vaut un compte vivant que des PII orphelines sur le CDN. Repose sur la policy `avatars_owner_delete` de la migration 09 (pas besoin de service_role ni d'Edge Function).
- ✅ **Cleanup avatars antérieurs** (fix 2026-04-28) : `lib/profile.ts:uploadAvatar()` appelle `cleanupOldAvatars()` après chaque upload réussi → liste `{user_id}/` et supprime tous les fichiers ≠ celui qu'on vient de créer. Best-effort (erreurs swallowed) : si la cleanup échoue, l'avatar courant marche, seul effet est un éventuel bloat récupérable plus tard. Pas de rétention non motivée des anciennes photos.

### 7. Rétention

| Donnée | Durée | Mécanisme |
|---|---|---|
| Avatar (fichier Storage) | Indéfinie tant que compte actif | À aligner sur les TODOs §6 (cleanup à delete + cleanup à update) |
| `avatar_url` (colonne DB) | Idem ci-dessus, purge via cascade `auth.users.id` (cf. entrée #1) | — |
| Anciens emails | **Non conservés** — `auth.users.email` est écrasé après confirmation. Pas d'historique. | Acceptable : pas de cas d'usage légal pour conserver l'historique des emails. |
| Anciens téléphones | **Non conservés** — `users.telephone` est écrasé à chaque `update_my_phone`. | Idem. |

### 8. Tiers

- **Aucun nouveau tiers**. Tout reste dans Supabase (DB + Storage).
- L'avatar passe par le CDN Supabase (Cloudflare). DPA Supabase couvre déjà.
- Le lien de confirmation email est envoyé via le **SMTP Supabase par défaut** — TODO entrée #1 (vérifier DPA Supabase) couvre ce point. Si on bascule sur SendGrid/Resend en Phase 2, **nouveau DPA à signer**.

### 9. Accès interne

- **Pas de changement** vs entrée #1 (Dominique seul, via Supabase Dashboard).
- ⚠ **Audit log changements d'email** : un takeover de compte commence souvent par un changement d'email frauduleux. Idéalement on logge `auth.users.email` change events dans une table `audit_email_changes` (old_email, new_email, ip, ts) accessible admin-only. → TODO Phase 2.

### 10. Plan en cas de breach

- Cf. `docs/incident-response.md`. Inchangé.
- **Cas spécifique avatars** : si breach Storage, les photos profil sont déjà publiques → impact RGPD limité (pas de leak supplémentaire vs état nominal).

---

## Entrée #3 — Complétion de profil post-OAuth (Google / Apple)

- **Date** : 2026-04-29
- **Feature** : Écran obligatoire après signup OAuth pour collecter `ville`/`quartier`/`telephone` (non récupérés par les claims OAuth) + checkbox CGU/Confidentialité (consentement explicite). "Annuler" supprime le compte.
- **Branche** : `Authentification`
- **Fichiers concernés** :
  - `app/auth/complete-profile.tsx` (form ville/quartier/phone + checkbox CGU)
  - `components/ui/ProfileCompletionGate.tsx` (guard global, force la nav)
  - `lib/auth/AuthProvider.tsx` (`needsProfileCompletion`, `refreshProfile`, transform `telephone bytea` → `has_phone`)
  - `lib/supabase.ts` (`completeMyProfile()` helper)
  - `docs/migrations/05_fix_auth_provider.sql` (fix bug `auth_provider` OAuth)
  - `docs/migrations/06_complete_my_profile_rpc.sql` (RPC SECURITY DEFINER avec encryption Vault)

### 1. Données collectées

Identique à entrée #1 — pas de nouvelles colonnes ni de nouveaux types de données.

| Donnée | Source | Stockage |
|---|---|---|
| `ville` | Saisie user (CityPicker) | `public.users.ville` (clair) — overrides le fallback "Abidjan/Brazzaville" du trigger |
| `quartier` | Saisie user (optionnel) | `public.users.quartier` (clair, nullable) |
| `telephone` (Mobile Money) | Saisie user (E.164) | `public.users.telephone bytea` (AES-256 via Vault — encryption faite par la RPC SECURITY DEFINER) |

### 2. But du traitement

Identique à entrée #1. La complétion ne change pas les buts — elle ramène les utilisateurs OAuth au même niveau de complétude qu'un signup email pour permettre les mêmes fonctionnalités produit (paiement Mobile Money, mise en relation acheteur/vendeur, géolocalisation marchande).

### 3. Minimisation

- ✅ **3 champs uniquement** : ville, quartier, téléphone — strict minimum nécessaire pour participer à une transaction escrow Niqo.
- ✅ Quartier marqué **(optionnel)** — divergence intentionnelle vs email signup où il était requis. Justification : OAuth flow ne devrait pas être plus contraignant que email pour des données nice-to-have.
- ✅ Pas de champs ajoutés "au cas où" (pas de date de naissance, pas de bio, pas d'avatar — tout ça vient plus tard via `/profile`).

### 4. Stockage & sécurité

Identique à entrée #1. Le téléphone passe par la **même RPC SECURITY DEFINER pattern** :

```
client (text plaintext)
  → supabase.rpc("complete_my_profile", { p_telephone: "+225..." })
  → public.complete_my_profile() (SECURITY DEFINER, gate auth.uid())
    → public.encrypt_phone(plaintext)
      → vault.decrypted_secrets (clé AES-256)
      → pgp_sym_encrypt → bytea
    → UPDATE public.users SET telephone = bytea
```

La clé Vault ne quitte **jamais** Postgres. Le client n'a accès qu'au plaintext qu'il vient de saisir + (plus tard via `get_my_phone()`) au plaintext de **son propre** numéro.

### 5. Consentement

- ✅ **Checkbox CGU + Politique de confidentialité** sur l'écran `/auth/complete-profile`, requise avant submit (ajoutée 2026-04-29 suite à audit).
- ✅ Liens tappables vers `niqo.africa/legal/cgu` et `niqo.africa/legal/confidentialite` (mêmes URLs que email signup).
- ⚠ **Limite assumée — timing du consentement** : le row `auth.users` + `public.users` (avec `prenom`, `nom`, `email`, `pays`, `ville`-fallback) existe **avant** le tick CGU, créé par le trigger `handle_new_user` au retour OAuth. Pattern standard de l'industrie (Spotify, Airbnb, Vinted) mais techniquement le traitement de données commence avant consentement explicite.
  - **Mitigation** : le bouton "Annuler" sur cet écran déclenche `delete_my_account()` (pas un simple signOut) — l'user qui refuse les CGU voit son compte effacé immédiatement. Donc à aucun moment Niqo ne conserve un row utilisateur sans consentement actif.
  - **Acceptabilité légale** : conforme RGPD art. 6.1.b (exécution du contrat précontractuelle — le user a manifesté son intérêt en lançant l'OAuth) tant que le delete-on-cancel reste implémenté.

### 6. Droit à l'oubli

- ✅ Inchangé vs entrée #1 — même RPC `delete_my_account()`.
- ✅ **Renforcé** : "Annuler" sur complete-profile = `delete_my_account()` (pas signOut). Évite les comptes orphelins en DB pour les users qui abandonnent l'inscription OAuth.

### 7. Rétention

Inchangé vs entrée #1.

### 8. Tiers

Inchangé vs entrée #1. La complétion ne fait pas appel à de nouveaux tiers.

### 9. Accès interne

Inchangé vs entrée #1.

### 10. Plan en cas de breach

Inchangé vs entrée #1.

### Bug fix associé — `auth_provider` OAuth

Migration `05_fix_auth_provider.sql` corrige un bug du trigger qui écrivait `auth_provider = 'email'` pour tous les users (y compris Google/Apple). **Pas d'impact RGPD direct** (la donnée n'était pas exfiltrée), mais important pour :
- Reporting interne (KPI mix providers)
- Affichage admin futur ("Compte créé via Google le …")
- Politique de re-confirmation : si on demande un jour aux users email de re-saisir leur mdp, on ne veut pas embêter les Google/Apple.

Backfill inclus dans la migration → corrige les rows existants au moment du SQL run.

---

## TODOs ouvertes pour la feature #2 (modification profil + avatar)

- [x] 🔴 **Bloquant droit à l'oubli** ✅ Réglé 2026-04-28 — `deleteMyAccount` purge le bucket Storage avant le delete `auth.users` (`lib/supabase.ts`).
- [x] 🟡 **Anti-bloat Storage** ✅ Réglé 2026-04-28 — `uploadAvatar` appelle `cleanupOldAvatars()` après succès (`lib/profile.ts`).
- [ ] 🟡 **EXIF stripping** : tester si `expo-image-picker` strip les EXIF par défaut sur iOS et Android. Si non, intégrer `expo-image-manipulator` dans `uploadAvatar` pour ré-encoder l'image (perte minime de qualité, gain RGPD).
- [ ] 🟢 **Audit log** des changements d'email : table `audit_email_changes` pour traçabilité takeover (Phase 2).
- [ ] 🟢 **Vérifier "Secure email change"** activé dans le dashboard Supabase (Authentication → Providers → Email) — défaut yes depuis 2024 mais à confirmer côté admin.
- [ ] 🟢 **Rate limiting** sur les RPC `update_my_phone` et les `update` REST sur `users` — éviter scraping/abuse (Phase 2, Supabase Pro tier requis pour rate limit custom).

## TODOs ouvertes pour la feature #3 (complétion post-OAuth)

- [x] Checkbox CGU sur l'écran complete-profile (livré 2026-04-29)
- [x] "Annuler" = delete_my_account (livré 2026-04-29)
- [ ] Pages `/legal/cgu` et `/legal/confidentialite` à mettre en ligne (héritée de #1, bloquant pre-launch)
- [ ] Documenter dans la page Confidentialité que le row est créé pré-consentement avec mitigation delete-on-cancel
- [ ] Vérifier en S11 (avant launch) qu'aucun row `public.users` orphelin (sans consentement explicite) ne traîne en DB → query d'audit à coder

---

## Entrée #4 — Module Annonces (création, édition, suppression, expiration)

- **Date** : 2026-04-29
- **Feature** : Création/édition/suppression d'annonces via wizard `/sell`, expiration auto à 60j, prolongation 28j, purge auto cron, photos annonces (bucket Storage), profil public vendeur (RPC), anti-spam (rate limit 5/24h), anti-doublon (trigger)
- **Branche** : `annonces`
- **Fichiers concernés** :
  - `app/sell.tsx` (wizard 4 steps + checkbox CGU 1er post)
  - `components/sell/Step1Details.tsx` à `Step4Price.tsx`
  - `lib/annonces.ts` (6 helpers CRUD)
  - `lib/annonces/errors.ts` (mapping erreurs FR)
  - `lib/storage/annonces-photos.ts` (compression + upload + cleanup)
  - `lib/users.ts` (`fetchPublicUserProfile` via RPC)
  - `docs/migrations/15_annonces.sql` (table + RLS + triggers)
  - `docs/migrations/16_annonces_expiration.sql` (crons + RPCs + anti-spam)
  - `docs/migrations/17_annonces_anti_doublon.sql` (trigger anti-doublon)
  - `supabase/functions/purge-annonces-photos/index.ts` (Edge Function purge Storage)

### 1. Données collectées

| Donnée | Source | Stockage | PII ? |
|---|---|---|---|
| `titre` (3-50 chars) | Saisie vendeur (Step 1) | `annonces.titre` (clair) | Non directement, mais peut contenir infos contextuelles |
| `description` (10-2000 chars) | Saisie vendeur (Step 1) | `annonces.description` (clair) | Non directement, mais l'user peut y écrire du PII (téléphone, WhatsApp, nom) |
| `prix` | Saisie vendeur (Step 4) | `annonces.prix` numeric | Non |
| `photos` (1-5 images) | Galerie/caméra vendeur (Step 3) | Supabase Storage bucket `annonces-photos`, path `{user_id}/{annonce_id}/{ts}-{rand}.ext` | **Oui potentiellement** — visages, plaques, documents visibles, EXIF metadata |
| `ville` | Saisie vendeur (Step 4, CityPicker) | `annonces.ville` (clair) | Oui — localisation |
| `quartier` (optionnel) | Saisie vendeur (Step 4) | `annonces.quartier` (clair, nullable) | Oui — localisation fine |
| `pays` | Hérité de `users.pays` par trigger | `annonces.pays` (enum) | Non (2 valeurs CI/CG) |
| `vendeur_id` | `auth.uid()` auto | `annonces.vendeur_id` UUID (FK) | PII par association (lie l'annonce à une identité) |
| `nb_vues` | Incrémenté par RPC fire-and-forget | `annonces.nb_vues` int | Non |

**Profil public vendeur** (RPC `get_user_public_profile`) expose :
- `prenom` + `nom_initial` (ex: "Amadou K.") — PII minimisée
- `avatar_url` — PII (image)
- `ville`, `pays` — localisation
- `note_vendeur`, `nb_ventes` — stats, pas PII
- `created_at` — pas PII directement

**Pas exposé** : `nom` complet, `email`, `telephone`, `quartier` du vendeur — la RPC SECURITY DEFINER fait le filtre colonne-par-colonne.

### 2. But du traitement

- **Annonces** : permettre la mise en relation acheteur/vendeur pour des biens d'occasion — cœur du service marketplace
- **Photos** : permettre à l'acheteur d'évaluer l'état du bien avant rendez-vous physique
- **Localisation (ville/quartier)** : permettre le rendez-vous physique d'échange (modèle main-en-main)
- **Profil public** : instaurer la confiance (prénom, note, ancienneté) sans exposer les coordonnées complètes
- **Nb vues** : métrique vendeur, pas de PII

But **légitime** et **proportionné** : oui — toutes les données servent directement le service. La localisation fine (quartier) est optionnelle.

### 3. Minimisation

- ✅ `quartier` est **optionnel** — seule `ville` est requise
- ✅ Profil public expose `nom_initial` (1ère lettre + ".") au lieu du nom complet
- ✅ `telephone` vendeur **jamais exposé** dans l'annonce ni le profil public — le contact passe par la messagerie in-app (à venir)
- ✅ Photos compressées à 1080px max + JPEG q=0.7 — réduit les détails identifiants involontaires
- ⚠ **EXIF metadata** : `expo-image-manipulator` ré-encode en JPEG (perte EXIF probable mais pas garanti à 100% sur tous les devices). Même TODO que entrée #2 (vérifier stripping effectif)
- ⚠ **Contenu photos** : les CGU interdisent les photos contenant documents d'identité, mais pas de détection automatique. Modération manuelle admin only au MVP. Signalement communautaire prévu S6+

### 4. Stockage & sécurité

| Couche | Mécanisme |
|---|---|
| Transport | TLS 1.3 (Supabase Storage REST + PostgREST) |
| Au repos — photos | Supabase Storage S3 (chiffrement au repos par défaut). **Public read** (toute personne avec l'URL peut voir) |
| Au repos — texte annonce | Postgres clair, RLS gate accès |
| RLS `annonces` | 5 policies : `annonces_read_active` (anon, statut='active' uniquement), `owner_select_own` (vendeur voit ses non-actives), `owner_insert/update/delete` (gate auth.uid() = vendeur_id) |
| RLS `storage.objects` (annonces-photos) | Insert/update/delete gated par `(storage.foldername(name))[1] = auth.uid()::text`. Select public. |
| Profil public | RPC SECURITY DEFINER — pas de RLS publique sur `public.users`, la RPC sélectionne colonne par colonne |
| Cap prix server-side | Check constraint `annonces_prix_cap_par_pays` — pas de PII mais empêche injection de montants hors-plafond |
| Anti-spam | Trigger rate limit 5 annonces/24h — protège contre le spam/scraping |
| Anti-doublon | Trigger `enforce_annonce_no_duplicate` — empêche le spam répétitif |

### 5. Consentement

- ✅ **Checkbox CGU au 1er post** (Step 5) : l'user qui publie sa 1ère annonce doit cocher "J'accepte les conditions générales et la politique de confidentialité" avant de pouvoir publier. Liens tappables vers `/legal/cgu` et `/legal/confidentialite`.
- ✅ **Traçabilité CGU vente** : `users.cgu_sell_accepted_at` (migration 20) enregistre le timestamp serveur d'acceptation via RPC `accept_sell_cgu()` SECURITY DEFINER. Preuve légale : QUI (auth.uid()), QUAND (now() serveur), QUOI (version CGU via `cgu_version`). Idempotent (ne re-écrase pas).
- ✅ Posts suivants : pas de re-confirmation (consentement acquis au 1er post + au signup).
- ✅ **Permissions OS** pour caméra/galerie demandées au moment du pick (Step 3), pas pré-demandées.
- ⚠ **Photos publiques** : l'user est informé par le flow UI que ses photos seront visibles publiquement (l'annonce est par nature publique). Pas de mention explicite "tes photos seront visibles par tous" — ajouter un micro-texte dans Step 3 serait une amélioration.

### 6. Droit à l'oubli

- ✅ **Cascade DB** : `annonces.vendeur_id REFERENCES users(id) ON DELETE CASCADE` → si l'user supprime son compte, toutes ses annonces sont supprimées automatiquement.
- ✅ **Suppression manuelle** : `deleteAnnonce(id)` supprime la row + cascade cleanup des photos Storage (best-effort).
- ⚠ **Photos Storage à la suppression du compte** : la cascade DB supprime les rows `annonces`, mais les fichiers Storage restent (pas de trigger SQL → Storage). Le cron `purge-expired-annonces` nettoie les expirées, mais un delete compte immédiat laisse des photos orphelines.
  - **Mitigation actuelle** : `deleteMyAccount()` dans `lib/supabase.ts` purge le bucket `avatars/` mais **pas** le bucket `annonces-photos/`. → **TODO** : ajouter la purge `annonces-photos/{user_id}/` dans `deleteMyAccount()` avant l'appel RPC.
- ⚠ **Annonces `vendue`** : conservées indéfiniment (FK transactions + rétention fiscale 10 ans CI/CG). À la suppression du compte, il faudra **anonymiser** plutôt que delete (remplacer `vendeur_id` par null, titre/description par "[supprimé]", effacer les photos).

### 7. Rétention

| Donnée | Durée | Mécanisme |
|---|---|---|
| Annonce `active` | 60 jours, puis auto → `expiree` | Cron `expire-annonces` (02:00 UTC daily) |
| Annonce `expiree` | 28 jours supplémentaires (fenêtre prolongation), puis hard delete + purge photos | Cron `purge-expired-annonces` (03:00 UTC daily) → Edge Function `purge-annonces-photos` |
| Annonce `vendue` | **Indéfiniment** (rétention fiscale 10 ans CI/CG, FK transactions) | Pas de purge auto |
| Annonce `suspendue` | Indéfiniment (admin-only) | Pas de purge auto — à revoir si le vendeur supprime son compte |
| Photos Storage | Même lifecycle que l'annonce — purgées par cron ou `deleteAnnonce()` | Cascade cleanup |

**Proportionnalité** :
- 60j + 28j = **88 jours max** pour une annonce non-vendue → proportionné (Leboncoin = 60j, Facebook Marketplace = 30j)
- `vendue` 10 ans : imposé par le code fiscal CI/CG pour les justificatifs de transaction. Justifié.

### 8. Tiers

| Tiers | Données partagées | Localisation | DPA |
|---|---|---|---|
| Supabase | Annonces complètes (texte + photos) | eu-west-3 (Paris) | Existant (cf. entrée #1) |
| PawaPay | **Rien dans ce module** — le téléphone vendeur n'est transmis qu'au moment du payout (module transactions S6-7) | — | TODO entrée #1 |

❌ Les photos annonces ne sont transmises à **aucun** tiers de modération (pas de service OCR/NSFW externe au MVP). Modération manuelle admin-only.

### 9. Accès interne

- **Admin Dominique Huang** : peut voir toutes les annonces (y compris suspendues) via Supabase Dashboard.
- **Aucun autre humain** n'a accès.
- Pas de log d'accès custom sur les annonces. Les Supabase Audit Logs (Pro tier) couvrent les queries admin.

### 10. Plan en cas de breach

- Cf. `docs/incident-response.md`. Procédure inchangée (notification ARTCI/ANRTIC < 72h).
- **Cas spécifique photos** : les photos annonces sont déjà publiques (bucket public read) → un breach Storage n'expose pas de données supplémentaires vs état nominal. Sauf si des users ont posté des photos identifiantes (documents, plaques) malgré les CGU — impact limité car les annonces expirent et sont purgées.
- **Cas spécifique texte** : titre/description/ville/quartier sont publics via `annonces_read_active` RLS → idem, pas de leak supplémentaire.

---

### Fix traçabilité CGU (migration 21 — 2026-04-30)

- ✅ **RPC `accept_auth_cgu(p_version)`** — timestamp serveur pour signup email + OAuth
- ✅ **Trigger `handle_new_user` fixé** — `now()` serveur au lieu de timestamp client
- ✅ **AuthProvider fixé** — `await supabase.rpc()` au lieu de `void supabase.update` (fire-and-forget qui ne s'exécutait pas)
- ✅ **`cgu_version`** — utilise `LEGAL_LAST_UPDATED` depuis `lib/legal.ts` au lieu de "1.0" hardcodé
- ✅ **Backfill users existants** — `cgu_accepted_at = created_at` + version "1.0" pour tous les actifs
- ✅ **Backfill vendeurs existants** — `cgu_sell_accepted_at = min(annonces.created_at)` pour les users avec annonces

## TODOs ouvertes pour la feature #4 (annonces)

- [x] 🔴 **Purge photos à la suppression du compte** — livré 2026-04-29. `deleteMyAccount()` dans `lib/supabase.ts` purge maintenant `annonces-photos/{userId}/` (récursif sous-dossiers) en plus de `avatars/{userId}/`, via helper `purgeUserBucket()`. Abort si échec (pas de PII orphelines).
- [ ] 🟡 **Anonymisation annonces `vendue` à la suppression du compte** : remplacer `vendeur_id` par null, titre/description par "[supprimé]", effacer les photos Storage, conserver `prix`/`created_at` pour rétention fiscale 10 ans.
- [ ] 🟡 **EXIF stripping** : vérifier que `expo-image-manipulator` (compression JPEG) strip bien les EXIF GPS/device sur tous les devices cibles (Tecno Spark, Itel A56, Samsung A series). Si non, ajouter un strip explicite. (Même TODO que entrée #2)
- [ ] 🟡 **Micro-texte Step 3** : ajouter une mention "Tes photos seront visibles publiquement" dans l'écran photos du wizard.
- [ ] 🟢 **Détection contenu sensible** : OCR/NSFW via service tiers (Phase 2) pour bloquer les photos de documents d'identité, armes, etc.
- [ ] 🟢 **Logs d'accès admin** sur les annonces suspendues (traçabilité action modération).

---

## Entrée #5 — Module Messagerie (conversations + messages)

- **Date** : 2026-04-30
- **Feature** : Chat acheteur ↔ vendeur lié à une annonce, messages texte temps réel via Supabase Realtime
- **Branche** : `messagerie`
- **Fichiers concernés** :
  - `docs/migrations/22_conversations_messages.sql` (tables + RLS + RPCs)
  - `docs/migrations/23_users_conversation_read.sql` (RLS lecture participants)
  - `docs/migrations/24_fix_conversations_cascade.sql` (FK CASCADE droit à l'oubli)
  - `lib/messages.ts` (CRUD + Realtime)
  - `app/messages.tsx` + `app/messages/[conversationId].tsx`

### 1. Données collectées

| Donnée | Source | Stockage | PII ? |
|---|---|---|---|
| `contenu` (1-2000 chars) | Saisie user (chat) | `messages.contenu` (clair) | **Oui** — peut contenir nom, adresse, téléphone, etc. |
| `expediteur_id` | `auth.uid()` auto | `messages.expediteur_id` UUID (FK) | PII par association |
| `conversation_id` | Auto (get_or_create) | `messages.conversation_id` UUID (FK) | Non directement |
| `is_read` | Auto (mark_messages_read) | `messages.is_read` boolean | Non |
| `last_message_preview` | Trigger DB (100 premiers chars) | `conversations.last_message_preview` (clair) | **Oui** — extrait du contenu |

### 2. But du traitement

- **Communication** : permettre la coordination acheteur/vendeur pour le rendez-vous physique d'échange (escrow main-en-main)
- **Preuve en cas de litige** : les messages sont conservés comme preuve (`is_deleted` soft-delete, pas hard-delete)

But **légitime** et **proportionné** : oui — la messagerie est le canal exclusif de coordination entre parties.

### 3. Minimisation

- ✅ Texte uniquement MVP (pas d'images/fichiers)
- ✅ `last_message_preview` limité à 100 chars (trigger DB)
- ✅ Pas de métadonnées collectées (IP, device, géoloc)
- ⚠ Le contenu des messages peut contenir des PII non-structurées (téléphone, adresse) — les CGU interdisent le partage de coordonnées hors plateforme mais pas de détection automatique

### 4. Stockage & sécurité

| Couche | Mécanisme |
|---|---|
| Transport | TLS 1.3 (Supabase REST + Realtime WebSocket) |
| Au repos | Postgres clair (pas de chiffrement message par message — proportionné MVP) |
| RLS `messages` | 3 policies : SELECT/INSERT/UPDATE — uniquement les participants de la conversation |
| RLS `conversations` | 3 policies : SELECT/INSERT/UPDATE — acheteur ou vendeur seulement |
| RPC `get_or_create_conversation` | SECURITY DEFINER — vendeur déduit de l'annonce, anti-self-messaging |
| RPC `mark_messages_read` | SECURITY DEFINER — gate participant |
| Realtime | Filtré par RLS — un user ne reçoit que les events de ses conversations |

### 5. Consentement

- ✅ Auth gate sur `/messages` — l'user doit être connecté (CGU acceptées au signup)
- ✅ Auth gate sur "Contacter" — `requireAuth("contact")` ouvre AuthGate si anonyme
- ✅ Le consentement auth (CGU signup) couvre la messagerie (mentionné dans les CGU)

### 6. Droit à l'oubli

- ✅ **FK CASCADE** (migration 24) : suppression du compte → cascade `users` → `conversations` → `messages`
- ✅ `conversations.acheteur_id` + `vendeur_id` → ON DELETE CASCADE
- ✅ `messages.expediteur_id` → ON DELETE CASCADE
- ✅ **v4.0** : plus de module transactions/litiges — la cascade delete est directe et sans exception.

### 7. Rétention

| Donnée | Durée | Mécanisme |
|---|---|---|
| Messages (conversation active) | Indéfinie tant que l'annonce existe | — |
| Messages (annonce supprimée/expirée) | Cascade : annonce DELETE → conversations CASCADE → messages CASCADE | Crons annonces (migration 16) |
| Messages (compte supprimé) | Immédiat CASCADE | FK ON DELETE CASCADE (migration 24) |

### 8. Tiers

- **Aucun nouveau tiers**. Tout reste dans Supabase (DB + Realtime).
- Les messages ne transitent PAS par un service de messagerie externe.
- Supabase Realtime utilise WebSocket (pas de stockage intermédiaire — les events sont éphémères).

### 9. Accès interne

- **Admin Dominique Huang** : peut lire tous les messages via Supabase Dashboard (utile pour modération litiges).
- Pas de log d'accès custom sur les messages.

### 10. Plan en cas de breach

- Cf. `docs/incident-response.md`. Procédure inchangée.
- **Cas spécifique messages** : les messages peuvent contenir des PII non-structurées (numéros, adresses partagés par les users). Impact potentiellement plus élevé que les annonces (données publiques). Notification ARTCI/ANRTIC < 72h obligatoire.

---

## TODOs ouvertes pour la feature #5 (messagerie)

- [x] 🔴 **FK CASCADE** sur conversations.acheteur_id/vendeur_id + messages.expediteur_id (migration 24)
- [ ] 🟡 **Anonymisation litiges** : si litige ouvert au moment du delete compte, anonymiser les messages au lieu de les supprimer (preuve conservée)
- [ ] 🟡 **Rate limit messages** : anti-spam max 30 messages/minute/user (trigger DB)
- [ ] 🟢 **Chiffrement E2E messages** : Phase 2 — chiffrement côté client avec clés échangées via Diffie-Hellman
- [ ] 🟢 **Suppression sélective** : l'user peut supprimer un message spécifique (soft-delete `is_deleted = true`)

---

## Entrée #6 — F06 Notation post-RDV (table `avis`)

- **Date** : 2026-05-07
- **Feature** : F06 notation après RDV physique (1-5 étoiles + commentaire libre, auto 3/5 si pas de réponse en 7j)
- **Branche** : `notation` → mergée `develop`
- **Fichiers concernés** :
  - `app/messages/[conversationId].tsx` (CTA "Noter ce vendeur/acheteur")
  - `components/ui/RatingModal.tsx`
  - `docs/migrations/37_avis.sql`
  - `docs/migrations/38_notation_fixes.sql`
  - `docs/migrations/42_avis_insert_symmetry.sql`
  - `docs/migrations/70_fix_avis_fk_for_account_delete.sql` (RGPD droit à l'oubli)

### 1-3. Données / But / Minimisation

| Donnée | Source | Stockage | Usage |
|---|---|---|---|
| `note` (1-5) | Saisie user post-RDV | `avis.note int` | Calcul `note_vendeur`/`note_acheteur` agrégée |
| `commentaire` (texte libre) | Saisie user, optionnel | `avis.commentaire text` | Affiché sur profil public |
| `auteur_id`, `cible_id` | Auto (auth.uid + autre participant) | `avis.auteur_id/cible_id` | Anti-doublon + display |
| `conversation_id` | Auto (RDV de référence) | `avis.conversation_id` | Lien vers le RDV source |

But : confiance plateforme (4 piliers v4.0). Minimisation : pas d'autres données collectées (pas de photo du produit, pas de transcript, etc.).

### 4. Stockage & sécurité

- RLS `avis_select_public` : tout user authentifié peut lire les avis (affichage profil). Cohérent avec un système de réputation public.
- Insert : `auteur_id = auth.uid()` + check qu'un RDV `confirme_at IS NOT NULL` existe sur `conversation_id` avec auteur participant + cible = autre participant (mig 37).
- Update : impossible (avis = immuable post-publication, conformément au CDC §confiance). Soft-delete admin via RPC `admin_delete_avis` (mig 57) si signalé contenu inapproprié.
- Auto 3/5 : trigger pg_cron 1×/jour balaye les RDV passés depuis 7j sans avis et insère 3/5 silencieux (mig 38).

### 5. Consentement

- Implicite : la fiche RDV affiche que la notation aura lieu post-rencontre (informations CGU §F06).
- Pas de checkbox dédié — c'est une obligation contractuelle pour participer à la confiance plateforme.

### 6. Droit à l'oubli

- ✅ **Mig 70** : `avis.auteur_id` → `on delete set null` + `cible_id` → `on delete cascade`. Quand un user supprime son compte :
  - Les avis qu'il a écrits restent visibles (auteur anonymisé `null` → "Utilisateur supprimé") — preserve la réputation des autres.
  - Les avis dont il était cible disparaissent (la réputation s'efface avec le compte).
- Cohérent avec le principe européen "préserver les données légitimes des autres" (les autres ont écrit ces avis de bonne foi).

### 7. Rétention

- Avis conservés tant que la cible a un compte actif. Auto-purge via cascade au delete compte cible.
- Pas de purge temporelle automatique (la réputation est cumulative).

### 8. Tiers — 9. Accès interne — 10. Breach

- Aucun tiers. Lecture admin via Dashboard (modération signalements).
- Breach : impact faible (note 1-5 + commentaire ≤ 500 chars). Pas de PII directe, sauf si user partage un numéro dans `commentaire` (filtre `content_filter` mig 29 bloque les patterns PII).

---

## Entrée #7 — F07 Vérification d'identité (KYC CNI + Selfie)

- **Date** : 2026-05-07
- **Feature** : F07 vérification d'identité via CNI recto/verso + selfie, paiement 1000 FCFA, validation admin manuelle
- **Branche** : `verif` → mergée `develop`
- **Fichiers concernés** :
  - `app/profile/verification/*` (wizard 5 steps)
  - `landing/src/app/admin/(admin-protected)/verifications/*` (admin web)
  - `docs/migrations/45_verifications_identite.sql`
  - `docs/migrations/46_storage_cni_verifications.sql`
  - `docs/migrations/47_kyc_consent_tracking.sql`
  - `docs/migrations/48_users_select_update_own_cni.sql`
  - `docs/migrations/54_purge_kyc_storage.sql`
  - `docs/migrations/55_consent_version_v1_1.sql`
  - `docs/migrations/72_fix_verif_check_for_admin_delete.sql`
  - `docs/migrations/73_fix_storage_delete_owner.sql`
  - `docs/migrations/75_purge_kyc_pending_orphans.sql`

### 1-3. Données / But / Minimisation

⚠ **C'est la feature la plus sensible RGPD du MVP** (catégorie "donnée d'identité officielle" + biométrie).

| Donnée | Source | Stockage | Usage |
|---|---|---|---|
| Photo CNI recto | Upload user | `cni-verifications/<userId>/cni-recto-*.jpg` (Storage privé) | Validation admin manuelle |
| Photo CNI verso | Upload user | `cni-verifications/<userId>/cni-verso-*.jpg` | Validation admin manuelle |
| Selfie | Upload user (camera ou library) | `cni-verifications/<userId>/selfie-*.jpg` | Match avec CNI par admin |
| `rgpd_consent_at` + `rgpd_consent_version` | Auto au submit | `verifications_identite.rgpd_consent_*` | Traçabilité consentement éclairé |
| `statut` | `pending`/`verified`/`rejected` | `verifications_identite.statut` | Gating publication >3 annonces + badge |
| `reject_reason` | Saisie admin si refus | `verifications_identite.reject_reason` | Communiqué à l'user via email Resend |

But légitime : vérifier que le vendeur est une personne physique réelle (anti-fraude), gating publication >3 annonces (lutte anti-spam), badge "Vendeur vérifié" (confiance).

Minimisation : on conserve les **photos** mais pas le **numéro de CNI** ni la date de naissance (l'admin lit visuellement, ne ressaisit pas). Pas de OCR automatique.

### 4. Stockage & sécurité

- **Bucket Storage `cni-verifications`** : privé, RLS strictes :
  - User : SELECT/INSERT/DELETE uniquement sur son propre dossier `<userId>/*` (mig 48 + mig 73).
  - Admin : SELECT via signed URL TTL=60s côté admin web (jamais d'URL publique).
  - Trigger BEFORE DELETE sur `verifications_identite` (mig 54) : purge automatique des objets Storage liés via `storage.protect_delete()` bypass.
- **Table `verifications_identite`** : RLS `verif_select_own` + `verif_select_admin`. Admin update via RPC `admin_validate_verification` (SECURITY DEFINER, gate `is_admin`).
- **Signed URLs admin** : TTL 60 secondes (config `SIGNED_URL_TTL` dans `verifications/[id]/page.tsx`). L'URL leakée à un tiers expire vite.

### 5. Consentement

- ✅ **Page Intro KYC** explicitement consent : "J'accepte que Niqo conserve mes pièces d'identité jusqu'à 30 jours après refus / 6 mois après validation pour audits réglementaires" (cf. `app/profile/verification/intro.tsx` checkbox).
- ✅ Versioning consent : `rgpd_consent_version v1.0` puis `v1.1` (mig 55) — whitelist explicite côté RPC `submit_verification`.
- ✅ Lien vers Politique de confidentialité (`niqo.africa/legal/confidentialite`) qui détaille la finalité KYC.

### 6. Droit à l'oubli

- ✅ Compte supprimé → cascade `verifications_identite` (FK CASCADE mig 45) → trigger BEFORE DELETE purge Storage (mig 54).
- ✅ Mig 73 : DELETE owner policy permet aussi la purge côté client avant RPC `delete_my_account` (defense-in-depth — `lib/supabase.ts > deleteMyAccount` purge le bucket d'abord).
- ✅ Mig 72 : check `verif_reviewed_needs_admin` relâché à `reviewed_at IS NOT NULL` pour permettre `reviewed_by → SET NULL` quand l'admin supprime son propre compte sans bloquer.

### 7. Rétention

| Statut | Rétention | Cron |
|---|---|---|
| `rejected` | 30 jours après `reviewed_at` | `purge_expired_kyc_verifications` (mig 54+75) |
| `verified` | 6 mois après `reviewed_at` | idem |
| `pending` orphelin | 60 jours après `created_at` (mig 75) | idem |

Justification : durée minimale pour audits réglementaires anti-fraude tout en respectant la promesse RGPD du consent.

### 8. Tiers

- ✅ Aucun tiers ne reçoit les CNI (pas de KYC SaaS type Onfido/Veriff). Validation 100% manuelle interne (Dominique).
- Email post-validation/refus envoyé via **Resend** (`landing/src/lib/email/verification-result.ts`) : ne contient PAS de photo, juste le statut + raison de refus si applicable.

### 9. Accès interne

- Admin Dominique Huang uniquement (gate `users.is_admin = true` mig 44).
- Pas de log d'accès custom — Supabase Storage logs les signed URL access (Dashboard → Storage → Logs).
- ⚠ Admin web : logs PII supprimés (mig review #2 — actions.ts + page.tsx, plus de `console.log` user data en production).

### 10. Plan breach

- Cf. `docs/incident-response.md`.
- Cas spécifique CNI : si breach, **notification ARTCI/ANRTIC < 72h obligatoire** + **information directe des users impactés** par email + procédure de réémission CNI à leurs frais (cas extrême).
- Mitigation : bucket privé + signed URL 60s + RLS strictes + purge auto.

---

## Entrée #8 — F08 Signalements (modération)

- **Date** : 2026-05-07
- **Feature** : F08 signaler annonce/user/message + back-office admin (validation/rejet) + auto-suspension à `score_abus ≥ 3`
- **Branche** : `develop` (jamais isolée)
- **Fichiers concernés** :
  - `components/ui/ReportButton.tsx`, `components/ui/ReportModal.tsx`
  - `landing/src/app/admin/(admin-protected)/signalements/*`
  - `docs/migrations/25_signalements.sql` → `28_auto_suspend_on_score.sql`
  - `docs/migrations/56_admin_signalements_moderation.sql`
  - `docs/migrations/77_review2_finalize.sql` (E — trigger étendu à `is_active`)

### 1-3. Données / But / Minimisation

| Donnée | Source | Stockage |
|---|---|---|
| `signaleur_id` | auth.uid() | `signalements.signaleur_id` (FK users) |
| `cible_id` (annonce / user / message) | Saisie | `signalements.cible_id uuid` + `cible_type enum` |
| `motif` | Enum (spam/arnaque/insulte/contenu-illegal/autre) | `signalements.motif` |
| `description` | Texte libre 0-500 chars | `signalements.description` (clair) |
| `statut` | Enum pending/traite/rejete | `signalements.statut` |

But : modération communautaire (4 piliers de confiance). Auto-suspend permet de réagir rapidement à un user malveillant sans intervention admin manuelle.

### 4. Stockage & sécurité

- RLS : `signalements_select_admin` (admin) + `signalements_select_own` (signaleur) → un user voit uniquement ses propres signalements + l'admin voit tout. Cible **ne voit pas** les signalements contre elle (anti-représailles).
- Auto-suspension : trigger `tg_check_score_abus` (mig 28 + mig 77 étendu à update of is_active) → set `users.is_active = false` automatiquement.
- Mig 74 : RLS INSERT sur `signalements` exige `is_my_account_active()` → un user suspendu ne peut plus signaler en représailles.

### 5. Consentement

- Implicite (signaler = action volontaire).

### 6. Droit à l'oubli

- ⚠ Compte supprimé : les signalements qu'il a faits restent (modération anti-fraude légitime). FK `signaleur_id` → `set null` à terme (à valider avec mig dédiée Phase 2).
- Cible supprimée : les signalements la concernant deviennent orphelins (cible_id → null si on étend mig 70 pattern à signalements). Pour MVP, FK CASCADE sur cible_id annonce uniquement.

### 7. Rétention

- Signalements `rejete` : conservés 30j puis purge auto (à implémenter mig dédiée — pas encore en place).
- Signalements `traite` : conservés indéfiniment (preuve modération + audit).

### 8-10.

- Aucun tiers. Admin Dominique seul. Breach impact = lecture motifs/descriptions (low PII).

---

## Entrée #9 — F09 Boost annonces (paiements PawaPay)

- **Date** : 2026-05-07
- **Feature** : F09 boost 7j (1000 FCFA) ou 30j (3000 FCFA) sur une annonce, paiement Mobile Money PawaPay
- **Branche** : `develop`
- **Fichiers concernés** :
  - `app/announce/[id]/boost.tsx`
  - `supabase/functions/pawapay-init-deposit/`, `supabase/functions/pawapay-webhook/`
  - `docs/migrations/43_paiements_niqo.sql`
  - `docs/migrations/60_boost_annonces.sql` → `63_boost_security_hardening.sql`
  - `docs/migrations/77_review2_finalize.sql` (D — scrub pawapay_metadata phone)

### 1-3. Données / But / Minimisation

| Donnée | Source | Stockage |
|---|---|---|
| `pawapay_deposit_id` | API PawaPay (UUID v4) | `paiements_niqo.pawapay_deposit_id` |
| `montant_fcfa`, `currency` | Calculé selon plan | `paiements_niqo.montant_fcfa/currency` |
| `pawapay_metadata` | Webhook PawaPay payload | `paiements_niqo.pawapay_metadata jsonb` |
| `phone_number` payeur (Mobile Money) | Saisie user / lu depuis Vault `users.telephone` | **PAS persisté en clair** : envoyé à PawaPay API uniquement, jamais stocké ailleurs |

But : monétisation Niqo via boosts vendeurs (modèle hors transaction v4.0).

### 4. Stockage & sécurité

- RLS `paiements_select_own` + `paiements_select_admin`. Insert via RPC SECURITY DEFINER `init_boost_payment` (mig 60).
- ⚠ **Mig 77** : trigger `tg_scrub_pawapay_metadata` BEFORE INSERT/UPDATE qui scrub :
  - `payer.accountDetails.phoneNumber` → `[redacted]`
  - `payee.accountDetails.phoneNumber` → `[redacted]`
  - Tout `metadata[].fieldName` matchant `phone|telephone|msisdn` → fieldValue `[redacted]`
  - Backfill des rows existantes (idempotent).
- Webhook PawaPay : double-check via API GET `/v2/deposits/{id}` (Option B, mig review). Évite forge de webhook par attaquant.

### 5. Consentement

- Implicite : action de paiement volontaire après lecture du tarif. Page boost affiche le tarif clair avant submit.
- CGU §F09 informe que les paiements transitent par PawaPay (sous-traitant payment processor agréé BCEAO).

### 6. Droit à l'oubli

- Compte supprimé → ⚠ paiements **conservés** (preuve comptable, obligation Rwanda 2021-058 et fiscalité). FK `paiements_niqo.user_id` à passer en `set null` Phase 2 quand on aura confirmation expert-comptable.
- Aujourd'hui : FK CASCADE → paiements supprimés en même temps que le compte. ⚠ À revoir.

### 7. Rétention

- Indéfinie (preuve comptable). À cadrer avec expert-comptable Phase 2.

### 8. Tiers

- ✅ **PawaPay** (Mauritius) : sous-traitant paiement déclaré CGU. Reçoit `phone_number` + `montant` à chaque init-deposit.
- ✅ Données échangées via TLS 1.3 + signature ECDSA P-256 (RFC-9421 — implem complète Phase 2, MVP utilise Option B double-check API).

### 9. Accès interne

- Admin (Dominique) lit `paiements_niqo` via dashboard. PII phone scrubed (mig 77). Logs admin web : `console.log` payment data supprimés en prod (review #2).

### 10. Breach

- Impact = lecture `paiements_niqo` → montants + dates + user_id. Pas de PII phone (scrub mig 77). Pas de carte bancaire (Mobile Money via PawaPay seulement).
- Notification ARTCI/ANRTIC < 72h si > 100 rows.

---

## Entrée #10 — F10 Push notifications

- **Date** : 2026-05-07
- **Feature** : F10 notifications push Expo (10 events business : nouveau message, RDV proposé/confirmé/annulé, notation reçue, signalement validé, boost expiré, KYC validé/refusé)
- **Branche** : `develop`
- **Fichiers concernés** :
  - `lib/push.ts`, `app/_layout.tsx` (registration)
  - `supabase/functions/send-push-notification/index.ts`
  - `docs/migrations/64_push_tokens.sql`
  - `docs/migrations/65_push_notification_triggers.sql`
  - `docs/migrations/66_push_rdv_proposed.sql`
  - `docs/migrations/67_push_critical_events.sql`
  - `docs/migrations/68_push_quality_fixes.sql`
  - `docs/migrations/77_review2_finalize.sql` (F — Vault rename push_internal_key)

### 1-3. Données / But / Minimisation

| Donnée | Source | Stockage |
|---|---|---|
| `token` Expo Push | Auto au login (`expo-notifications`) | `push_tokens.token` (clair, identifiant device) |
| `platform` | Auto (`ios`/`android`/`web`) | `push_tokens.platform` |
| `last_used_at` | Auto | `push_tokens.last_used_at` |

But : notifier l'user d'événements critiques sans qu'il ait à ouvrir l'app. Réduit le délai de réponse RDV / messages → améliore la confiance plateforme.

Minimisation : pas de `device_id`, pas de `model`, pas d'IP. Le token Expo permet uniquement de pousser une notif, pas d'identifier le device hardware.

### 4. Stockage & sécurité

- RLS `push_tokens_own` : user ne lit/insert/delete que ses propres tokens.
- Edge Function `send-push-notification` : auth via `NIQO_INTERNAL_KEY` (32 bytes hex, custom — pas le service_role JWT car gateway Supabase réécrit headers via pg_net). Mig 77 renomme l'entry Vault de `service_role_key` → `push_internal_key` pour clarté (l'ancien nom reste en fallback transition).
- ⚠ **Mig 77 / G** : comparaison `constantTimeEquals` côté EF pour éviter timing attacks sur le secret partagé.
- Cron `purge_stale_push_tokens` (mig 68) : purge tokens `last_used_at < now() - 90 days` (devices probablement abandonnés).

### 5. Consentement

- Permission OS native demandée à la 1ère ouverture post-login (`Notifications.requestPermissionsAsync`). User peut refuser → app fonctionne sans push.
- Pas de pre-check, pas de manipulation du dialog OS.

### 6. Droit à l'oubli

- Compte supprimé → cascade `push_tokens` (FK CASCADE mig 64).
- User opt-out OS → token reste mais Expo retourne `DeviceNotRegistered` au prochain push → EF purge auto (mig 67 — `deadTokens` cleanup).

### 7. Rétention

- 90 jours d'inactivité (cron `purge_stale_push_tokens`). Les tokens expirent côté Expo de toute façon ~6 mois après la dernière mise à jour de l'app.

### 8. Tiers

- ✅ **Expo Push API** (USA) : transit obligatoire pour atteindre APNs (Apple) et FCM (Google). Niqo n'a pas de relation directe Apple/Google côté push pour l'instant (FCM Phase 2 prod Android).
- ✅ Données envoyées : `token` Expo + `title` + `body` + `data` (route, conv_id, annonce_id) — payload minimal. Pas de PII directe dans les notifs (anonymise les noms : "Tu as un nouveau message" et pas "Marie t'a écrit").

### 9. Accès interne

- Admin n'accède pas au `token` (pas d'usage).
- Logs EF : pas de PII (juste `user_ids_count`, `tokens_count`, `ok`/`errors`/`purged`).

### 10. Breach

- Impact = leak liste de tokens Expo → un attaquant pourrait pousser des notifs spam aux users (tant que les tokens sont valides). Pas de PII directe.
- Mitigation : si breach détecté, rotate `NIQO_INTERNAL_KEY` (Vault + EF Secret) + purger `push_tokens` table → tous les devices se ré-enregistreront au prochain login.

---

## Entrée #11 — Modération automatique d'images (AWS Rekognition)

> **Feature** : Edge Function `moderate-image` qui scan chaque photo d'annonce via AWS Rekognition `DetectModerationLabels` AVANT publication.
>
> **Statut** : ✅ implémentée 2026-05-12. Tier RGPD : 🟡 **P1** (transfert d'image binaire vers un tiers AWS hors entité Niqo).

### 1. Données traitées

- **Binaire image** (JPEG / PNG / WebP, compressé client-side à 1024 px max ≈ 100-500 KB) envoyé en base64 dans le body de l'Edge Function puis transmis à AWS Rekognition dans la région `eu-west-1` (Irlande).
- Pas de stockage côté Niqo (l'image n'est pas écrite sur disque dans l'Edge Function — `Uint8Array` en RAM).
- Pas de stockage côté AWS : Rekognition `DetectModerationLabels` est **stateless** (AWS documentation : "Rekognition does not store the images sent in API calls"). Le seul stockage AWS éventuel est dans les logs d'erreur CloudWatch internes AWS si l'API throw, et ces logs ne contiennent pas le binaire.

### 2. But du traitement

- Empêcher la publication d'annonces avec des photos NSFW / violentes / drogues / symboles haineux — protection des autres utilisateurs (browse-first, photos visibles sans compte).
- Conformité avec la responsabilité éditoriale de plateforme C2C (loi 2024-30 CI, 2023-15 CG, 2021-058 RW).

### 3. Minimisation

- Resize côté mobile à 1024 px max (au lieu de 4032 px natif) → bandwidth ×10 plus bas + coût AWS identique (per-image, pas per-pixel).
- JPEG quality 0.75 (au lieu de l'original 100%) → fichier ~3-5× plus petit.
- Aucun metadata EXIF transmis (`expo-image-manipulator` strip les EXIF lors du `saveAsync`). Conséquence : pas de leak géoloc, pas de leak modèle de téléphone.
- Pas de feed des images vers un modèle d'entraînement AWS (Rekognition est pré-trained, pas de feedback loop par défaut).

### 4. Stockage & sécurité

- **Pendant l'appel** : transit chiffré TLS 1.3 entre l'Edge Function Supabase et AWS Rekognition `rekognition.eu-west-1.amazonaws.com`.
- **Après l'appel** : aucun stockage. Les images qui **passent** la modération suivent ensuite le pipeline normal (`lib/storage/annonces-photos.ts` → bucket `annonces-photos` chiffré-at-rest par Supabase). Les images **rejetées** ne sont jamais uploadées.
- **Logs** : `niqo_event_log` `moderation.image.*` stocke `image_bytes` (taille en bytes, pas le binaire), `labels` (labels Rekognition top-level), `user_id`. Aucun preview / thumbnail / hash de l'image.
- **Credentials AWS** : `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` stockés dans Supabase Edge Functions Secrets (chiffrés-at-rest par Supabase Vault). IAM user `niqo-rekognition` dédié, policy `AmazonRekognitionReadOnlyAccess` uniquement (ne peut RIEN écrire sur AWS).

### 5. Consentement

- CGU v1.1 §«Modération automatique» (à valider lors de la prochaine itération du pack légal — TODO **avant launch public**) couvre l'envoi des photos à un sous-traitant tiers (AWS) pour modération automatique.
- L'utilisateur peut refuser la création d'annonce en ne consentant pas — pas de fallback "publish sans scan" (la modération est obligatoire).

### 6. Droit à l'oubli

- Pas de donnée à oublier côté AWS (stateless).
- Suppression du compte (RGPD) → cascade delete des annonces + photos Storage (déjà couvert par entrée #4 Annonces). Aucun nettoyage AWS nécessaire.

### 7. Rétention

- **AWS** : aucune (stateless).
- **Niqo `niqo_event_log`** : 90 jours par défaut (mig 106 default rétention) → les events `moderation.image.*` (taille + labels + user_id) sont purgés automatiquement.
- **Niqo Storage** : retention normale annonces (60j auto-expiration cf. F11).

### 8. Tiers

- **AWS Rekognition** (Amazon Web Services EMEA SARL, Luxembourg) — sous-traitant au sens RGPD article 28.
- **Data Processing Agreement (DPA) AWS** : signature à effectuer côté Niqo (entité Rwanda → AWS) avant launch public. AWS fournit un DPA standard téléchargeable depuis AWS Artifact. Couvre les transferts intra-UE.
- **Région** : `eu-west-1` (Irlande, UE) — pas de transfert vers les US.

### 9. Accès interne

- Aucun accès humain au binaire (l'image n'est jamais persistée hors du flux Edge Function → AWS → response).
- L'admin (`/admin/observability`) peut consulter les **counts** de `moderation.image.flagged` / `critical_hate` mais pas les images elles-mêmes.
- Sur `moderation.image.critical_hate` (Hate Symbols), l'event log contient `label` + `all_labels` + `user_id` — l'admin peut identifier le user pour suspension manuelle, mais ne voit jamais l'image.

### 10. Plan en cas de breach

- **Scénario réaliste** : leak des credentials AWS `niqo-rekognition` (fuite de Supabase Secrets ou du `supabase/.env` dev).
  - Impact : un attaquant peut appeler Rekognition contre des images quelconques en consommant le free tier Niqo, puis facturer Niqo au-delà.
  - Mitigation : la policy IAM ne donne accès qu'à Rekognition read-only — l'attaquant ne peut pas accéder à S3, EC2, RDS, etc.
  - Rotation : régénérer la access key dans IAM Console → update les 2 secrets Supabase (`supabase secrets set ...`) → redéployer l'EF.
- **Scénario théorique** : breach Niqo → un attaquant intercepte le base64 d'une image en transit (impossible si TLS non-cassé, vérifié par les bibliothèques AWS SDK).
  - Mitigation : TLS pinning niveau Deno runtime + AWS SDK ; pas de mitigation supplémentaire nécessaire.

### TODOs ouvertes pour cette feature (#11)

- [ ] **Avant launch public** : ajouter clause «Modération automatique d'images» dans CGU v1.2 (mention sous-traitant AWS Rekognition + région UE).
- [ ] **Avant launch public** : signer le DPA AWS (téléchargeable AWS Artifact) côté entité Rwanda.
- [ ] **Phase 2 monitoring** : après 1-2 mois prod, retuner `MIN_CONFIDENCE` (actuellement 75) selon le taux de false positives observé via signalements vendeurs.

---

## Entrée #12 — Modération automatique de messagerie (OpenAI Moderation API)

> **Feature** : Edge Function `moderate-message` qui scanne chaque message texte chat via OpenAI Moderation API APRÈS son insertion (async, fire-and-forget via trigger DB pg_net). Si flagged → crée auto un signalement attribué au user système Niqo Auto-Modération (mig 119).
>
> **Statut** : ✅ implémentée 2026-05-12. Tier RGPD : 🟠 **P1** (transfert de **contenu de conversation privée** à un sous-traitant US — OpenAI San Francisco — plus sensible que l'entrée #11 images qui restent en UE).

### 1. Données traitées

- **Texte du message** (max 4000 chars envoyés, tronqué côté EF si plus long) transmis à OpenAI Moderation API.
- **Contexte transmis** : SEUL le contenu du message. Pas d'identifiant utilisateur, pas de prénom, pas d'historique conversation, pas de phone/email. OpenAI reçoit une string opaque + un model name.
- **Filtre côté trigger DB** : seuls les messages `type='texte'` de users humains (`expediteur_id <> system_user_uuid`) sont scannés. Les messages **système** (`type='systeme'` — confirmations RDV qui contiennent les **prénoms** et **lieux de RDV**) sont explicitement EXCLUS pour éviter la fuite de PII vers OpenAI. Les messages **image** (`type='image'`) ne sont pas scannés non plus (l'URL Storage est opaque côté OpenAI mais ne fournit pas de valeur de modération).

### 2. But du traitement

- Détection automatique de harcèlement, menaces, propos haineux, contenu sexuel envoyés en messagerie privée.
- Cascade existante : si flagged → signalement auto → admin valide → cascade `score_abus++` → auto-suspend à 3 confirmés/30j (cf. F08).
- Complète la couche 1 substring DB (`mots_interdits` mig 29) qui ne couvre que les patterns canoniques connus à l'avance.

### 3. Minimisation

- **Slice 4000 chars** avant envoi : un long message est tronqué (les premiers chars suffisent pour la classification — OpenAI Moderation est entraîné sur ce format).
- **Pas d'enrichissement** : aucun metadata (timestamp, conversation_id, annonce_id, vendeur_id) envoyé à OpenAI.
- **Modèle `omni-moderation-latest`** : un seul modèle de classification, pas de feed vers un modèle d'entraînement (la clause API standard OpenAI 2024-12 garantit zero retention sur les endpoints `/v1/moderations`).

### 4. Stockage & sécurité

- **Pendant l'appel** : transit chiffré TLS 1.3 entre l'Edge Function Supabase et `https://api.openai.com/v1/moderations`.
- **Après l'appel côté OpenAI** : zero retention (clause API standard 2024-12 pour les endpoints Moderation — confirmé sur le compte API Niqo). OpenAI ne stocke pas les inputs au-delà du traitement temps réel.
- **Logs Niqo** : `niqo_event_log` `moderation.message.*` stocke `message_id`, `text_length`, `categories`. **Aucun preview du contenu n'est stocké** (à la différence de `moderation.critical_minors` côté annonces qui logue 100 chars). Justification : la conversation chat est intrinsèquement plus privée qu'une annonce publique, on ne veut pas l'exposer même 100 chars dans un log.
- **Signalement auto** : si flagged, l'INSERT signalement contient `description` avec un preview du message (800 chars). Ce preview est visible UNIQUEMENT par les admins via `/admin/signalements` (RLS strict). Justification : l'admin doit pouvoir évaluer la légitimité du signalement avant de le passer à `'traite'`, ce qui suspend le compte.
- **Credentials OpenAI** : `OPENAI_API_KEY` dans Supabase Edge Functions Secrets (chiffrés-at-rest). Compte API Niqo dédié avec budget mensuel cappé. Sanitization des messages d'erreur (`<REDACTED_OAI_KEY>` pattern) pour ne pas leaker en cas d'incident.
- **Auth EF** : `NIQO_INTERNAL_KEY` shared secret entre pg_net trigger et l'EF (constant-time match anti-timing-attack). Gateway `verify_jwt=false` car le caller est un trigger DB, pas un user JWT.

### 5. Consentement

- CGU v1.2 §«Modération automatique de messagerie» (à valider lors de la prochaine itération du pack légal — TODO **avant launch public**) doit mentionner :
  - Sous-traitant OpenAI (US, San Francisco).
  - Transfert hors UE : clauses contractuelles types (Standard Contractual Clauses) + DPA OpenAI.
  - Zero retention sur les endpoints Moderation.
- L'utilisateur ne peut PAS opt-out de la modération (politique éditoriale plateforme). Mais il peut supprimer son message dans les minutes qui suivent (cf. F04 messagerie — soft delete `is_deleted`), auquel cas le signalement éventuel reste visible côté admin mais le contenu est masqué côté UI.

### 6. Droit à l'oubli

- Pas de donnée à oublier côté OpenAI (zero retention).
- Suppression du compte (RGPD) → cascade DB supprime les messages → les signalements auto correspondants ont `target_id` qui pointe vers un message inexistant. Le back-office admin gère le cas gracieusement (preview "[message supprimé]"). Aucun appel API OpenAI nécessaire pour le right-to-be-forgotten.
- Le user système Niqo Auto-Modération reste persistant (UUID `00000000-0000-0000-0000-000000000001`) — il n'est jamais supprimé par cascade utilisateur.

### 7. Rétention

- **OpenAI** : zero retention.
- **Niqo `niqo_event_log`** : 90 jours (mig 106 default).
- **Niqo `signalements`** : pas de purge automatique des signalements traités (historique nécessaire pour le calcul `score_abus` 30j glissant). À auditer avant launch si on veut une politique de rétention explicite.
- **Niqo `messages`** : pas de purge automatique en MVP. À évaluer post-launch (rétention 1 an proposé).

### 8. Tiers

- **OpenAI, L.L.C.** (3180 18th Street, San Francisco, CA 94110, USA) — sous-traitant au sens RGPD article 28.
- **DPA OpenAI** : à signer côté entité Rwanda (https://openai.com/policies/data-processing-addendum) avant launch public. Couvre les transferts UE → US via Standard Contractual Clauses.
- **Zero retention API agreement** : la clause par défaut sur les endpoints Moderation (cf. https://platform.openai.com/docs/models/how-we-use-your-data). Niqo n'a pas opt-in pour le feedback dataset.
- **Pas de transfert vers d'autres tiers** : la réponse OpenAI revient directement à l'EF qui logue uniquement les catégories.

### 9. Accès interne

- Aucun accès humain au contenu via OpenAI (zero retention).
- L'admin (`/admin/signalements`) peut consulter le preview 800 chars dans le champ `description` du signalement auto, pour évaluer s'il est justifié avant de passer à `'traite'`. Ce preview vient de la DB Niqo (table `signalements`), pas d'OpenAI.
- L'admin (`/admin/observability`) voit les **counts** par catégorie (`moderation.message.flagged` etc.) mais pas les contenus.

### 10. Plan en cas de breach

- **Scénario réaliste** : leak de `OPENAI_API_KEY` (fuite Supabase Secrets ou `supabase/.env`).
  - Impact : attaquant peut utiliser la clé pour appeler OpenAI au nom de Niqo (consommation budget + risque de violation des Terms of Service OpenAI).
  - Mitigation : budget cappé côté compte API OpenAI (alarme + cut-off auto à seuil). Rotation immédiate via dashboard OpenAI + update `supabase secrets set OPENAI_API_KEY=...` + redeploy EF.
  - **Note** : impact RGPD nul (la clé ne donne pas accès aux logs OpenAI passés — zero retention).
- **Scénario réaliste** : leak de `NIQO_INTERNAL_KEY`.
  - Impact : un attaquant qui connaît l'URL EF + la clé peut appeler `moderate-message` avec un `message_id` arbitraire et générer un signalement auto fake (signaleur=system_user).
  - Mitigation : le `message_id` doit correspondre à un message existant en DB. L'attaquant ne peut pas créer des signalements arbitraires, juste re-déclencher le scan de messages existants. Rotation : `openssl rand -hex 32` → update Supabase EF Secret + Vault Postgres.
- **Scénario théorique** : breach Niqo → un attaquant intercepte le contenu d'un message en transit vers OpenAI (impossible si TLS non-cassé).
- **Scénario théorique** : OpenAI compromis (breach interne).
  - Impact RGPD : nul (zero retention → aucun message Niqo persisté chez OpenAI).
  - Mitigation : aucune nécessaire de notre côté ; OpenAI gère le breach via leur propre notification process.

### TODOs ouvertes pour cette feature (#12)

- [ ] **Avant launch public** : ajouter clause «Modération automatique de messagerie» dans CGU v1.2 (mention sous-traitant OpenAI US + SCC + zero retention).
- [ ] **Avant launch public** : signer le DPA OpenAI (téléchargeable platform.openai.com) côté entité Rwanda.
- [ ] **Avant launch public** : ajouter dans la politique de confidentialité (`docs/legal/confidentialite.md`) que les messages chat peuvent être analysés par un modèle automatique pour détecter le harcèlement.
- [ ] **Phase 2** : ajouter une rétention explicite sur `messages` (1 an proposé) et `signalements` (3 ans pour preuves de modération récurrente).
- [ ] **Phase 2** : envisager de masquer le preview 800 chars du signalement auto si le user a supprimé son message entre temps (UX privacy).

---

## Entrée #13 — F15 Bloquer un utilisateur (Apple Guideline 1.2 UGC + Google Play UGC)

- **Date** : 2026-05-15 (migrations 129-130) → 2026-05-16 (mig 131 fix admin notif + mig 132 RPC display)
- **Feature** : F15 — l'utilisateur peut bloquer un autre utilisateur depuis son profil public ou une conversation. Le bloqué disparaît du feed annonces et ne peut plus envoyer de messages. Un signalement implicite est créé en parallèle pour notifier l'admin (Apple requirement).
- **Branche** : `main` (shipping urgent, pas de feature branch — voir contexte Apple §contexte)
- **Fichiers concernés** :
  - `docs/migrations/129_blocked_users.sql` → `132_get_my_blocked_users_display.sql`
  - `lib/blocking.ts`, `lib/hooks/useBlockedUsers.ts`, `lib/annonces.ts` (param `excludeVendeurIds`)
  - `components/blocking/BlockUserSheet.tsx`, `app/profile/blocked-users.tsx`
  - `app/u/[id].tsx`, `app/messages/[conversationId].tsx`, `app/profile.tsx`
  - Doc backend complète : `docs/backend/blocking.md`

### Contexte (pourquoi cette feature existe)

Apple a rejeté la build iOS 1.0.0 (4) le 2026-05-15 sur la Guideline 1.2 Safety — User-Generated Content : *"A mechanism for users to block abusive users. Blocking should also notify the developer of the inappropriate content and should remove it from the user's feed instantly."* Niqo a shippé la feature complète dans la journée et Apple a validé la build 1.0.0 (5) le 2026-05-16 (24h de review). Google Play UGC policy a la même exigence — la feature couvre les deux stores.

### 1. Données traitées

| Donnée | Source | Stockage | Sensibilité |
|---|---|---|---|
| `blocker_id` | auth.uid() au moment du block | `blocked_users.blocker_id` (FK users CASCADE) | Liaison user identifié |
| `blocked_id` | UUID cible saisi par le blocker | `blocked_users.blocked_id` (FK users CASCADE) | Liaison user identifié |
| `reason` | Textarea libre **facultatif**, max 500 chars | `blocked_users.reason text` (clair) | Texte libre — peut potentiellement contenir des **détails sensibles** (insultes citées, threats reçues, allusions à la vie privée). |
| `created_at` | `now()` serveur | `blocked_users.created_at timestamptz` | Audit-trace |
| **Effet de bord** : signalement implicite | `block_user` (mig 131) `INSERT ON CONFLICT` | `signalements (target_type='utilisateur', target_id=blocked, signaleur_id=blocker, motif='Bloqué : ...', description=reason ou texte par défaut)` | Lié aux 2 users, visible admin uniquement |

### 2. But du traitement

- **Sécurité utilisateur** : permettre à un user de couper unilatéralement la communication avec un harceleur, fraudeur, ou simplement un autre user qu'il ne souhaite plus voir.
- **Conformité légale stores** : obligation contractuelle Apple Guideline 1.2 + Google Play UGC policy. Ces exigences proviennent elles-mêmes de Digital Services Act (DSA, Règlement UE 2022/2065) et de la jurisprudence locale CI/CG sur le harcèlement en ligne.
- **Modération communautaire** : le block sert de signal fort à l'admin Niqo. Couplé à `nb_signalements` et `score_abus`, il alimente le mécanisme d'auto-suspension à 3 signalements confirmés (mig 25-28).

### 3. Minimisation

- **Motif optionnel** : l'UI précise *"Motif (facultatif)"* — l'user peut bloquer sans aucun motif. Pas de champ obligatoire qui pousserait à sur-collecter.
- **Max 500 chars** sur le motif (check constraint DB) — empêche la collecte d'essais entiers ou de copies de conversation.
- **Pas d'enrichissement** : `blocked_users` ne stocke pas l'IP, l'user agent, le `conversation_id` source, ni l'annonce qui a déclenché le block. Strict minimum pour la fonctionnalité.
- **Aucune copie de l'historique de messages ou des annonces du bloqué** dans `blocked_users`. La relation est "asymétrique simple" (qui-a-bloqué-qui).
- **Pas de stockage côté bloqué** que quelqu'un l'a bloqué (anti-stalking — voir §4).

### 4. Stockage & sécurité

- **RLS owner-scoped 3 policies** (mig 129) : `blocked_users_own_select/insert/delete` filtrées par `auth.uid() = blocker_id`. Un user ne voit jamais qui l'a bloqué.
- **5 RPCs `SECURITY DEFINER`** avec checks `auth.uid()` explicites :
  - `block_user`, `unblock_user`, `get_my_blocked_user_ids` (mig 129/131)
  - `am_i_blocked_in_conv` (mig 130) — boolean isolé (anti-stalking : on ne révèle pas l'identité du blocker, juste "êtes-vous bloqué dans cette conv")
  - `get_my_blocked_users_display` (mig 132) — bypass RLS users avec scope strict `blocker_id = auth.uid()`
- **Trigger DB `fn_messages_block_check`** (mig 130) BEFORE INSERT messages : raise `BLOCKED_BY_RECIPIENT` si destinataire a bloqué expéditeur. Skip pour `type='systeme'` (Niqo Auto-Modération doit passer).
- **Pas de UPDATE possible** sur le motif (pas de policy UPDATE + pas de RPC) — le motif est figé au moment du block (intentionnel : audit-trace).
- **Realtime publication `supabase_realtime`** (mig 129) — limité aux events de la propre ligne du blocker (RLS filtre par `blocker_id=eq.{userId}` côté channel).
- **Filter front anti-leak** : annonces filtrées via `useBlockedUsers` hook + `.not('vendeur_id', 'in', blockedIds)`. Le bloqué ne peut pas re-apparaître dans le feed du blocker tant qu'il n'est pas unblock.
- **Anti-bypass via PostgREST direct** : si un client mobile bypasse l'app et fait un INSERT direct PostgREST → la policy `blocked_users_own_insert` exige `auth.uid() = blocker_id` (impossible de bloquer pour quelqu'un d'autre).
- **Anti-self-block et anti-system-user** : checks dans `block_user` + check constraint DB (`blocker_id <> blocked_id`).

### 5. Consentement

- **Implicite** : bloquer = action volontaire de l'utilisateur. Comparable au signalement (entrée #8) en termes de base légale.
- **Pas de consentement séparé requis** par le RGPD car le traitement est :
  - Nécessaire à l'exécution du contrat (CGU §sécurité utilisateur) — base légale **art. 6(1)(b) RGPD**.
  - Nécessaire au respect d'une obligation légale (Apple/Google policy, DSA) — base légale **art. 6(1)(c) RGPD**.
  - Intérêt légitime du responsable (sécurité de la communauté) — base légale **art. 6(1)(f) RGPD**.

- **CGU à mettre à jour avant launch public** (voir TODOs) : ajouter une clause «Blocage d'utilisateur» qui mentionne :
  - La possibilité de bloquer un autre utilisateur.
  - Le fait qu'un signalement implicite est généré pour notifier l'admin.
  - Le motif éventuel saisi est visible UNIQUEMENT par l'admin Niqo, jamais par la cible.

### 6. Droit à l'oubli

- **Cascade FK strict** (mig 129) : `blocker_id ON DELETE CASCADE` ET `blocked_id ON DELETE CASCADE`. Si l'un des 2 users supprime son compte, sa ligne dans `blocked_users` disparaît automatiquement.
- **Le signalement implicite associé** reste indépendamment dans `signalements` (audit-trace modération anti-fraude légitime, voir entrée #8). Si le blocker supprime son compte, `signalements.signaleur_id` cascade selon mig 70 pattern (à valider — entrée #8 §6 mentionne TODO Phase 2 sur ce point).
- **Pas d'action explicite** nécessaire côté `delete_my_account()` — la cascade fait le ménage.
- **Aucune copie chez un tiers** — pas d'envoi externe (cf. §8).

### 7. Rétention

- **`blocked_users`** : conservé tant que les 2 users existent. Pas de purge automatique. L'unblock supprime immédiatement la ligne (DELETE direct, pas de soft-delete).
- **Justification "tant que les 2 users existent"** : un block reflète une décision de l'utilisateur, qui doit être respectée indéfiniment tant qu'il n'unblock pas explicitement. Une purge automatique reviendrait à débloquer sans consentement.
- **Signalement implicite associé** : voir entrée #8 §7 (signalements `traite` conservés indéfiniment, `rejete` purgés à 30j — à implémenter).

### 8. Tiers

- **Aucun tiers**.
- Toutes les données restent dans Supabase (`blocked_users` + cascade `signalements`).
- Admin Dominique Huang accède aux blocs via Supabase Dashboard ou (futur) interface admin `/admin/blocked-users` (pas encore construite).

### 9. Accès interne

- **Admin (`is_admin=true`)** : peut consulter `blocked_users` via Supabase Dashboard SQL Editor (RLS bypass via `service_role`). Pas d'UI admin web dédiée en Phase 1 (les blocks remontent via les signalements implicites mig 131 dans `/admin/signalements`).
- **User blocker** : voit sa propre liste via `app/profile/blocked-users.tsx` (RPC `get_my_blocked_users_display`).
- **User bloqué** : ne sait pas qu'il a été bloqué (`am_i_blocked_in_conv` retourne boolean isolé, pas d'identité). Anti-stalking + best-practice industrie (Twitter, Instagram, etc.).

### 10. Plan en cas de breach

- **Scénario réaliste** : leak de la base Supabase (`blocked_users` exposée).
  - Impact : un attaquant peut établir le graphe "qui-a-bloqué-qui" + lire les motifs (potentiellement sensibles si l'user a écrit des détails). Pas de PII directe (uniquement UUIDs), mais corrélation possible avec `users.prenom/email` si les 2 tables fuitent ensemble.
  - Mitigation : RLS owner-scoped + `service_role` non-exposé (cf. audit /cso 2026-05-10). Rotation des credentials Supabase + reset des sessions auth en cas de breach.
  - Notification RGPD : 72h CNIL équivalent (ARTCI CI / ANRTIC CG / NCSA RW) si > 100 users impactés.
- **Scénario réaliste** : un user malveillant crée massivement des blocks fake.
  - Impact : N signalements implicites créés dans la queue admin → DoS modération.
  - Mitigation : le `score_abus` du faux-blocker monte mécaniquement (chaque signalement implicite consomme du budget) ; trigger `tg_check_score_abus` (mig 28) suspend le compte à 3 signalements confirmés contre lui. Couplé au guard `is_my_account_active()` (mig 74), un compte suspendu ne peut plus bloquer (à valider — RLS `blocked_users_own_insert` n'inclut pas explicitement le guard `is_active` au 2026-05-16 — voir TODO).
- **Scénario théorique** : leak de motifs sensibles.
  - Impact : un user a écrit dans son motif des détails (ex : "il m'a envoyé des photos non sollicitées le 2026-05-10"). En cas de breach, ce détail est exposé.
  - Mitigation : minimisation (max 500 chars), pas d'enrichissement, l'UI précise "facultatif". À renforcer via une note dans la CGU encourageant les motifs courts et non-sensibles.

### TODOs ouvertes pour cette feature (#13)

- [ ] **Avant launch public** : ajouter clause «Blocage d'utilisateur» dans CGU v1.2 (action volontaire + signalement implicite + motif visible admin uniquement).
- [ ] **Avant Play Store soumission** : confirmer que la feature couvre Google Play UGC policy (parité avec Apple) — la build prod Android avec mig 129-132 doit être testée.
- [ ] **À valider** : `blocked_users_own_insert` policy doit-elle inclure le guard `is_my_account_active()` ? Cohérence avec `favoris_owner_insert` (mig 74). Risque sinon : un user suspendu peut continuer à bloquer (boucle infinie de signalements vs admin).
- [ ] **Phase 2** : page admin web `/admin/blocked-users` (recherche par user, vue "qui a bloqué qui", stats `nb_blocked_by`).
- [ ] **Phase 2** : tests pgTAP `tests/sql/blocked_users.test.sql` + Vitest `tests/integration/blocked-users.test.ts` (cf. `docs/backend/blocking.md §11`).
- [ ] **Phase 2** : politique de rétention explicite sur le signalement implicite après unblock (suppression auto si le blocker unblock et le signalement n'a pas été traité ?).

---

_Prochaine entrée : à créer dès la prochaine feature qui touche aux données personnelles._
