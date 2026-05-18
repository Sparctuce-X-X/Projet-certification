# Module F08 Signalements — Plan de tests E2E

> Créé le **2026-05-06**. Branche : `feat/F08-signalements-admin`.
> Méthodologie : CLAUDE.md §Tests — un test à la fois, OK/KO, fix avant de passer au suivant.
> Couvre : mobile (signaler) + admin web (modérer) + DB triggers + sécurité RLS + E2E.

---

## Comptes de test (à utiliser dans tous les scénarios)

| Compte | Email | Rôle | UID (réf locale) |
|---|---|---|---|
| **Admin** | mettertrans@gmail.com | is_admin=true | 5507c1fc-… |
| **Vendeur vérifié** | hdbosshdboss01@gmail.com | normal, has annonces | b9226543-… |
| **Signaleur test** | hdbossdominique358@gmail.com | normal | 13a3c6f8-… |

À adapter selon ce que tu as en DB. Les 3 rôles permettent de jouer toutes les interactions (signaler, être cible, modérer).

---

## §0 — Pré-flight (à valider avant le moindre test)

### 0.1 — Migrations 56 + 57 jouées
- [ ] **Préalable** : Supabase Dashboard → SQL Editor
- [ ] **Marche à suivre** : exécuter
  ```sql
  -- Mig 56
  select case when exists(
    select 1 from pg_policies where tablename = 'signalements'
       and policyname = 'signalements_admin_select'
  ) then '✅ mig 56 OK' else '❌ JOUER mig 56' end as mig_56;

  -- Mig 56 — RPC modération
  select case when exists(
    select 1 from pg_proc where proname = 'admin_treat_signalement'
  ) then '✅ RPC treat OK' else '❌ JOUER mig 56' end as rpc_treat;

  -- Mig 57 — RPCs cascade
  select count(*) as rpcs_cascade
    from pg_proc
   where proname in (
     'admin_suspend_annonce',
     'admin_suspend_user',
     'admin_soft_delete_message'
   );
  ```
- [ ] **Attendu** : `mig_56='✅'`, `rpc_treat='✅'`, `rpcs_cascade=3`

### 0.2 — Compte admin OK
- [ ] **Marche à suivre** :
  ```sql
  select id, email, is_admin
    from public.users where email = 'mettertrans@gmail.com';
  ```
- [ ] **Attendu** : `is_admin=true`

### 0.3 — État DB initial propre
- [ ] **Marche à suivre** :
  ```sql
  select count(*) as nb_signalements_pending
    from public.signalements where statut = 'en_attente';
  ```
- [ ] **Attendu** : noter le count initial, pour qu'on suive l'évolution. Si tu veux repartir d'un état vide, voir bloc R (reset) en fin de doc.

---

## §M — Mobile (côté utilisateur signaleur)

### §M1 — Signaler une annonce

#### M1.1 — Auth gate (anonyme)
- [ ] **Préalable** : déconnecté de l'app (Profil → Se déconnecter)
- [ ] **Marche à suivre** :
  1. Onglet Accueil → tap sur une annonce
  2. Tap le bouton ⋮ (ou icône signalement) sur la card vendeur
- [ ] **Attendu** : auth gate s'ouvre (modal "Connecte-toi pour signaler"). Pas de signalement créé en DB.

#### M1.2 — Signaler une annonce — flow nominal
- [ ] **Préalable** : connecté en `signaleur test`, ouvrir une annonce de `vendeur vérifié`
- [ ] **Marche à suivre** :
  1. Tap "Signaler l'annonce" (bouton ou icône)
  2. Sélectionner motif "Article frauduleux"
  3. (Optionnel) Saisir une description "Le produit n'est pas conforme à la photo"
  4. Tap "Envoyer le signalement"
- [ ] **Attendu** :
  - Toast/écran success "Signalement envoyé. Merci."
  - DB :
    ```sql
    select target_type, target_id, motif, description, statut
      from public.signalements
     where signaleur_id = '13a3c6f8-…'
     order by created_at desc limit 1;
    ```
    → `target_type='annonce'`, `motif='Article frauduleux'`, `statut='en_attente'`

