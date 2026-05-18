# Module F07 KYC (Vérification d'identité) — Scénarios de test

> Créé le **2026-05-03**. Branche : `feat/F07-kyc-verification`.
> Méthodologie : CLAUDE.md §Tests — un test à la fois, OK/KO, fix avant de passer au suivant.
> Prérequis : migrations 43-46 jouées, dev client Expo ou Expo Go, 1 user connecté.

## État du périmètre testable

| Couche | Statut | Testable maintenant ? |
|---|---|---|
| Migrations 43-48 + RLS + RPCs | ✅ jouées | Oui (via SQL Editor + Niveau 2) |
| Migrations 50-52 (fixes admin) | ⚠️ à confirmer | **Pré-flight obligatoire** (cf. §0) |
| Wizard mobile UI (intro → 3 captures → review → summary) | ✅ codé | Oui — Niveaux 1+2 |
| Upload Storage `cni-verifications` | ✅ codé + RLS strictes | Oui — Niveau 1 (vérif Dashboard) |
| Banner profile (pending / rejected) | ✅ codé | Oui — Niveau 2 (injection SQL) |
| Menu entry "Devenir vendeur vérifié" | ✅ câblé | Oui |
| Badges profil (Vendeur Vérifié inline + pills + ring) | ✅ codé | Oui — bloc G |
| Edge Function `pawapay-init-deposit` (sandbox) | ✅ déployée | Oui — bloc E |
| Edge Function `pawapay-webhook` | ✅ déployée | Oui — bloc E |
| Admin web `/admin/verifications` (list + detail + actions) | ✅ codée | Oui — bloc F |
| Email Resend post-validation/refus | ✅ codé (sandbox dev) | Oui — bloc F (limit : envoi vers ton email Resend uniquement) |
| Cron purge J+30 CNI rejetées | ❌ pas codée | N/A (pas urgent) |
| F10 Push notif | ❌ pas codée | N/A (pas urgent) |

---

## 0 — Pré-flight (à valider avant de lancer le moindre test)

### 0.1 — Migrations 50, 51, 52 jouées
- [ ] **Préalable** : Supabase Dashboard → SQL Editor
- [ ] **Marche à suivre** : exécuter
  ```sql
  -- Mig 50 : RPC admin_validate_verification doit avoir le cast enum
  select pg_get_functiondef('public.admin_validate_verification'::regproc);
  -- → cherche `::statut_verification` dans le body

  -- Mig 51 : RPC get_user_public_profile doit retourner is_verified
  select pg_get_functiondef('public.get_user_public_profile'::regproc);
  -- → cherche `is_verified` dans le SELECT

  -- Mig 52 : helper is_current_user_admin + policy admin
  select exists(select 1 from pg_proc where proname = 'is_current_user_admin');
  select polname from pg_policies where tablename = 'users' and polname = 'users_admin_select';
  ```
- [ ] **Attendu** : les 3 vérifications retournent du contenu / `t` / la ligne `users_admin_select`. Si KO → jouer la migration manquante avant de continuer.

### 0.2 — Compte test prêt
- [ ] **Préalable** : ton UID + ton email
  ```sql
  select id, email, is_admin, is_verified from public.users where email = 'TON_EMAIL';
  ```
