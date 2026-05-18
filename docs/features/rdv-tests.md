# Module RDV — Scénarios de test

> Créé le **2026-05-02**. Feature **F05 Confirmation RDV** (CDC v4.0).
> Méthodologie : CLAUDE.md §Tests — un test à la fois, OK/KO, fix avant de passer au suivant.
> Prérequis : migration 35 jouée, dev build (ou Expo Go), **2 comptes connectés** sur 2 appareils (ou 1 appareil + 1 simu) avec une conversation existante entre eux.
>
> ⚠️ **Ce fichier couvre la v1 (migs 35-39) + ajouts mode Immo (A0, migs 100-102) + section H rapide pour la v2.** Pour les tests **complets v2** (anti-fraude rencontre mutuelle migs 86→98 : disputed, photos, signalement contextualisé, bannière Home, verdict côté user, etc.), le plan structuré et à jour est dans **`docs/features/rdv-trust-v2-test-plan.md`** (8 blocs, glossaire, reset DB inclus).

## Setup attendu

- Compte **A** = acheteur (a contacté le vendeur depuis une annonce)
- Compte **B** = vendeur (propriétaire de l'annonce)
- 1 conversation déjà ouverte entre A et B avec quelques messages texte échangés
- Au moins 1 message reçu de chaque côté (pour vérifier que le rendu système ne casse pas le rendu texte)

---

## A0 — Mode Immo : pas de RDV (mig 100)

> Règle métier : les annonces de catégorie **Immobilier** (mode Immo, `type_offre IS NOT NULL`) ne supportent pas le système de RDV. Visites de logement / signature de bail se gèrent en messagerie pure et hors plateforme.

### A0.1 — Pas de bandeau "Proposer un RDV" sur conversation immo
- [x] **Préalable** : Marie (compte A) crée une annonce **Immobilier** (catégorie Immobilier, type_offre = location ou vente). Jean (compte B) la contacte → conv créée.
- [x] **Marche à suivre** : Jean ouvre la conv côté B, Marie ouvre la conv côté A
- [x] **Attendu** : aucun bandeau coral "Proposer un RDV" visible côté A ni côté B (le bouton est masqué via `convInfo.is_immo`). La conversation est purement textuelle. ✅ 2026-05-09

### A0.2 — Comparaison avec une conv non-immo
- [x] **Préalable** : Marie crée aussi une annonce non-immo (ex : Téléphones). Jean la contacte → 2e conv créée.
- [x] **Marche à suivre** : Jean ouvre les 2 conversations, l'une après l'autre
- [x] **Attendu** : la conv de l'annonce **non-immo** affiche bien le bandeau "Proposer un RDV", la conv **immo** ne l'affiche pas. Différence évidente entre les 2 écrans. ✅ 2026-05-09

### A0.3 — Defense in depth backend (mig 100)
- [x] **Préalable** : Jean a la conv immo ouverte (sans bandeau RDV)
- [x] **Marche à suivre** : tester l'appel RPC `propose_rdv` directement via SQL Editor admin (ou Postman avec son JWT) sur la conv immo
  ```sql
  select public.propose_rdv(
    '<conv-immo-uuid>'::uuid,
    'Visite appartement',
    now() + interval '2 days'
  );
  ```
- [x] **Attendu** : retour `{"success": false, "error": "IMMO_NO_RDV"}`. Aucune ligne `rdv_*` mise à jour dans `conversations`. Aucun message système inséré. ✅ 2026-05-09 — **couvert par pgTAP Test 20** (`tests/sql/rdv.test.sql:354`)

### A0.4 — Conseils de sécurité adaptés (ChatSafetyTips immo)
- [x] **Préalable** : Jean ouvre la conv immo pour la première fois
- [x] **Marche à suivre** : observer le bandeau coral en haut de la conv (sous le header annonce), tap dessus pour le déplier
- [x] **Attendu** :
  - Titre : **"Conseils anti-arnaque immobilière"** (pas "Conseils de sécurité pour le RDV")
  - 5 tips orientés visite + paiement traçable + anti-arnaque (visite physique obligatoire, pièce d'identité du proprio, pas de caution avant visite, prix anormalement bas, paiements traçables)
  - Numéros d'urgence Police/Gendarmerie (CI) ou Urgences (CG) toujours présents en bas
  - Bouton "J'ai lu, ne plus afficher" → dismiss persistant par convId ✅ 2026-05-09

### A0.5 — Comparaison avec une conv non-immo
- [x] **Préalable** : Jean a une autre conv (sur annonce non-immo)
- [x] **Marche à suivre** : ouvrir les 2 conversations l'une après l'autre, déplier le bandeau dans chacune
- [x] **Attendu** : titre + tips différents entre les 2 conv. Conv classique → "Conseils de sécurité pour le RDV" + 5 tips orientés rencontre. Conv immo → titre + tips immo. Le dismiss d'une conv ne dismisses pas l'autre. ✅ 2026-05-09

### A0.6 — Vendeur immo peut marquer vendue/louée à tout moment (mig 101)
> Bug fix : avant la mig 101, `mark_annonce_vendue` exigeait une rencontre confirmée (mig 88). Or en mode immo il n'y a jamais de RDV (mig 100) → vendeur immo bloqué jusqu'à expiration auto à 60j.
- [x] **Préalable** : Marie (compte A, vendeur) a au moins 1 annonce immo `active` (créée pour A0.1) — peu importe qu'il y ait des conversations ou non, peu importe leur état
- [x] **Marche à suivre** :
  1. Marie ouvre `/announce/{id}` de son annonce immo
  2. Observer les CTAs en bas de l'écran
- [x] **Attendu** :
  - Bouton vert visible : libellé **"Marquer comme louée"** si type_offre=location, **"Marquer comme vendue"** si type_offre=vente
  - Tap → Alert "Marquer comme louée ? / vendue ?" avec [Non] / [Oui, louée/vendue]
  - Tap "Oui" → annonce passe en statut `vendue` (DB) → écran refresh, badge en haut affiche **"Louée"** (vert) si location, **"Vendue"** sinon ✅ 2026-05-09
- [x] **Sub-test régression non-immo** : ouvrir une annonce **non-immo** active (Téléphones, sans aucun RDV confirmé)
  - **Attendu** : aucun bouton "Marquer vendue" visible (`hasMeetingConfirmed=false`). Régression mig 101 OK. ✅ 2026-05-09
- [x] **Sub-test annonce vendue côté acheteur** : Jean (compte B) ouvre l'annonce immo désormais marquée vendue
  - **Attendu** : footer affiche "Cette annonce a été louée" (location) / "Cette annonce a été vendue" (vente). Pas de bouton "Contacter". ✅ 2026-05-09

---

## A — Proposer un RDV (happy path)

### A1 — Bouton "Proposer un RDV" visible quand pas de RDV
- [x] **Préalable** : ouvrir la conversation côté A (et côté B) ✅ 2026-05-02
- [x] **Marche à suivre** : observer le bandeau juste sous le header
- [x] **Attendu** : bandeau coral clair "Proposer un RDV" avec icône calendrier, des deux côtés

### A2 — Ouvrir le sheet de proposition
- [x] **Préalable** : A1 ✅
- [x] **Marche à suivre** : côté A, tap sur "Proposer un RDV"
- [x] **Attendu** : modal slide-up avec titre "Proposer un RDV", champ Date+Heure (boutons date / heure), champ Lieu, CTAs [Annuler] [Proposer]. Date par défaut = demain 14h00. Champ lieu vide. ✅ 2026-05-02 — fix contraste picker iOS (textColor + themeVariant light + bg white)

### A3 — Choisir une date+heure (iOS)
- [x] **Préalable** : sheet ouvert ✅
- [x] **Marche à suivre** : tap sur la pill date → overlay calendrier natif → choisir. Idem pill heure → wheel.
- [x] **Attendu** : date et heure se mettent à jour indépendamment, pas de bug epoch ✅ 2026-05-02 — refactoré en 2 pickers `display="compact"` côte à côte (1er essai en spinner avec mode-switch buggait, iOS firait un onChange epoch au remount)

### A3-bis — Choisir date+heure (Android)
- [ ] **N/A pour cette session — testé uniquement iOS** (à valider sur Android au build dev client)

### A4 — Saisir un lieu
- [x] **Préalable** : sheet ouvert ✅
- [x] **Marche à suivre** : taper "Marché de Cocody, devant la pharmacie" dans le champ lieu
- [x] **Attendu** : compteur "39/100" affiché en bas. Le bouton Proposer passe en coral plein. ✅ 2026-05-02 — fix KeyboardAvoidingView (le clavier cachait l'input)

### A5 — Soumettre la proposition (côté A — acheteur)
- [x] **Préalable** : date demain 14h00 + lieu rempli ✅
- [x] **Marche à suivre** : tap "Proposer"
- [x] **Attendu** :
  1. Le sheet se ferme
  2. Un nouveau message système apparaît dans le chat : "<Prénom A> propose un RDV le DD/MM/YYYY à 14h00 à Marché de Cocody, devant la pharmacie" — texte centré, fond coral clair, pas de bulle
  3. Le bandeau passe à l'état "En attente de confirmation" avec date+lieu et boutons [Modifier] [Annuler] ✅ 2026-05-02

### A6 — Réception côté B (Realtime)
- [x] **Préalable** : A5 venant de partir, conversation B ouverte ✅
- [x] **Marche à suivre** : observer côté B sans rien toucher
- [x] **Attendu** :
  1. Le message système apparaît dans le chat (Realtime)
  2. Le bandeau passe à "<Prénom A> propose un RDV ... — DD/MM/YYYY à 14h00 ..." avec boutons [Refuser] [Confirmer] ✅ 2026-05-02 — Realtime conv + messages fonctionnent

---

## B — Confirmer un RDV

### B1 — Confirmer côté B
- [x] **Préalable** : RDV proposé par A, état "proposed" côté B ✅
- [x] **Marche à suivre** : tap "Confirmer" sur le bandeau
- [x] **Attendu** :
  1. Bouton passe en spinner court (~500ms)
  2. Message système "RDV confirmé à ..." (sans date/heure depuis mig 36)
  3. Bandeau passe en vert "RDV confirmé" + date+lieu + bouton "Annuler le RDV" ✅ 2026-05-02

### B2 — Sync côté A (proposeur)
- [x] **Préalable** : B1 ✅
- [x] **Marche à suivre** : observer A sans rien toucher
- [x] **Attendu** :
  1. Message système "RDV confirmé à ..." apparaît
  2. Bandeau passe au même état vert "RDV confirmé" avec bouton "Annuler le RDV" ✅ 2026-05-02

### B3 — Le proposeur ne peut pas s'auto-confirmer
- [x] **Préalable** : redémarrer le scénario A1→A5, puis côté A (proposeur), aucun bouton "Confirmer" ne doit être visible ✅
- [x] **Attendu** : côté proposeur on voit "En attente de confirmation" + [Modifier]/[Annuler], **jamais** [Confirmer]. Si on appelle l'RPC manuellement avec le compte A, l'erreur `cannot_self_confirm` doit revenir. ✅ 2026-05-02 — vérifié implicitement pendant A/B (jamais de bouton Confirmer côté proposeur)

---

## C — Modifier / re-proposer

### C1 — Modifier la proposition (sheet pré-rempli)
- [x] **Préalable** : RDV proposé par A, pas encore confirmé ✅
- [x] **Marche à suivre** : côté A, tap "Modifier" sur le bandeau
- [x] **Attendu** : sheet s'ouvre pré-rempli avec la date et le lieu actuels ✅ 2026-05-02

### C2 — Re-proposer écrase la précédente
- [x] **Préalable** : C1 ✅
- [x] **Marche à suivre** : changer la date/lieu, tap "Proposer"
- [x] **Attendu** :
  1. Nouveau message système "<Prénom A> a proposé un RDV à <nouveau lieu>"
  2. Bandeau reflète la nouvelle proposition
  3. Côté B : reçoit le nouveau message + bandeau mis à jour avec la nouvelle date/lieu ✅ 2026-05-02

### C3 — On ne peut pas modifier après confirmation
- [x] **Préalable** : RDV confirmé (état après B1/B2) ✅
- [x] **Marche à suivre** : aucun bouton "Modifier" visible. Si on tente l'RPC propose_rdv → erreur
- [x] **Attendu** : côté UI, on voit uniquement [Annuler le RDV]. L'erreur RPC `rdv_already_confirmed` doit revenir si appelée directement. ✅ 2026-05-02

---

## D — Annuler

### D1 — Annuler une proposition (proposeur)
- [x] **Préalable** : RDV proposé par A, pas confirmé ✅
- [x] **Marche à suivre** : côté A, tap "Annuler" → confirmer dans l'Alert
- [x] **Attendu** :
  1. Message système "<Prénom A> a annulé le RDV"
  2. Bandeau revient à "Proposer un RDV"
  3. Côté B : sync via Realtime (message + bandeau) ✅ 2026-05-02

### D2 — Refuser une proposition (autre partie)
- [x] **Préalable** : RDV proposé par A, état "proposed" côté B ✅
- [x] **Marche à suivre** : côté B, tap "Refuser" → confirmer dans l'Alert
- [x] **Attendu** : message "<Prénom B> a annulé le RDV" + bandeau revient à "Proposer un RDV" des deux côtés ✅ 2026-05-02

### D3 — Annuler après confirmation (les deux côtés)
- [x] **Préalable** : RDV confirmé (B1/B2 OK) ✅
- [x] **Marche à suivre** : côté A ou B, tap "Annuler le RDV" → confirmer
- [x] **Attendu** : message "<Prénom> a annulé le RDV" + retour à "Proposer un RDV" des deux côtés. On doit pouvoir re-proposer immédiatement. ✅ 2026-05-02

---

## E — Validations & erreurs

### E1 — Lieu vide
- [x] **Marche à suivre** : ouvrir le sheet, ne rien taper dans lieu, tap "Proposer"
- [x] **Attendu** : bouton "Proposer" reste grisé tant que `lieu.trim() === ""` ✅ 2026-05-02

### E2 — Lieu max 100 chars
- [x] **Marche à suivre** : taper plus de 100 caractères dans le lieu
- [x] **Attendu** : champ s'arrête à 100, compteur "100/100" ✅ 2026-05-02

### E3 — Date trop proche (< 30 min)
- [x] **Marche à suivre** : choisir une heure dans 5 minutes, lieu valide, tap "Proposer"
- [x] **Attendu** : Alert "Date trop proche" / "Le RDV doit être au moins 30 minutes après maintenant." (ou erreur RPC `date_too_soon` si on bypass la validation client) ✅ 2026-05-02

### E4 — Coupure réseau pendant l'envoi
- [ ] **Marche à suivre** : couper le wifi, tap "Proposer"
- [ ] **Attendu** : Alert d'erreur ("Connexion lente" ou similaire), pas de message système, pas de mise à jour locale

---

## F — Intégration avec le chat existant

### F1 — Les messages système ne déclenchent pas le menu long-press
- [x] **Marche à suivre** : long-press sur un message système RDV
- [x] **Attendu** : aucun menu Copier/Signaler n'apparaît (le rendu spécial n'inclut pas la Pressable de menu) ✅ 2026-05-02

### F2 — Le filtre de contenu n'attaque pas les messages système
- [ ] **Préalable** : la migration 35 a remplacé `fn_messages_content_filter` pour ignorer `type='systeme'`
- [ ] **Marche à suivre** : proposer un RDV avec un lieu qui contient un mot du seed banni (ex : "Marché bombe artisanal" — `bombe` est dans la liste mots_interdits)
- [ ] **Attendu** : le RDV est proposé sans erreur (les RPC servent le texte serveur, et le filtre s'éteint pour `systeme`). Le mot interdit n'est pas dans le texte de l'utilisateur lui-même mais dans le lieu — donc accepté.
- ℹ️ Note : le **lieu** lui-même n'est pas filtré par le content filter (c'est une colonne sur conversations, pas dans messages). Le seul check sur le lieu est la longueur. C'est OK pour MVP.

### F3 — Le preview de la conversation list montre le dernier message système
- [x] **Marche à suivre** : confirmer un RDV → revenir à `/messages` (liste)
- [x] **Attendu** : la conv concernée affiche en preview "RDV confirmé à ..." (acceptable MVP) ✅ 2026-05-02

### F4 — Pagination "load more" ne casse pas les messages système
- [ ] **Marche à suivre** : avoir >30 messages dans la conv (avec un message système ancien) → scroll vers le haut pour charger les plus anciens
- [ ] **Attendu** : les messages système anciens s'affichent correctement (centrés, pas de bulle), pas de crash

---

## G — Edge cases (à tester si le temps le permet)

### G1 — Annonce supprimée pendant un RDV proposé
- [ ] **Marche à suivre** : RDV proposé → vendeur supprime l'annonce → ouvrir la conv
- [ ] **Attendu** : conversation supprimée en cascade (FK CASCADE) — l'écran chat retournera vers `/messages`. Le RDV disparaît avec.

### G2 — Compte suspendu pendant un RDV
- [ ] **Marche à suivre** : suspendre le compte A (DB direct) → ouvrir la conv côté B
- [ ] **Attendu** : conv reste accessible côté B. Côté A, l'app le déconnecte au prochain refresh. RDV reste tel quel.

### G3 — Re-proposition avec timezone différente
- [ ] **Marche à suivre** : utilisateur en CI (UTC+0) propose un RDV → utilisateur "voyageur" (timezone autre) reçoit
- [ ] **Attendu** : la date affichée peut différer (le format client utilise `toLocaleDateString`). Acceptable car la majorité reste en CI/CG (UTC+0/+1). À documenter en cas de retour utilisateur.

---

## H — RDV trust v2 (PR1 mig 86-90 + PR2 mig 91 + PR3 mig 92 + D mig 93)

### H1 — Signalement contextualisé post-RDV (mig 91)
- [x] **Setup** : 2 iPhones, RDV passé sur une conv. Acheteur dit "Oui on s'est vu", vendeur dit "Non". État dérivé : **disputed** (bandeau orange). ✅ 2026-05-09 (hack rdv_date via SQL)
- [x] **Marche à suivre** : taper "Signaler ce RDV" depuis le bandeau disputed côté acheteur
- [x] **Attendu** : modal s'ouvre avec 7 motifs sélectables (Absent au RDV, Produit ne correspond pas, Produit défectueux, Tentative de fraude, Comportement dangereux, Complot suspecté, Autre) ✅ 2026-05-09
- [x] **Sub-test** : sélectionner "Autre" + description vide + Envoyer → erreur "Décris la situation pour ce motif" ✅ 2026-05-09
- [x] **Sub-test** : sélectionner "Tentative de fraude" + Envoyer → toast "Signalement envoyé. Notre équipe l'examinera sous 48h." ✅ 2026-05-09
- [x] **Sub-test** : retenter → modal montre "already_reported" (anti-doublon) ✅ 2026-05-09
- [x] **Vérif admin web** : aller sur `/admin/signalements` → la file affiche le signalement avec badge "RDV", motif "Tentative de fraude", chip cible "RDV" ✅ 2026-05-09
- [x] **Vérif admin détail** : ouvrir `/admin/signalements/{id}` → voir RdvPostTargetCard avec motif typé + annonce (statut) + RDV date/lieu + état rencontre des 2 parties + parties impliquées + snapshot info banner ✅ 2026-05-09
- [x] **Vérif fraude warning** : section "auto-action" rouge visible (motif fraude → annonce sera suspendue si traité) ✅ 2026-05-09
- [x] **Action admin** : taper "Marquer comme traité" → preview montre "Annonce auto-suspendue (motif fraude)" → confirmer ✅ 2026-05-09
- [x] **Vérif post-traitement** :
  - Annonce passe à `statut='suspendue'` (visible côté admin + côté vendeur dans son dashboard)
  - Score abus du vendeur incrémenté de +1
  - Push notif au signaleur "Signalement pris en compte" ✅ 2026-05-09

### H2 — Photos post-RDV (mig 92)
- [x] **Setup** : RDV passé, état `met` (les 2 ont confirmé) OU `disputed` ✅ 2026-05-09 (réutilisation conv `disputed` de H1)
- [x] **Marche à suivre** : taper "+ Ajouter" dans le bloc "Preuves photo (0/5)"
- [x] **Attendu** : permission caméra demandée la 1ère fois → caméra native s'ouvre (PAS de menu galerie possible — anti-spoof) ✅ 2026-05-09
- [ ] **Sub-test** : refuser permission → toast "Permission caméra refusée. Active-la dans les réglages." (non testé — couvert par étape autorisation)
- [x] **Sub-test** : capturer 1 photo → upload (loading spinner) → thumbnail apparaît dans le bloc ✅ 2026-05-09
- [x] **Sub-test** : taper la thumbnail → lightbox plein écran s'ouvre (image + bouton X) ✅ 2026-05-09
- [x] **Sub-test** : ajouter 5 photos au total → bouton "+ Ajouter" disparaît, message "Limite de 5 photos atteinte" affiché ✅ 2026-05-09
- [x] **Vérif anti-revanche** : se connecter avec l'autre partie de la conv (2e iPhone) → ouvrir la même conv → bloc "Preuves photo" affiche **0 photos** (les photos de l'autre partie ne sont PAS visibles) ✅ 2026-05-09
- [x] **Vérif admin viewer** : sur le signalement post-RDV correspondant (admin web), voir la section "Preuves photo · X" avec grid 3 colonnes + badge role_auteur (acheteur=vert / vendeur=noir) ✅ 2026-05-09
- [x] **Vérif admin tap** : taper une photo → ouvre signed URL dans nouvel onglet (image visible 1h max) ✅ 2026-05-09

### H3 — Bannière Home actions pendantes (mig 93)
- [x] **Setup vendeur** : avoir une annonce statut='en_cours' avec ≥1 conv en état `met` (ach=true ET vend=true) ✅ 2026-05-09 (réutilisation conv `disputed` H1 — type d'action `disputed` priorité 1 testé)
- [x] **Marche à suivre** : ouvrir Home (en étant authentifié)
- [x] **Attendu** : bannière "X actions en attente" sous HomeHeader, avec card horizontale orange/coral/success/black selon type ✅ 2026-05-09
- [ ] **Sub-test 'mark_vendue'** : si annonce en_cours met → card "Marque ton annonce vendue" → tap → ouvre `/announce/{id}` (non testé — annonce non-immo H1 a été suspendue, plus en `en_cours met`)
- [ ] **Sub-test 'rencontre'** : si RDV passé sans réponse Oui/Non → card "Tu as rencontré quelqu'un ?" → tap → ouvre `/messages/{conv_id}` (non testé — déjà résolu en `disputed` pour la conv H1)
- [x] **Sub-test 'disputed'** : si désaccord → card orange "Désaccord à signaler" en première position (priority 1) → tap → conv ✅ 2026-05-09 (côté Jean ET côté Marie)
- [ ] **Sub-test 'avis'** : si conv `met` sans avis posé (< 7j post-décision) → card "Note {prénom}" → tap → conv (non testé — pas d'état `met` sur cette session)
- [ ] **Sub-test ordering** : si plusieurs actions, vérifier que disputed (1) → rencontre (2) → mark_vendue (3) → avis (4) dans l'ordre (1 seule action en cours sur la session)
- [ ] **Sub-test dédup mark_vendue** : si une annonce a 3 conv en met → 1 seule card mark_vendue (pas 3) (non testé — voir sub-test mark_vendue)
- [ ] **Sub-test refetch** : faire l'action (ex : noter via le bandeau chat) → revenir Home → la card "avis" disparait au focus (non testé — voir sub-test avis)
- [x] **Sub-test anonyme** : se déconnecter → bannière entièrement masquée (pas même le titre) ✅ 2026-05-09

### H4 — Crons backend (mig 87 + mig 90) — non testable manuel iPhone
> Les crons (rencontre-reminder + mark-vendue-reminder) tournent à 10h UTC daily. Pour les tester :
> - **Option A — manuel SQL** : exécuter `select public.fn_push_rencontre_reminder();` ou `select public.fn_push_mark_vendue_reminder();` directement dans Supabase SQL Editor → vérifier que le push est reçu sur l'iPhone si conv éligible
> - **Option B — couvert pgTAP** : `tests/sql/rencontre.test.sql` Bloc 9 + Bloc 10 vérifient le counter increment, le filtre is_active, la fenêtre temporelle ✅ couvert pgTAP

### H5 — Sécurité chat (PR1.8 — bandeau ChatSafetyTips)
- [x] **Marche à suivre** : ouvrir une conversation pour la 1ère fois (cleared AsyncStorage)
- [x] **Attendu** : bandeau orange "Conseils de sécurité pour le RDV" visible entre le header et les bandeaux RDV ✅ 2026-05-09
- [x] **Sub-test expand** : taper le bandeau → 5 conseils affichés + numéros urgence selon pays user (CI : Police 110 / Gendarmerie 185 ; CG : Urgences 117) ✅ 2026-05-09
- [x] **Sub-test tap-to-call** : taper un numéro → app téléphone s'ouvre avec le numéro pré-rempli ✅ 2026-05-09
- [x] **Sub-test dismiss** : taper "J'ai lu, ne plus afficher" → bandeau disparaît ✅ 2026-05-09
- [x] **Sub-test persistence** : fermer l'app → relancer → revenir sur la même conv → bandeau toujours masqué (AsyncStorage par conv) ✅ 2026-05-09
- [x] **Sub-test autre conv** : ouvrir une **autre** conversation → bandeau réapparaît (dismiss est par conv, pas global) ✅ 2026-05-09