#### M1.3 — Anti-doublon
- [ ] **Préalable** : M1.2 OK (1 signalement existe déjà sur la même annonce par le même signaleur)
- [ ] **Marche à suivre** : refaire le flow signaler depuis l'app sur la même annonce
- [ ] **Attendu** : message d'erreur clair "Tu as déjà signalé cet élément." Pas de 2e row en DB.

#### M1.4 — Tous les motifs proposés
- [ ] **Marche à suivre** : ouvrir le modal signaler annonce
- [ ] **Attendu** : 4 motifs visibles : "Article frauduleux", "Contenu interdit", "Photos trompeuses", "Prix abusif" (cf `MOTIFS_PAR_CIBLE.annonce` dans `lib/signalements.ts`)

#### M1.5 — Description optionnelle (sans description)
- [ ] **Marche à suivre** : signaler une annonce sans saisir de description
- [ ] **Attendu** : DB → `description IS NULL`. Côté admin : "Aucune description fournie par le signaleur." (italique gris)

### §M2 — Signaler un utilisateur (depuis profil public `/u/[id]`)

#### M2.1 — Anti-self-report
- [ ] **Préalable** : connecté `signaleur test`, ouvrir son propre profil public via deep link `niqo://u/13a3c6f8-…`
- [ ] **Marche à suivre** : tap "Signaler le profil"
- [ ] **Attendu** : message "Tu ne peux pas te signaler toi-même." (côté serveur error `cannot_report_self`). Pas d'auto-doublon possible.

#### M2.2 — Signaler un autre user
- [ ] **Préalable** : connecté `signaleur test`, ouvrir profil public de `vendeur vérifié`
- [ ] **Marche à suivre** :
  1. Tap "Signaler le profil"
  2. Choisir motif "Faux profil"
  3. Description : "Photo CNI ne correspond pas à l'avatar"
  4. Envoyer
- [ ] **Attendu** : DB → row `target_type='utilisateur'`, `target_id=b9226543-…`, `motif='Faux profil'`

#### M2.3 — Motifs user
- [ ] **Attendu** : 4 motifs : "Faux profil", "Arnaque suspectée", "Comportement inapproprié", "Vendeur fantôme"

### §M3 — Signaler un message (depuis chat)

#### M3.1 — Signaler un message reçu
- [ ] **Préalable** :
  - Avoir une conversation entre `signaleur test` et `vendeur vérifié` (créer un chat depuis une annonce si besoin)
  - Vendeur a envoyé un message au signaleur
- [ ] **Marche à suivre (côté signaleur test)** :
  1. Ouvrir la conv
  2. Long-press sur le message du vendeur
  3. Choisir "Signaler"
  4. Motif "Harcèlement"
  5. Envoyer
- [ ] **Attendu** : DB → row `target_type='message'`, `target_id=<msg_id>`

#### M3.2 — Anti-self (signaler son propre message)
- [ ] **Préalable** : un message envoyé par le signaleur lui-même
- [ ] **Marche à suivre** : long-press sur SON message → signaler
- [ ] **Attendu** : option "Signaler" absente OU message d'erreur. (Vérifier le comportement attendu côté UI mobile.)

#### M3.3 — Motifs message
- [ ] **Attendu** : 4 motifs : "Contenu inapproprié", "Harcèlement", "Arnaque suspectée", "Spam"

### §M4 — Subir un signalement (côté cible)

#### M4.1 — Vendeur dont l'annonce est suspendue
- [ ] **Préalable** : admin a `admin_suspend_annonce` sur une annonce de `vendeur vérifié` (cf §A9 plus bas)
- [ ] **Marche à suivre côté vendeur (mobile)** :
  1. Onglet Accueil → l'annonce ne doit PAS apparaître dans la liste
  2. Onglet Profil → "Mes annonces" → l'annonce APPARAÎT avec badge "Suspendue"
  3. Tap dessus → écran détail visible MAIS bouton "Modifier" désactivé/absent
- [ ] **Attendu** : RLS `annonces_read_active` filtre, mais owner garde la visibilité (cf `annonces_owner_select_own`)