- [ ] **Attendu** : `is_admin = true` (pour les tests admin web), `is_verified = false` (pour repartir d'un état propre)

### 0.3 — Reset état KYC
- [ ] **Marche à suivre** : exécuter le bloc D (reset complet) — voir bas du fichier.
- [ ] **Attendu** : 0 verification, 0 paiement type=verification, is_verified=false.

---

## A — Wizard UI : flow visuel sans paiement

### A1 — Entry point depuis Profil
- [ ] **Préalable** : user connecté, ouvert sur l'écran Profil
- [ ] **Marche à suivre** :
  1. Scroll jusqu'à la section "Compte"
  2. Observer le menu item "Devenir vendeur vérifié" avec icône `ShieldCheck`
  3. Tap dessus
- [ ] **Attendu** : navigation vers `/profile/verification`, écran Step 1 (Intro) s'affiche avec icône bouclier vert + titre "Deviens vendeur vérifié."

### A2 — Step 1 (Intro) — affichage et scroll
- [ ] **Préalable** : Step 1 affichée
- [ ] **Marche à suivre** :
  1. Lire l'intro de haut en bas
  2. Scroll si nécessaire (sur petit écran)
  3. Vérifier visibilité du bouton "Commencer" en bas
- [ ] **Attendu** : tout le contenu lisible (hero, 3 bullets, bloc tarif 1000 FCFA, checkbox RGPD), CTA "Commencer" sticky bottom toujours visible **même sur viewport 360×640**, sticky avec border-top

### A3 — Step 1 — Consent RGPD obligatoire
- [ ] **Préalable** : Step 1, checkbox décochée par défaut
- [ ] **Marche à suivre** :
  1. Sans cocher la case, tap "Commencer"
  2. Cocher la case (tap sur la zone label OU sur la checkbox)
  3. Vérifier visuellement
  4. Tap "Commencer" maintenant
- [ ] **Attendu** :
  - Sans cocher : bouton "Commencer" grisé (`bg-niqo-gray-200`), tap ne fait rien
  - Après cocher : checkbox passe en vert success avec coche, bouton devient coral
  - Avec checkbox cochée : tap → ouvre Step 2 (caméra back)

### A4 — Step 2 (CNI recto) — permission caméra
- [ ] **Préalable** : 1ère utilisation de la caméra dans l'app pour ce user
- [ ] **Marche à suivre** :
  1. À l'arrivée sur Step 2, observer la demande de permission iOS/Android
  2. Tap "Autoriser"
- [ ] **Attendu** : popup système avec le wording de `app.json` (mention "vérification de ton identité"), puis caméra arrière s'ouvre avec mask sombre + cadre rectangulaire 4:3 + coins coral

### A5 — Step 2 — Refus permission caméra
- [ ] **Préalable** : faire un reset des permissions caméra (Réglages → Niqo → Caméra OFF)
- [ ] **Marche à suivre** : revenir sur Step 2
- [ ] **Attendu** :
  - Si 1ère demande refusée : écran neutre avec icône caméra coral + texte explicatif + bouton "Autoriser la caméra"
  - Si refus permanent (2ème refus iOS) : bouton devient "Ouvrir les réglages" (icône Settings)

### A6 — Step 2 — Capture CNI recto
- [ ] **Préalable** : caméra arrière ouverte
- [ ] **Marche à suivre** :
  1. Cadrer un bout de papier ou une vraie CNI dans le rectangle blanc
  2. Tap le bouton capture rond coral en bas
- [ ] **Attendu** :
  - Animation tap (scale down brief)
  - Haptic medium (iOS uniquement)
  - Bouton devient `#A8421F` pendant la capture (visual feedback)
  - Transition vers écran CaptureReview avec la photo plein écran

### A7 — CaptureReview — Refaire / Continuer
- [ ] **Préalable** : photo prise au A6 affichée
- [ ] **Marche à suivre** :
  1. Tap "Refaire"
  2. Reprendre une photo
  3. Tap "Continuer"
- [ ] **Attendu** :
  - "Refaire" → retour caméra Step 2
  - "Continuer" → upload Storage en arrière-plan (devrait être instantané sur wifi) puis transition Step 3 (caméra verso)

### A8 — Step 3 (CNI verso) — capture + review
- [ ] **Préalable** : Step 3 caméra
- [ ] **Marche à suivre** : capturer une photo, valider Continuer
- [ ] **Attendu** : transition vers Step 4 (caméra **front** pour selfie)

### A9 — Step 4 (Selfie) — caméra front + ovale
- [ ] **Préalable** : Step 4 caméra
- [ ] **Marche à suivre** :
  1. Vérifier que la caméra **frontale** est active (tu te vois)
  2. Vérifier que le guide est un **ovale** (pas un rectangle)
  3. Capturer
- [ ] **Attendu** : caméra front + ovale 5:7 sans coins (juste cercle blanc), tip "Selfie en direct, regarde l'objectif"

### A10 — Step 5 (Summary) — récap + paiement UI
- [ ] **Préalable** : 3 captures validées
- [ ] **Marche à suivre** :
  1. Vérifier les 3 thumbnails (recto / verso / selfie) avec checkmark vert + bouton "Modifier"
  2. Vérifier le bloc tarif coral-light avec "1 000 FCFA"
  3. Taper un numéro Mobile Money invalide (ex: "0712" — 4 digits)
  4. Taper un numéro valide (ex: "0712345678" en CI ou "061234567" en CG)
  5. Vérifier le disclaimer "Non remboursable" en bas
- [ ] **Attendu** :
  - Préfixe pays affiché (`+225` ou `+242`) read-only
  - Numéro invalide : message rouge "Numéro ivoirien invalide"
  - Numéro valide : check vert "✓ +225 07 12 34 56 78"
  - Bouton "Payer" disabled tant que numéro invalide

### A11 — Step 5 — Modifier une capture
- [ ] **Préalable** : Step 5 affichée
- [ ] **Marche à suivre** : tap "Modifier" sur la ligne CNI verso
- [ ] **Attendu** : retour caméra Step 3 (verso), avec possibilité de refaire la photo et revenir au Summary

### A12 — Step 5 — Quitter avec progression
- [ ] **Préalable** : Step 5 atteinte
- [ ] **Marche à suivre** : tap flèche retour (header)
- [ ] **Attendu** : Alert "Quitter sans sauvegarder ?" avec 2 boutons (Continuer / Quitter destructive)

### A13 — Step 5 — Tap "Payer" (sans Edge Function)
- [ ] **Préalable** : numéro valide saisi
- [ ] **Marche à suivre** : tap "Payer 1 000 FCFA via Mobile Money"
- [ ] **Attendu** : **Erreur attendue** car Edge Function `pawapay-init-deposit` non déployée. Message d'erreur affiché en rouge sous le bouton (ex: "Function not found"). Wizard reste sur Step 5, peut être réessayé.

---

## B — Storage RLS (Niveau 1 — Dashboard)

### B1 — Upload utilisateur OK (own folder)
- [ ] **Préalable** : avoir validé A6/A8/A9 (3 captures avec uploads OK)
- [ ] **Marche à suivre** : Supabase Dashboard → Storage → bucket `cni-verifications` → ouvrir le folder `<TON_UID>/<draftId>/`
- [ ] **Attendu** : 3 fichiers `recto.jpg`, `verso.jpg`, `selfie.jpg` présents

### B2 — Lecture user refusée (RLS strict)
- [ ] **Préalable** : connecté en client, avoir uploadé des photos
- [ ] **Marche à suivre** : depuis l'app, essayer de récupérer une URL (test impossible côté UI, mais on peut tester via console SQL Dashboard avec `select` côté user normal)
  ```sql
  select * from storage.objects where bucket_id = 'cni-verifications';
  ```
  exécuté dans le SQL Editor en mode "Run as: authenticated" avec le JWT du user
- [ ] **Attendu** : 0 row retournée (RLS user n'a pas de policy SELECT)

### B3 — Lecture admin OK
- [ ] **Préalable** : toggle `is_admin = true` sur ton compte (cf. SQL ci-dessous)
  ```sql
  update public.users set is_admin = true where email = 'TON_EMAIL';
  ```
- [ ] **Marche à suivre** : refaire la query du B2 en authenticated avec ton JWT (admin)
- [ ] **Attendu** : toutes les rows visibles (3 fichiers)

---

## C — Écrans déjà-pending / déjà-verified / rejected (Niveau 2 — Injection SQL)

### C1 — Écran "Déjà vérifié"
- [ ] **Préalable** : aucune verification active (vérifier `select * from verifications_identite where user_id = 'TON_UID'`)
- [ ] **Marche à suivre** :
  ```sql
  update public.users set is_verified = true, verification_paid_at = now() where id = 'TON_UID';
  ```
  Puis dans l'app : tap "Vérification d'identité" depuis Profil
- [ ] **Attendu** :
  - Menu item dans Profil affiche le badge "Vérifié"
  - Sur tap → écran fullscreen avec icône `BadgeCheck` vert, titre "Tu es vérifié.", bouton "Retour au profil"

### C2 — Écran "Vérification en cours" (pending)
- [ ] **Préalable** : reset (`update users set is_verified=false; delete from verifications_identite where user_id='TON_UID'; delete from paiements_niqo where user_id='TON_UID' and type='verification';`)
- [ ] **Marche à suivre** :
  ```sql
  -- 1. Créer un paiement complété
  insert into public.paiements_niqo (user_id, type, montant_fcfa, statut, completed_at)
  values ('TON_UID', 'verification', 1000, 'completed', now())
  returning id;
  -- → note l'id retourné = PAIEMENT_UUID

  -- 2. Créer une verification pending qui le consomme
  insert into public.verifications_identite
    (user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut)
  values
    ('TON_UID', 'PAIEMENT_UUID',
     'TON_UID/test/recto.jpg', 'TON_UID/test/verso.jpg', 'TON_UID/test/selfie.jpg',
     'pending');
  ```
  Puis dans l'app : pull-to-refresh sur Profil
- [ ] **Attendu** :
  - **Banner coral-light** en haut du Profil avec icône Clock + texte "Vérification en cours · 24h max"
  - Tap sur le banner → écran fullscreen avec Clock + titre "Vérification en cours.", bouton "Retour au profil"

### C3 — Écran "Refusée" + bouton Recommencer
- [ ] **Préalable** : verification pending existante (état post C2)
- [ ] **Marche à suivre** :
  ```sql
  update public.verifications_identite
     set statut = 'rejected',
         reviewed_by = 'TON_UID',
         reviewed_at = now(),
         reject_reason = 'CNI floue, recto illisible. Réessaie avec un meilleur éclairage et un cadrage net.'
   where user_id = 'TON_UID' and statut = 'pending';
  ```
  Pull-to-refresh sur Profil
- [ ] **Attendu** :
  - **Banner rouge** `bg-niqo-danger/10` en haut du Profil avec icône AlertCircle + raison + bouton "Recommencer"
  - Tap sur le banner → ouverture du wizard à Step 1 (Intro), avec un mini-bandeau rouge en haut "Vérification précédente refusée — [raison]"

### C4 — Re-soumission après refus (anti-double-pending)
- [ ] **Préalable** : un user avec verification rejected (état post C3)
- [ ] **Marche à suivre** : refaire le wizard complet (Steps 1-5), tap "Payer" au Step 5
- [ ] **Attendu** : erreur attendue car Edge Function manquante. **Mais** l'upload des 3 photos doit fonctionner (un user peut resoumettre).

### C5 — Anti-spoofing path (RPC submit_verification)
- [ ] **Préalable** : avoir un paiement completed
- [ ] **Marche à suivre** : appeler la RPC avec un path qui ne commence pas par `auth.uid()` :
  ```sql
  select submit_verification(
    'PAIEMENT_UUID',
    'AUTRE_USER_UID/draft/recto.jpg',  -- spoofing tentative
    'TON_UID/draft/verso.jpg',
    'TON_UID/draft/selfie.jpg'
  );
  ```
- [ ] **Attendu** : exception `INVALID_PATH_OWNERSHIP` (errcode P0005)

---

## H — RGPD droit à l'oubli (BLOCKER review code 2026-05-06)

### H1 — Suppression compte purge cni-verifications (mig 53)
- [ ] **Préalable** : un compte test avec au moins une verification soumise (statut = pending, verified ou rejected) — donc des fichiers présents dans Storage `cni-verifications/{UID}/`
- [ ] **Marche à suivre** :
  1. Vérifier la présence des fichiers Storage :
     ```sql
     select name from storage.objects
      where bucket_id = 'cni-verifications'
        and (storage.foldername(name))[1] = 'TON_UID'
      order by created_at;
     ```
     → doit lister 3+ fichiers (recto, verso, selfie)
  2. Depuis l'app sur ce compte, profil → "Supprimer mon compte" → confirmer
  3. Re-jouer la query SQL ci-dessus (côté admin/Dashboard car l'user n'existe plus)
- [ ] **Attendu** :
  - 0 row retournée → tous les fichiers CNI ont été purgés
  - `select * from public.users where id = 'TON_UID'` → 0 row
  - `select * from public.verifications_identite where user_id = 'TON_UID'` → 0 row (cascade)
  - **Si la query Storage retourne encore des fichiers → mig 53 KO ou pas jouée**

### H2 — Reset après H1
Recréer un compte test (signup) si tu veux continuer les tests.

### H3 — Cron purge expirées (mig 54)
- [ ] **Préalable** : extension `pg_cron` activée (Dashboard → Database → Extensions)
- [ ] **Marche à suivre** :
  1. Vérifier le job cron existe :
     ```sql
     select jobname, schedule, command from cron.job
      where jobname = 'purge-expired-kyc-verifications';
     ```
  2. Forcer une purge manuelle (sans attendre 3h du matin) :
     ```sql
     -- Backdater une verification rejected pour qu'elle soit "expirée"
     update public.verifications_identite
        set reviewed_at = now() - interval '31 days'
      where statut = 'rejected'
        and user_id = 'TON_UID';

     -- Lister les fichiers Storage avant purge
     select name from storage.objects
      where bucket_id = 'cni-verifications'
        and (storage.foldername(name))[1] = 'TON_UID';

     -- Lancer la purge à la main
     select public.purge_expired_kyc_verifications();
     ```
  3. Re-jouer le SELECT Storage et le SELECT verifications_identite
- [ ] **Attendu** :
  - Job cron listé avec schedule `0 3 * * *`
  - `purge_expired_kyc_verifications()` retourne `1` (1 row supprimée)
  - 0 fichier Storage restant (trigger BEFORE DELETE a purgé)
  - 0 row `verifications_identite` pour cet user (rejected expirée)

### H4 — Trigger purge Storage indépendamment du cron
- [ ] **Préalable** : une verification quelconque en DB
- [ ] **Marche à suivre** : `delete from public.verifications_identite where id = 'XYZ';` (manuellement par admin via SQL Editor)
- [ ] **Attendu** : les 3 fichiers Storage liés (`cni_recto_path`, `cni_verso_path`, `selfie_path`) disparaissent en même temps. Aucun orphelin.

---

## D — Reset entre tests

À garder en favori dans le SQL Editor :

```sql
-- Reset complet pour repartir de zéro sur F07
delete from public.verifications_identite where user_id = 'TON_UID';
delete from public.paiements_niqo where user_id = 'TON_UID' and type = 'verification';
update public.users
   set is_verified = false, verification_paid_at = null
 where id = 'TON_UID';

-- Optionnel : nettoyer Storage manuellement via Dashboard
-- (Storage → cni-verifications → supprimer le folder TON_UID)
```

---

## E — Paiement PawaPay sandbox (E2E)

> Prérequis : `PAWAPAY_API_KEY` configurée côté Edge Functions Supabase, et numéros de test sandbox PawaPay (la sandbox accepte tout numéro valide format E.164 et auto-complète après ~5s).

### E1 — Init paiement OK (sandbox)
- [ ] **Préalable** : reset DB (bloc D), wizard prêt en Step 5 avec numéro Mobile Money valide saisi
- [ ] **Marche à suivre** :
  1. Tap "Payer 1 000 FCFA"
  2. Observer la réponse Edge Function (logs Supabase Dashboard → Edge Functions → `pawapay-init-deposit` → Logs)
- [ ] **Attendu** :
  - Wizard passe en état "loading" (spinner)
  - Row insérée dans `paiements_niqo` avec `statut = 'pending'`, `provider_ref = depositId UUID`, `provider = 'ORANGE_CIV'` (ou MTN selon picker)
  - Côté PawaPay sandbox : log retournant `status: ACCEPTED` ou équivalent

### E2 — Webhook completed → submit auto
- [ ] **Préalable** : E1 OK, `paiements_niqo` en pending
- [ ] **Marche à suivre** :
  1. Attendre ~5-10s (sandbox auto-callback) **OU** simuler le webhook manuellement :
     ```bash
     curl -X POST https://uokauzmafppukgsemugz.supabase.co/functions/v1/pawapay-webhook \
       -H "Content-Type: application/json" \
       -d '{"depositId":"<DEPOSIT_ID>","status":"COMPLETED","amount":"1000","currency":"XOF"}'
     ```
  2. Observer logs `pawapay-webhook` Dashboard
  3. Pull-to-refresh wizard mobile (ou attendre poll auto)
- [ ] **Attendu** :
  - Row `paiements_niqo.statut = 'completed'`, `completed_at` rempli
  - Wizard appelle automatiquement `submit_verification` → row `verifications_identite` créée en `pending`
  - Mobile redirige vers écran "Vérification en cours" + banner profil pending

### E3 — Webhook failed → UX retry
- [ ] **Préalable** : reset, lancer une nouvelle init (E1)
- [ ] **Marche à suivre** : simuler webhook FAILED :
  ```bash
  curl -X POST .../pawapay-webhook -d '{"depositId":"<ID>","status":"FAILED","failureCode":"INSUFFICIENT_FUNDS"}'
  ```
- [ ] **Attendu** :
  - Row `paiements_niqo.statut = 'failed'`
  - Mobile : message d'erreur "Paiement échoué" + bouton "Réessayer" → retour Step 5 avec photos préservées

### E4 — Timeout polling client (3 min)
- [ ] **Préalable** : init OK, **ne pas** déclencher de webhook
- [ ] **Marche à suivre** : laisser le wizard sur "loading" sans interaction
- [ ] **Attendu** : après ~3 min, message gracieux "Le paiement prend plus de temps que prévu, on continuera en arrière-plan" + retour profil avec banner pending si webhook arrive plus tard

### E5 — Webhook bypass anti-replay
- [ ] **Préalable** : un paiement déjà completed
- [ ] **Marche à suivre** : renvoyer le même webhook COMPLETED 2 fois
- [ ] **Attendu** : 2e appel idempotent (pas de double row, pas de double submit). Logs montrent "already processed" ou équivalent.

---

## F — Admin web `/admin/verifications`

> Prérequis : `cd landing && npm run dev` → http://localhost:3000/admin/login. Compte admin (is_admin=true) connecté.

### F1 — Admin login
- [ ] **Préalable** : navigateur sur `/admin/login`, déconnecté
- [ ] **Marche à suivre** : saisir email + password compte admin, submit
- [ ] **Attendu** : redirect vers `/admin/verifications` (liste). Cookie session Supabase posé. Sidebar visible.

### F2 — Tentative accès non-admin
- [ ] **Préalable** : se connecter avec un compte `is_admin = false` (créer ou toggle SQL)
- [ ] **Marche à suivre** : naviguer vers `/admin/verifications`
- [ ] **Attendu** : redirect `/admin/login` ou 403 (selon middleware). Pas de crash, pas de leak de données.

### F3 — Liste pending
- [ ] **Préalable** : au moins 1 verification `pending` en DB (E2 OK ou injection SQL)
- [ ] **Marche à suivre** : `/admin/verifications`
- [ ] **Attendu** :
  - Tableau ou cards avec : date soumission, prénom/nom user, ville, badge "Pending"
  - Tri par `created_at DESC`
  - Filtres statut (pending / approved / rejected) fonctionnels

### F4 — Détail verification
- [ ] **Préalable** : F3 OK, cliquer sur un row pending
- [ ] **Marche à suivre** : URL `/admin/verifications/[id]`
- [ ] **Attendu** :
  - Page se charge (pas de notFound)
  - Infos profil user à droite (prénom, nom, ville, email, tel masqué, nb_ventes, nb_achats, score)
  - 3 photos affichées (CNI recto, verso, selfie) en grid avec hauteur fixe ~280px, `object-contain`
  - Click photo → lightbox plein écran avec zoom
  - Boutons sticky bottom-right : "Valider" (vert) + "Refuser" (rouge)

### F5 — Validation OK
- [ ] **Préalable** : F4 ouvert sur un row pending
- [ ] **Marche à suivre** : tap "Valider" → confirm dialog → confirm
- [ ] **Attendu** :
  - Row `verifications_identite.statut = 'approved'`, `reviewed_by` + `reviewed_at` remplis
  - Trigger met `users.is_verified = true` + `verification_paid_at` rempli
  - Email Resend envoyé (limit dev : reçu uniquement sur ton email Resend account, sinon log skip)
  - UI : redirect liste avec toast success
  - Mobile (côté user) après refresh : badge "Vendeur Vérifié" affiché sur profil

### F6 — Refus avec raison
- [ ] **Préalable** : autre row pending
- [ ] **Marche à suivre** : tap "Refuser" → modal avec textarea raison → saisir < 5 chars → tap submit
- [ ] **Attendu** : validation côté client refuse (min 5 chars)
- [ ] **Marche à suivre 2** : saisir raison ≥ 5 chars → submit
- [ ] **Attendu** :
  - Row `statut = 'rejected'`, `reject_reason` rempli, `reviewed_at` rempli
  - `users.is_verified` reste `false`
  - Email Resend envoyé avec la raison
  - Mobile : banner rouge "Vérification refusée — [raison]" + bouton Recommencer

### F7 — Cas vide
- [ ] **Préalable** : reset DB, aucune verification
- [ ] **Marche à suivre** : `/admin/verifications`
- [ ] **Attendu** : empty state propre ("Aucune vérification à traiter") + pas de crash

### F8 — Cas users RLS (régression mig 52)
- [ ] **Préalable** : verification soumise par user A, admin connecté = user B (B.is_admin = true)
- [ ] **Marche à suivre** : F4 sur la verification de A
- [ ] **Attendu** : prénom/nom/ville de A visibles. **Si null → mig 52 KO, jouer mig 52.**

---

## G — Badges profil & profil public

### G1 — Pill "Vendeur Vérifié" sur Profil perso
- [ ] **Préalable** : `is_verified = true` sur ton compte (F5 ou injection SQL)
- [ ] **Marche à suivre** : ouvrir l'écran Profil
- [ ] **Attendu** :
  - Avatar entouré d'un anneau vert (success)
  - Pill "Vendeur Vérifié" coral inline avec icône check, sous le nom
  - Pas de bouton "Devenir vendeur vérifié" dans le menu (remplacé par état fini)

### G2 — Pill "Vendeur Vérifié" sur profil public `/u/[id]`
- [ ] **Préalable** : un user A vérifié, ouvrir son profil depuis une annonce ou un chat
- [ ] **Marche à suivre** : observer l'écran
- [ ] **Attendu** :
  - Anneau vert sur avatar
  - Pill coral "Vendeur Vérifié"
  - Pill "Vendeur Fiable" (si critères : nb_ventes > X, score notation > Y) — sinon absente
  - Pill "Nouveau" si compte récent

### G3 — Régression mig 51 (`get_user_public_profile`)
- [ ] **Préalable** : G2 fonctionne
- [ ] **Marche à suivre** : observer logs Metro / network → la RPC `get_user_public_profile` doit renvoyer `is_verified` dans le résultat
- [ ] **Attendu** : `is_verified: true` dans la response. **Si absent → mig 51 KO.**