#### M4.2 — User dont le compte est suspendu
- [ ] **Préalable** : `admin_suspend_user(b9226543-…)` (cf §A14.1)
- [ ] **Marche à suivre côté user suspendu** :
  1. Tenter de se reconnecter
  2. Si déjà connecté : ouvrir une annonce, tenter d'écrire un message
- [ ] **Attendu** : login bloqué / message non envoyé / banner "Compte suspendu" sur Profil

---

## §A — Admin web (côté modération)

### §A1 — Liste `/admin/signalements`

#### A1.1 — Page accessible + initial load
- [ ] **Préalable** : connecté admin sur `localhost:3000/admin/login`
- [ ] **Marche à suivre** : naviguer vers `/admin/signalements`
- [ ] **Attendu** :
  - URL = `/admin/signalements` (sans query → filtre default = "en_attente")
  - Header "Signalements." (point coral)
  - Sous-titre `{N} en attente · {Total} au total`
  - Sidebar : entrée "Signalements" active (background différent)

#### A1.2 — Avatars + pseudos OK (regression)
- [ ] **Marche à suivre** : observer la 1ère colonne "Signaleur"
- [ ] **Attendu** :
  - **Photo Supabase** affichée si `users.avatar_url` non null (pas la bulle initiales)
  - Pseudo = prenom (sans le `—` littéral si nom = "—")

#### A1.3 — Badges colonnes Cible / Statut
- [ ] **Attendu** :
  - Cible : badge avec icon (ShoppingBag/User/MessageCircle) + label
  - Statut : pill coral pour "En attente", success pour "Traité", gray pour "Rejeté"

#### A1.4 — Filtres statut
- [ ] **Marche à suivre** : tap chaque chip "Tout" / "En attente" / "Traité" / "Rejeté"
- [ ] **Attendu** :
  - URL change : `?filter=all|en_attente|traite|rejete`
  - Counts visibles dans chaque chip
  - Tableau filtre en conséquence
  - Filter `all` → tri custom : en_attente d'abord, puis le reste par date desc

#### A1.5 — Filtres cible
- [ ] **Marche à suivre** : tap "Annonces" / "Utilisateurs" / "Messages"
- [ ] **Attendu** : URL `?cible=annonce`. Combine avec statut (ex `?filter=all&cible=annonce`)

#### A1.6 — Search debounce
- [ ] **Marche à suivre** : taper "arnaque" dans la search box
- [ ] **Attendu** : URL change après 300ms (`?q=arnaque`). Tableau ne montre que les rows contenant "arnaque" dans motif ou nom signaleur.

#### A1.7 — Empty state
- [ ] **Marche à suivre** : appliquer un filtre/search qui ne match rien (ex `?q=xyzqwerty`)
- [ ] **Attendu** : empty state avec icône Flag + "Aucun résultat" + sous-texte explicatif

#### A1.8 — Click row → détail
- [ ] **Marche à suivre** : tap n'importe où sur une row (signaleur ou ChevronRight)
- [ ] **Attendu** : navigation `/admin/signalements/[id]` (pas de flash blanc, transition fluide Turbopack)

### §A2 — Détail : header + bande narrative

#### A2.1 — Back link
- [ ] **Attendu** : "← Tous les signalements" cliquable, retour à la liste avec filtres préservés

#### A2.2 — Header compact
- [ ] **Attendu** :
  - Icône Flag coral dans bulle 36px
  - Titre "Signalement." (point coral)
  - StatusBadge à droite du titre
  - Sous-titre : icône type + label + "il y a Xh" + ID 8 premiers chars en mono

#### A2.3 — Bande narrative coral
- [ ] **Attendu** :
  - Fond `bg-niqo-coral/5 border-niqo-coral/20`
  - Chapeau "Signaleur signale → Cible · type" (gris uppercase)
  - Motif en h2 gros (Space Grotesk 24px) + point coral
  - Description avec icône Quote coral en quote-block (max-w-2xl)
  - Si description NULL : italique gris "Aucune description fournie par le signaleur."

#### A2.4 — Cas signalement très ancien
- [ ] **Préalable** : signalement créé > 30j (sinon vérifier les autres formats timeAgo)
- [ ] **Attendu** : "il y a Xj" puis date complète si > 30j

### §A3 — Card cible variant Annonce

#### A3.1 — Stripe + header
- [ ] **Attendu** :
  - `border-l-4 border-l-niqo-coral` à gauche (bandeau coral vertical 4px)
  - Header avec icône ShoppingBag coral + label "ANNONCE SIGNALÉE" coral
  - Statut en mono à droite (`active`, `suspendue`, etc.)

#### A3.2 — Galerie photos
- [ ] **Préalable** : annonce avec ≥1 photo
- [ ] **Attendu** : grid 3 cols, aspect-square, lazy load, fallback gray-100 si erreur
- [ ] **Edge** : annonce sans photo → galerie absente, pas de break layout

#### A3.3 — Titre + prix
- [ ] **Attendu** : titre h3 niqo-black tronqué + prix à droite en mono coral (ex `50 000 FCFA`)

#### A3.4 — Localisation + statut + description
- [ ] **Attendu** : ville · pays + description scrollable `max-h-48 overflow-y-auto`

#### A3.5 — Mini-card vendeur
- [ ] **Attendu** : avatar sm + nom + count signalements + score X/3 + badge Suspendu si `is_active=false`

### §A4 — Card cible variant Utilisateur

#### A4.1 — Stripe + header
- [ ] **Attendu** : `border-l-4 border-l-niqo-black` + header avec User icon + "PROFIL SIGNALÉ"

#### A4.2 — Avatar + identité
- [ ] **Attendu** : avatar lg + nom display + email + ville si présente

#### A4.3 — Stats grid 4 cols
- [ ] **Attendu** : Ventes, Achats, Signalts, Score
  - Score `2/3` en coral si ≥ 2, danger si ≥ 3
  - Signalts danger si ≥ 2

#### A4.4 — Badge Suspendu
- [ ] **Préalable** : user avec `is_active = false`
- [ ] **Attendu** : badge danger "SUSPENDU" en haut à droite du header

### §A5 — Card cible variant Message

#### A5.1 — Stripe + header
- [ ] **Attendu** : `border-l-4 border-l-niqo-gray-500` + header MessageCircle + "MESSAGE SIGNALÉ" + type en mono

#### A5.2 — Bulle chat-like
- [ ] **Attendu** :
  - Bulle `bg-niqo-coral/10 rounded-2xl rounded-tl-sm px-4 py-3 max-w-md`
  - Style iMessage avec coin top-left arrondi spécial
  - Contenu en `whitespace-pre-wrap`
  - Timestamp en dessous

#### A5.3 — Mini-card expéditeur + lien conv
- [ ] **Attendu** : UserMini expéditeur + ligne "→ Conversation liée à l'annonce {8 premiers chars}"

### §A6 — Sidebar : Signaleur + Fiabilité

#### A6.1 — Card signaleur
- [ ] **Attendu** : Avatar md + nom + email + ville (avec icône MapPin)

#### A6.2 — Verdict fiabilité (4 cas)
- [ ] **Cas A** : signaleur n'a aucun autre signalement → "Première plainte" gris
- [ ] **Cas B** : `traite ≥ 2 && traite > rejete` → "Vétéran fiable" success
- [ ] **Cas C** : `rejete ≥ 2 && rejete > traite` → "Faible fiabilité (rejets)" coral
- [ ] **Cas D** : autres cas (mix) → "Historique mitigé" gray
- [ ] **Marche à suivre** : créer un signaleur de chaque profil et observer

#### A6.3 — Breakdown count
- [ ] **Attendu** : "{X} traités · {Y} rejetés · {Z} en attente" en mono gray

### §A7 — Risk Box

#### A7.1 — Score 0 (compte fiable)
- [ ] **Attendu** :
  - Fond blanc neutre
  - Gauge ●○○ (1 dot rempli) — wait, score 0 = ○○○
  - "Aucun antécédent. Compte fiable." en gray-500
  - Pas de warning

#### A7.2 — Score 1 (à surveiller)
- [ ] **Attendu** : Gauge ●○○ (1 rempli en gray-800), "Score à surveiller. Suspension à 3 confirmés en 30j."

#### A7.3 — Score 2 (suspension imminente si traité)
- [ ] **Attendu** :
  - Fond `bg-niqo-coral/5 border-niqo-coral/30`
  - Gauge ●●○ (2 rempli en coral)
  - Warning rouge "⚠ Suspension auto si ce signalement est confirmé"

#### A7.4 — Score 3+ ou compte suspendu
- [ ] **Attendu** :
  - Fond `bg-niqo-danger/5 border-niqo-danger/30`
  - Badge "SUSPENDU" danger en haut à droite
  - Texte "Compte déjà suspendu — pas d'impact supplémentaire."

### §A8 — Décision sur le signalement (Rejeter / Marquer traité)

#### A8.1 — État repos
- [ ] **Attendu** : 2 boutons côte-à-côte
  - Rejeter (outline gris, icône XCircle)
  - Marquer comme traité (success plein vert, icône CheckCircle2)

#### A8.2 — Tap Rejeter → preview impact
- [ ] **Attendu** :
  - Card expand vers le bas
  - Header "REJET — IMPACT" gris
  - 3 bullets gris : "Aucun changement", "Signaleur PAS notifié", "Marqué faux positif"
  - Footer `↳ {cibleLabel}` en gray
  - 2 boutons : Annuler (outline) + Confirmer (gris-foncé bg-niqo-gray-800)

#### A8.3 — Tap Marquer comme traité (cas score < 2 → pas de suspend)
- [ ] **Préalable** : cible avec `score_abus = 0` ou `1`
- [ ] **Attendu** :
  - Card expand
  - Header "TRAITEMENT — IMPACT" success vert
  - Bullets : score `1 → 2` (ou `0 → 1`), "Signaleur PAS notifié"
  - Pas de warning suspend
  - Bouton Confirmer = `bg-niqo-success`

#### A8.4 — Tap Marquer comme traité (cas score 2 → suspend imminent)
- [ ] **Préalable** : cible avec `score_abus = 2` (utiliser SQL pour bump si besoin :
  `update users set score_abus=2 where id='b9226543-…';`)
- [ ] **Attendu** :
  - Card expand avec fond `bg-niqo-danger/5 border-niqo-danger/30`
  - Header "TRAITEMENT — IMPACT" danger
  - Bullet "Score abus : `2` → `3`" (le 3 en danger)
  - **Warning rouge AlertTriangle** "Compte suspendu automatiquement (seuil 3 atteint)"
  - Bouton Confirmer = `bg-niqo-danger` (rouge plein, plus visible)

#### A8.5 — Annuler depuis preview
- [ ] **Marche à suivre** : tap Annuler dans le preview
- [ ] **Attendu** : revient en mode 2 boutons repos. Pas de RPC appelée.

#### A8.6 — Confirmer flow nominal
- [ ] **Marche à suivre** : tap Confirmer
- [ ] **Attendu** :
  - Bouton spinner "Traitement…" / "Rejet…"
  - DB : `signalements.statut` mis à jour, `updated_at` rempli
  - Trigger `fn_signalement_check_threshold` fire (mig 25) si traité → `users.score_abus +1`, `users.nb_signalements +1`
  - Page recharge → bloc "Confirmé" / "Rejeté" remplace les boutons (DecidedBlock)
  - Liste signalements (autre onglet) : count "en_attente" décrémenté

#### A8.7 — Race condition (déjà traité)
- [ ] **Préalable** : signalement déjà traité (manuellement passer à `statut='traite'` via SQL puis retourner à la page sans recharger)
- [ ] **Marche à suivre** : tap Confirmer (l'UI était encore en mode boutons)
- [ ] **Attendu** : toast/banner erreur "Ce signalement a déjà été traité. Recharge la page." (RPC raise `SIGNALEMENT_NOT_PENDING`)

### §A9 — Action sur la cible : Suspendre l'annonce

#### A9.1 — Bouton visible (annonce active)
- [ ] **Préalable** : signalement type annonce, annonce `statut='active'`
- [ ] **Attendu** :
  - Section "ACTION SUR LA CIBLE" sous Decision (séparée par border-top)
  - Bouton outline rouge "Suspendre l'annonce" avec icône ShieldOff

#### A9.2 — Tap → preview impact
- [ ] **Marche à suivre** : tap "Suspendre l'annonce"
- [ ] **Attendu** :
  - Card expand avec fond `bg-niqo-danger/5 border-niqo-danger/30`
  - Header "SUSPENDRE L'ANNONCE — IMPACT" danger + icône AlertOctagon
  - 4 bullets rouge :
    - "L'annonce passe en statut 'suspendue'"
    - "Disparaît de Home / Search / catégorie"
    - "Le vendeur peut toujours la voir mais ne peut plus l'éditer"
    - "Action réversible (réactivation manuelle SQL)"
  - Footer `↳ Action immédiate, indépendante du signalement`

#### A9.3 — Confirmer → suspend
- [ ] **Marche à suivre** : tap Confirmer
- [ ] **Attendu** :
  - Spinner "En cours…"
  - DB : `annonces.statut = 'suspendue'`, `updated_at` rempli
    ```sql
    select id, titre, statut from public.annonces where id = '<ANNONCE_ID>';
    ```
  - Page recharge (revalidatePath) → bouton remplacé par bloc "Annonce déjà suspendue" gray

#### A9.4 — Cible déjà suspendue (état terminal)
- [ ] **Préalable** : annonce avec `statut = 'suspendue'`
- [ ] **Attendu** : bloc gris affiché directement, sans bouton (pas de re-suspend possible)

#### A9.5 — Side-effect côté mobile
- [ ] **Marche à suivre** : depuis l'app mobile (compte autre que vendeur), Accueil / Search
- [ ] **Attendu** : annonce N'APPARAÎT PLUS dans les listes. RLS `annonces_read_active` filtre `statut = 'active'`.

### §A10 — Trigger auto-suspend (via score_abus)

#### A10.1 — 3 traités successifs → suspend auto
- [ ] **Préalable** : un user X cible, score 0, is_active=true. 3 signalements pending sur X.
- [ ] **Marche à suivre** : depuis admin, marquer les 3 comme "Traité" l'un après l'autre
- [ ] **Attendu** :
  - Après 1er traite : `users.score_abus = 1`, `is_active = true`
  - Après 2e : `score_abus = 2`, `is_active = true`
  - Après 3e : `score_abus = 3`, `is_active = false` (trigger `fn_check_score_abus` mig 28)

#### A10.2 — Trigger NE FIRE PAS sur rejete
- [ ] **Préalable** : score 0 sur user X
- [ ] **Marche à suivre** : créer un signalement, le rejeter
- [ ] **Attendu** : `users.score_abus` reste à 0 (le trigger fn_signalement_check_threshold filtre `if NEW.statut != 'traite' or OLD.statut = 'traite' then return`)

#### A10.3 — Suspend manuel via mig 57 (avant seuil)
- [ ] **Préalable** : user X avec score 0
- [ ] **Marche à suivre** : (côté DB)
  ```sql
  -- Simuler appel admin_suspend_user via SQL
  -- Note : cette RPC est exposée côté UI seulement pour les autres types,
  -- mais on peut la tester directement
  select admin_suspend_user('<USER_X_ID>');
  ```
- [ ] **Attendu** : `is_active = false` immédiatement, sans incrémenter score_abus

### §A11 — Cible introuvable (edge case)

#### A11.1 — Annonce supprimée entre signalement et modération
- [ ] **Préalable** :
  1. Créer un signalement sur une annonce
  2. Supprimer l'annonce (côté vendeur ou admin SQL)
- [ ] **Marche à suivre** : ouvrir la page détail
- [ ] **Attendu** :
  - Card cible remplacée par `CibleIntrouvableCard`
  - Fond `bg-niqo-coral/5 border-niqo-coral/30`
  - Icône AlertTriangle dans bulle 48px
  - Titre "Annonce supprimée" / "Utilisateur introuvable" / "Message supprimé" selon target_type
  - Suggestion "Tu peux rejeter ce signalement (probablement obsolète)"
  - **Important** : la section "Action sur la cible" est cachée (rien à suspendre)
  - Decision (Rejeter / Traiter) reste disponible

### §A12 — Empty state liste

#### A12.1 — DB vide
- [ ] **Préalable** : `delete from public.signalements;` (en SQL Editor)
- [ ] **Marche à suivre** : `/admin/signalements`
- [ ] **Attendu** : empty state avec icône Flag + "Aucun signalement" + "Tout est calme côté modération."

---

## §S — Sécurité (RLS + RPCs)

### S1 — User normal ne peut voir que ses propres signalements
- [ ] **Préalable** : connecté user A non-admin via SQL Editor "Run as authenticated"
- [ ] **Marche à suivre** :
  ```sql
  select count(*) from public.signalements;
  ```
- [ ] **Attendu** : count = uniquement les rows de A (policy `signalements_select_own`)

### S2 — Admin voit tous les signalements
- [ ] **Marche à suivre** : même query connecté admin
- [ ] **Attendu** : count complet (policy `signalements_admin_select` mig 56)

### S3 — Admin peut SELECT annonces tous statuts
- [ ] **Préalable** : annonce avec `statut='suspendue'` ou `'expiree'`
- [ ] **Marche à suivre** : SQL admin
  ```sql
  select id, statut from public.annonces where statut <> 'active';
  ```
- [ ] **Attendu** : visible (policy `annonces_admin_select` mig 56). Sans, RLS `annonces_read_active` aurait filtré.

### S4 — Admin peut SELECT messages hors conv
- [ ] **Marche à suivre** : SQL admin sur des messages d'une conv où il n'est pas participant
- [ ] **Attendu** : visible (policy `messages_admin_select` mig 56)

### S5 — Non-admin appelant admin_treat_signalement
- [ ] **Marche à suivre** : SQL connecté non-admin :
  ```sql
  select admin_treat_signalement('<SIG_ID>', 'traite');
  ```
- [ ] **Attendu** : exception `ADMIN_REQUIRED` (errcode P0002)

### S6 — Non-admin appelant admin_suspend_annonce
- [ ] **Attendu** : idem, `ADMIN_REQUIRED`

### S7 — Admin tente de se suspendre lui-même
- [ ] **Marche à suivre** :
  ```sql
  select admin_suspend_user('<TON_ADMIN_UID>');
  ```
- [ ] **Attendu** : exception `CANNOT_SUSPEND_SELF` (errcode P0004)

### S8 — Cible inexistante
- [ ] **Marche à suivre** :
  ```sql
  select admin_suspend_annonce('00000000-0000-0000-0000-000000000000');
  ```
- [ ] **Attendu** : exception `ANNONCE_NOT_FOUND` (errcode P0003)

### S9 — Idempotence suspend
- [ ] **Préalable** : annonce déjà `statut='suspendue'`
- [ ] **Marche à suivre** : `select admin_suspend_annonce('<ID>');`
- [ ] **Attendu** : pas d'exception (no-op silencieux). Cf. logique mig 57.

### S10 — Anti-spoofing submit_report (cible inexistante)
- [ ] **Marche à suivre** : appeler RPC submit_report avec un target_id bidon
- [ ] **Attendu** : `target_not_found` retourné dans le jsonb

---

## §E — E2E intégration (scénarios bout-en-bout)

### E1 — Signalement express (mobile → admin)
- [ ] **Marche à suivre** :
  1. Mobile (signaleur) : signaler une annonce de vendeur, motif "Article frauduleux"
  2. Admin web : recharger `/admin/signalements`
  3. Cliquer sur la nouvelle row
- [ ] **Attendu** : signalement apparaît immédiatement (pas de cache stale, server component re-fetch)

### E2 — Modération valide → score user incrémenté
- [ ] **Préalable** : E1 OK, score actuel du vendeur = 0
- [ ] **Marche à suivre** : admin tap "Marquer comme traité" → Confirmer
- [ ] **Attendu** :
  - DB `signalements.statut='traite'`
  - DB `users.score_abus=1`, `users.nb_signalements=1`
  - Risk Box affiche désormais ●○○
  - Annonce du vendeur reste visible côté mobile (pas suspendue)

### E3 — Signal grave : suspendre annonce + traiter
- [ ] **Préalable** : nouveau signalement sur autre annonce
- [ ] **Marche à suivre** :
  1. Admin tap "Suspendre l'annonce" → Confirmer (cf §A9)
  2. Recharger
  3. Admin tap "Marquer comme traité" → Confirmer
- [ ] **Attendu** :
  - DB `annonces.statut='suspendue'` ET `signalements.statut='traite'`
  - Côté mobile (autre user) : annonce invisible Home/Search
  - Côté mobile (vendeur owner) : annonce visible dans "Mes annonces" avec badge suspendue

### E4 — Auto-suspend après 3 traités
- [ ] **Préalable** : 3 signalements pending sur un même vendeur (3 cibles différentes ou 3 signaleurs différents — anti-doublon)
- [ ] **Marche à suivre** : admin traite les 3 dans /admin/signalements/<id> un par un
- [ ] **Attendu** :
  - Après le 3e : `users.score_abus = 3`, `is_active = false`
  - Risk Box affiche fond danger + badge "SUSPENDU"
  - Côté mobile vendeur : login bloqué / banner "Compte suspendu"

### E5 — Faux positif (signaleur troll)
- [ ] **Préalable** : signaleur a déjà 3 rejets et 0 traités (= "Faible fiabilité (rejets)")
- [ ] **Marche à suivre** : il signale à nouveau
- [ ] **Attendu** : verdict "Faible fiabilité (rejets)" visible côté admin → admin alerté qu'il peut probablement rejeter

### E6 — Re-soumission après rejet (anti-doublon revisité)
- [ ] **Marche à suivre** : signaleur signale annonce X → admin rejette → signaleur tente de re-signaler annonce X
- [ ] **Attendu** : anti-doublon DB toujours actif → "Tu as déjà signalé cet élément." (le UNIQUE constraint ne distingue pas par statut)

---

## §R — Reset entre tests

```sql
-- Reset complet d'un signalement (revenir à 'en_attente' pour re-tester)
update public.signalements
   set statut = 'en_attente', updated_at = now()
 where id = '<SIG_ID>';

-- Reset score user (test §A10)
update public.users
   set score_abus = 0, nb_signalements = 0, is_active = true, updated_at = now()
 where id = '<USER_ID>';

-- Réactiver une annonce suspendue
update public.annonces
   set statut = 'active', updated_at = now()
 where id = '<ANNONCE_ID>';

-- Restaurer un message soft-deleted
update public.messages
   set is_deleted = false
 where id = '<MSG_ID>';

-- Suppression complète des signalements d'un signaleur (repartir à zéro)
delete from public.signalements where signaleur_id = '<UID>';
```

---

## Récap pré-MVP — checklist exhaustive

Pour considérer F08 "go" :

**DB / RPCs**
- [ ] §0 Pré-flight (mig 56 + 57 jouées)
- [ ] §S1-S2 RLS user vs admin
- [ ] §S5-S9 RPCs sécurisées + idempotentes

**Mobile signaleur**
- [ ] §M1.2 Signaler annonce flow nominal
- [ ] §M1.3 Anti-doublon
- [ ] §M2.1 Anti-self
- [ ] §M3.1 Signaler message

**Admin liste**
- [ ] §A1.2 Avatars + pseudos
- [ ] §A1.4-A1.5 Filtres + search
- [ ] §A1.7 Empty state

**Admin détail**
- [ ] §A2.3 Bande narrative
- [ ] §A3-A5 3 variants cible
- [ ] §A6.2 4 verdicts fiabilité
- [ ] §A7.3 Risk warning suspend imminent
- [ ] §A8.4 Preview impact avec gauge changement

**Admin actions**
- [ ] §A8.6 Décision flow OK
- [ ] §A9.3 Suspendre annonce flow OK
- [ ] §A10.1 Auto-suspend à 3 traités

**E2E**
- [ ] §E1 Mobile → admin instant
- [ ] §E3 Suspendre + traiter cumulatif
- [ ] §E4 Auto-suspend chain
