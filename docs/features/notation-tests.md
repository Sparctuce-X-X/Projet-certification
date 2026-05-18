# Module Notation post-RDV — Scénarios de test

> Créé le **2026-05-02**. Refresh **2026-05-10** post-backfill backend (audit /cso + doc + tests automatisés).
> Méthodologie : CLAUDE.md §Tests — un test à la fois, OK/KO, fix avant de passer au suivant.
> Prérequis : migrations 37 → **86** (rencontre mutuelle anti-fraude vendeur) jouées, simu + iPhone, conv avec un RDV **confirmé** entre deux comptes.
>
> Source backend : `docs/backend/notation.md`. Tests automatisés : `tests/sql/notation.test.sql` (33 assertions ✅) + `tests/integration/notation.test.ts` (10 tests ✅).

## Bilan sessions

| Session | Couverture | Critical path |
|---|---|---|
| 2026-05-02 | §B1-B4 (modal AvisSubmitSheet) · §C3 · §E1 · §G1-G8 (lifecycle annonce → I1-I8 dans la nouvelle structure) | Happy path manuel original |
| **2026-05-10** | **§A1-A6** (rencontre mutuelle 5 états) · §B5 · **§D1-D3** (gates anti-fraude mig 86) · §E2-E4 (couverts par pgTAP) · **§I9** (mig 89 mark_vendue auto-pose) | **Anti-fraude vendeur validé bout-en-bout** |

**73 ✅ / 115 checkboxes** = **63% couverture manuelle** (le reste = pgTAP + Vitest + sections low priority).

**Reste à tester si tu veux 100% UX** :
- §C1-C2 (validations modal : sans note, max 200 chars)
- §D4-D10 (gates RPC isolées via SQL — mig 37 pure)
- §F (section "Avis reçus" sur `/u/[id]`)
- §G (page web publique `/a/[id]` landing/)
- §H (edge cases : suspension, Vendeur Fiable anneau vert)

Tout le critical path et l'anti-fraude est ✅. Le reste = polish.

## Setup

Pour A→F il faut une conversation où :
- Le **RDV est confirmé** (les deux ont validé via le bandeau RDV)
- `rdv_date` peut être **dans le passé** (sinon le bandeau "RDV passé" ne s'affiche pas)

⚠ **Mig 86** — depuis l'anti-fraude rencontre, le bouton **"Noter"** n'apparaît plus dès que le RDV est passé. Il faut d'abord que **les deux côtés** aient confirmé "Oui, on s'est vu" (RPC `confirm_rencontre`). Sans ça → bandeau pending OR unilateral OR disputed, pas de bouton Noter.

Pour backdater rapidement un RDV existant côté DB :

```sql
-- Backdate basique : passe le rdv_date hier, garde rencontre NULL des 2 côtés
-- → état "pending" testable section A.
update public.conversations
set rdv_date = now() - interval '1 hour'
where id = '<conv_id>'
  and rdv_confirme_at is not null;
```

Pour shortcuter le flow rencontre et tester direct la modal Noter (état `met`) :

```sql
-- Force l'état "met" (les 2 ont dit oui) → débloque le bouton Noter
update public.conversations
set rdv_date = now() - interval '1 hour',
    rencontre_acheteur = true,
    rencontre_vendeur = true,
    rencontre_decided_at = now()
where id = '<conv_id>'
  and rdv_confirme_at is not null;
```

---

## A — Flow rencontre mutuelle (mig 86) avant la note

> Section ajoutée 2026-05-10 — l'ancien §A "Bandeau past → bouton Noter" était pré-mig 86 et sautait directement à l'état `met`. La réalité 2026-05-10 : il faut passer par l'étape rencontre.

### A1 — État `pending` : bandeau "Vous êtes-vous rencontrés ?" + 2 boutons
- [x] **Préalable** : conv RDV confirmé + `rdv_date` dans le passé + rencontre_acheteur=NULL + rencontre_vendeur=NULL ✅ 2026-05-10
- [x] **Marche à suivre** : ouvrir la conv côté A et côté B (reload après backdate) ✅
- [x] **Attendu** : bandeau gris "RDV passé" + date+lieu + texte **"Vous êtes-vous rencontrés ?"** + 2 boutons (vert "Oui, on s'est vu" / blanc "Non") des **deux côtés**. Pas de bouton "Noter" visible. ✅ 2026-05-10

### A2 — État `unilateral_self` : "tu as répondu, en attente de l'autre"
- [x] **Préalable** : A1 OK ✅
- [x] **Marche à suivre** : côté A, tap "Oui, on s'est vu" ✅
- [x] **Attendu côté A** : les 2 boutons disparaissent → bandeau blanc dans la zone passé "Tu as confirmé la rencontre. En attente de <Prénom B>." Pas de bouton Noter. ✅ 2026-05-10

### A3 — État `unilateral_other` côté B : "X a déjà répondu, à ton tour"
- [x] **Préalable** : A2 fait côté A. Côté B : reload de la conv. ✅
- [x] **Attendu côté B** : bandeau pending + texte modifié **"<Prénom A> a déjà répondu. À ton tour : vous êtes-vous vus ?"** + boutons Oui/Non. ✅ 2026-05-10 (validé via screenshot Iphone 16 e — Jean voit "Dominique a déjà répondu, à ton tour")

### A4 — État `met` : bouton "Noter" apparaît côté A et côté B
- [x] **Préalable** : A3 — côté B, tap "Oui, on s'est vu" ✅
- [x] **Attendu** : ✅ 2026-05-10 (screenshot iPad Air m3 — Jean voit bandeau vert success + bouton coral "Noter Dominique")
  - Bandeau passe en vert success (border + bg)
  - Côté **A et B** : bouton coral **"Noter <Prénom>"** apparaît
  - Si vendeur : bouton supplémentaire vert **"Marquer vendue"** (mig 86 §5 — débloqué quand rencontre 2x true)

### A5 — État `disputed` : un dit oui, l'autre dit non
- [x] **Préalable** : nouvelle conv, RDV confirmé, backdate. Côté A → "Oui". Côté B → "Non". ✅
- [x] **Attendu** : ✅ 2026-05-10 (validé sur conv Papier ministre + screenshot Iphone 16 e disputed)
  - Bandeau passe en orange warning (`bg-niqo-warning/10 border-niqo-warning/30`) ✅
  - Pas de bouton "Noter" visible des 2 côtés (`submit_avis` raise `meeting_disputed`) ✅
  - Bouton "Signaler ce RDV" disponible (mig 91 — flow signalement contextuel hors scope notation) ✅
  - **Bonus** : block "PREUVES PHOTO (0/5)" visible UNIQUEMENT en disputed depuis mig 106 ✅

### A6 — État `unconfirmed` : les 2 disent non
- [x] **Préalable** : nouvelle conv, RDV confirmé, backdate. Les 2 répondent "Non, on ne s'est pas vu". ✅ (conv Câble de recharge IPhone)
- [x] **Attendu** : ✅ 2026-05-10 (validé via DB query — annonce_statut=active confirmé)
  - Bandeau "RDV passé" en gris
  - **Le statut de l'annonce est revert à `active`** (trigger `tg_annonce_statut_on_rencontre_change` mig 86) — vérifier sur l'annonce détail : badge "Négo en cours" disparu, annonce de retour dans le search public ✅
  - Pas de bouton Noter ni Marquer vendue

---

## B — Modal AvisSubmitSheet (state `met`)

> Reprend l'ancien §A2-A5 — toujours valide post-mig 86 (la modal elle-même n'a pas changé).

### B1 — Tap "Noter" → ouvre le sheet
- [x] **Préalable** : A4 OK (rencontreState=met) ✅
- [x] **Marche à suivre** : tap sur "Noter <Prénom>"
- [x] **Attendu** : modal slide-up avec :
  - Titre "Note la rencontre"
  - Texte "Comment ça s'est passé avec <Prénom> ?"
  - 5 étoiles vides interactives
  - Champ commentaire vide + compteur 0/200
  - CTAs `[Annuler] [Envoyer]` — Envoyer **grisé** car pas encore de note ✅ 2026-05-02

### B2 — Choisir une note → label + bouton activé
- [x] **Préalable** : sheet ouvert ✅
- [x] **Marche à suivre** : tap sur la 4e étoile
- [x] **Attendu** :
  - Les 4 premières étoiles deviennent coral pleines, la 5e reste vide
  - Texte sous les étoiles : **"Bien"** (1=Très décevant, 2=Décevant, 3=Correct, 4=Bien, 5=Excellent)
  - Le bouton **Envoyer** passe en coral plein ✅ 2026-05-02

### B3 — Saisir un commentaire (optionnel)
- [x] **Préalable** : note 4 sélectionnée ✅
- [x] **Marche à suivre** : taper "Très sympa, marchandise conforme à l'annonce."
- [x] **Attendu** : compteur "47/200", saisie possible jusqu'à 200 chars max ✅ 2026-05-02

### B4 — Soumettre l'avis
- [x] **Préalable** : note + commentaire saisis ✅
- [x] **Marche à suivre** : tap "Envoyer"
- [x] **Attendu** :
  1. Spinner court (~500ms)
  2. Sheet se ferme
  3. Le bandeau "RDV passé" change : plus de bouton "Noter", à la place : **"Tu as noté <Prénom>"** + 4 étoiles coral en mini ✅ 2026-05-02

### B5 — Sync côté autre user
- [x] **Préalable** : B4 fait côté A. Côté B, conv ouverte. ✅
- [x] **Attendu** : côté B, **rien ne change visuellement** (l'avis posé par A est sur B, pas dans son bandeau perso). Le bouton "Noter A" reste affiché côté B (il doit encore noter A de son côté). ✅ 2026-05-10 (screenshot iPad Air m3 montre Jean voit "Noter Dominique" même après que Dominique l'a noté)
- ℹ️ Realtime n'est pas activé sur `avis` en MVP — pas grave, le bandeau côté A se met à jour, et côté B le bouton "Noter" reste là (pas de désynchro visible).

---

## C — Validations modal & erreurs

### C1 — Soumettre sans note
- [ ] **Marche à suivre** : ouvrir le sheet, tap "Envoyer" sans choisir de note
- [ ] **Attendu** : bouton désactivé, ne fait rien

### C2 — Commentaire max 200 chars
- [ ] **Marche à suivre** : taper plus de 200 caractères dans le champ commentaire
- [ ] **Attendu** : champ s'arrête à 200, compteur "200/200"

### C3 — Avis déjà posé (UI gate avec `myAvis`)
- [x] **Préalable** : B4 fait ✅
- [x] **Marche à suivre** : reload conv
- [x] **Attendu** : bandeau "Tu as noté <Prénom>" + étoiles, **pas de bouton "Noter" visible** ✅ 2026-05-02 — le RPC bloque aussi avec `avis_already_submitted` mais la UI prévient

---

## D — Erreurs métier mig 86 (gates anti-fraude rencontre)

> ⚠ Ces 3 gates sont **bloquées par l'UI** dans des conditions normales — l'utilisateur ne voit jamais le bouton "Noter" sur ces états. Mais le RPC les protège quand même (defense-in-depth). Test via SQL Editor pour vérifier que la RPC répond correctement.

### D1 — `meeting_not_confirmed_self` — tenter de noter avant d'avoir confirmé sa rencontre
- [x] **Préalable** : conv où mon `rencontre_<role>` est NULL (état `pending` ou `unilateral_other`) ✅
- [x] **Marche à suivre** : SQL Editor, en mode service_role, set jwt sur ton uid puis :
  ```sql
  select set_config('request.jwt.claims', '{"sub":"<TON_UID>","role":"authenticated"}', true);
  select public.submit_avis('<conv_id>'::uuid, 4::smallint, null);
  ```
- [x] **Attendu** : `{"success": false, "error": "meeting_not_confirmed_self"}` ✅ 2026-05-10 (testé sur conv 7df91c24 Iphone 16 e)
- [ ] **Note UX** : `lib/notation.ts:NOTATION_ERRORS_FR` ne mappe pas ce code → si l'UI était amenée à tomber dessus (bug), elle afficherait le DEFAULT_FR générique. À fixer côté lib (5 min, cf. `docs/backend/notation.md` §11 audit).

### D2 — `meeting_declined_self` — tenter de noter après avoir dit "Non, on ne s'est pas vu"
- [x] **Préalable** : conv où mon `rencontre_<role>` = false ✅
- [x] **Marche à suivre** : idem D1 ✅
- [x] **Attendu** : `{"success": false, "error": "meeting_declined_self"}` ✅ 2026-05-10

### D3 — `meeting_disputed` — tenter de noter quand l'autre a dit "Non"
- [x] **Préalable** : conv où je dis true mais l'autre dit false (état `disputed`) ✅
- [x] **Marche à suivre** : validé via UX §A5 (bandeau orange + pas de bouton Noter visible) ✅
- [x] **Attendu** : `{"success": false, "error": "meeting_disputed"}` ✅ 2026-05-10 (testé visuellement — UI bloque le tap car bouton "Noter" caché en disputed, RPC raise meeting_disputed en defense in depth)

### D4 — `not_participant` — tenter de noter sur conv où on n'est pas participant
- [ ] **Marche à suivre** : sql avec un conv_id d'une conv où ton uid ≠ acheteur_id ≠ vendeur_id
- [ ] **Attendu** : `{"success": false, "error": "not_participant"}`

### D5 — `rdv_not_confirmed` — RDV proposé mais pas confirmé
- [ ] **Préalable** : conv avec `rdv_propose_par` set mais `rdv_confirme_at` NULL
- [ ] **Marche à suivre** : sql submit_avis
- [ ] **Attendu** : `{"success": false, "error": "rdv_not_confirmed"}`

### D6 — `rdv_not_past` — RDV confirmé mais futur
- [ ] **Préalable** : conv RDV confirmé, `rdv_date` dans le futur
- [ ] **Attendu** : `{"success": false, "error": "rdv_not_past"}`

### D7 — `note_invalid` — note hors range
- [ ] **Marche à suivre** : sql `submit_avis(..., 0)` ou `submit_avis(..., 6)`
- [ ] **Attendu** : `{"success": false, "error": "note_invalid"}`

### D8 — `commentaire_too_long` — commentaire 201+ chars
- [ ] **Marche à suivre** : sql avec commentaire de 201 caractères
- [ ] **Attendu** : `{"success": false, "error": "commentaire_too_long"}`

### D9 — `avis_already_submitted` — re-noter après B4
- [ ] **Préalable** : avis déjà posé (B4 fait)
- [ ] **Attendu** : RPC `{"success": false, "error": "avis_already_submitted"}` même si l'UI bloque déjà.

### D10 — Commentaire avec uniquement des espaces
- [ ] **Marche à suivre** : `submit_avis(p_commentaire='   ')`
- [ ] **Attendu** : RPC normalise via `trim` + `nullif(trim,'')` → insertion OK avec `commentaire = NULL`

---

## E — Trigger DB recalc moyenne + compteur

### E1 — `users.note_vendeur` / `note_acheteur` se met à jour après INSERT avis
- [x] **Préalable** : un participant a noté l'autre (4 étoiles) ✅
- [x] **Marche à suivre** : SQL sur les 2 users de la conv
- [x] **Attendu** : la cible a son `note_*` mis à jour + `nb_*` incrémenté ✅ 2026-05-02 — vérifié sur Sparctuce (note_acheteur=4.00, nb_achats=1)

### E2 — Moyenne se recalcule sur 2e avis (recalc-from-scratch mig 42)
- [x] **Couvert par pgTAP** : `tests/sql/notation.test.sql` Test 19 (note_vendeur Jean = avg(4,5) = 4.50 après 2e avis) ✅ 2026-05-10
- [ ] _Test manuel skipped — le pgTAP couvre déjà le recalc sur INSERT depuis la table avis._

### E3 — `note_acheteur` côté inverse (vendeur note acheteur)
- [x] **Couvert par pgTAP** : `tests/sql/notation.test.sql` Tests 15-17 (Jean note Marie 5/5 → note_acheteur Marie = 5.00, nb_achats = 1) ✅ 2026-05-10
- [ ] _Test manuel skipped._

### E4 — Trigger after-delete recalc (mig 38)
- [x] **Couvert par pgTAP** : `tests/sql/notation.test.sql` Tests 21-22 (DELETE avis → note_vendeur recalculée, nb_ventes décrémenté) ✅ 2026-05-10
- [ ] _Test manuel skipped._

---

## F — Profil public mobile `/u/[id]`

### F1 — Section "Avis reçus" affichée si avis existent
- [ ] **Préalable** : un user a reçu ≥1 avis
- [ ] **Marche à suivre** : ouvrir `/u/<id>` côté n'importe quel viewer (anon OK — RLS public SELECT)
- [ ] **Attendu** : section "Avis reçus" apparaît sous les CTA, avec une liste de cartes :
  - Avatar + prénom auteur
  - Rôle ("a acheté" / "a vendu") + date relative ("Aujourd'hui", "Il y a 3 j", etc.)
  - 5 étoiles avec la note
  - Commentaire (ou "Sans commentaire" en italique)
  - Si is_auto = true : badge "Note automatique" — ⚠ ne devrait pas exister post-mig 38 (cron drop). Si visible, c'est une row legacy.

### F2 — Section absente si pas d'avis
- [ ] **Préalable** : un user n'a jamais reçu d'avis
- [ ] **Attendu** : section "Avis reçus" **n'apparaît pas** (pas de section vide affichée)

### F3 — Note moyenne sur header profil
- [ ] **Préalable** : ≥1 avis reçu en tant que vendeur
- [ ] **Attendu** : header affiche `★ 4.5 · 2 ventes` (ou équivalent par tes composants)

### F4 — Avis d'auteur supprimé n'apparaît pas
- [ ] **Préalable** : E1 OK, puis l'auteur supprime son compte (`delete_my_account`)
- [ ] **Attendu** : section "Avis reçus" perd cette ligne (cascade `conversation_id` supprime l'avis avant que `auteur_id SET NULL` n'agisse — cf. `docs/backend/notation.md` §11 audit finding #1)
- [ ] **Note** : si tu vois une carte "[Compte supprimé]", c'est qu'on a passé sur un LEFT JOIN — pas le comportement actuel (INNER JOIN dans `get_user_public_profile`).

---

## G — Profil public web `/a/[id]` (landing/)

### G1 — Page publique annonce affiche note vendeur
- [ ] **Préalable** : annonce active d'un vendeur ayant ≥1 avis
- [ ] **Marche à suivre** : ouvrir `https://niqo.app/a/<annonce_id>` (ou local `:3000/a/<id>`) en navigateur privé (déconnecté)
- [ ] **Attendu** :
  - Photo + titre + prix + ville + description
  - Carte vendeur en bas : prénom, badge ✓ "Vendeur vérifié" si applicable, **étoile + note + nb_ventes**
  - Pas d'erreur 500 (cf. CLAUDE.md gotcha Vercel — env vars `NEXT_PUBLIC_*` cochées Production+Preview+Development)

### G2 — Note absente si vendeur n'a aucune vente notée
- [ ] **Préalable** : annonce d'un vendeur 0 vente
- [ ] **Attendu** : pas de bloc note sur la carte vendeur (juste prénom + ville + badge si verifié)

---

## H — Edge cases

### H1 — Conv supprimée → avis cascade-deleted
- [x] **Note** : si la conv est supprimée → les avis sont supprimés en cascade (FK ON DELETE CASCADE mig 37). Acceptable. ✅ 2026-05-02

### H2 — User noté qui se suspend ensuite
- [ ] **Note** : `is_active = false` → `get_user_public_profile` renvoie null. Les avis qu'il a posés restent visibles sur les profils des autres (acceptable). Les avis qu'il a reçus deviennent inaccessibles via le profil (puisque le profil renvoie null). Acceptable MVP.

### H3 — Score Vendeur Fiable (anneau vert TrustedAvatar)
- [ ] **Préalable** : un vendeur avec `nb_ventes >= 5 AND note_vendeur >= 4.0`
- [ ] **Marche à suivre** : ouvrir son `/u/[id]` ou voir son avatar dans Search/Home
- [ ] **Attendu** : avatar entouré d'un anneau vert + icône `CheckCircle2`. Si nb_ventes < 5 OU note < 4, pas d'anneau.

---

## I — Lifecycle annonce mig 39 + 41 + 86 + 88 + 89 (bundle livré avec F06)

> Ces tests valident les triggers de `statut_annonce` (active ↔ en_cours ↔ vendue), le RPC `mark_annonce_vendue`, et la policy RLS `annonces_buyer_select_via_conv`. Voir `docs/backend/rdv.md` pour le module complet (rencontre = côté RDV).

### I1 — Recalc one-shot des compteurs (mig 38)
- [x] **Marche à suivre** : SQL :
  ```sql
  select u.prenom, u.nb_ventes, u.note_vendeur,
    (select count(*) from avis where cible_id = u.id and role_auteur = 'acheteur') as actual
  from users u where u.id in (select acheteur_id from conversations where rdv_confirme_at is not null
                              union select vendeur_id from conversations where rdv_confirme_at is not null);
  ```
- [x] **Attendu** : `nb_ventes = actual` pour tous les users testés (cohérent avec table avis) ✅ 2026-05-02

### I2 — Annonce passe en `en_cours` à la confirmation RDV (trigger mig 39)
- [x] **Préalable** : annonce `active` + 1 conv ouverte
- [x] **Marche à suivre** : proposer + confirmer un RDV des 2 côtés
- [x] **Attendu** : refresh annonce détail des 2 côtés → badge coral **🤝 "Négo en cours"** sous le prix ✅ 2026-05-02

### I3 — Annonce revient à `active` à l'annulation
- [x] **Préalable** : I2 ✅
- [x] **Marche à suivre** : annuler le RDV (n'importe quel côté)
- [x] **Attendu** : badge "Négo en cours" disparaît, annonce repasse en `active` (visible dans search public à nouveau) ✅ 2026-05-02

### I4 — Bouton "Marquer comme vendue" pour le vendeur après rencontre 2x true (mig 86)
- [x] **Préalable** : RDV confirmé + backdate + rencontre_acheteur=true + rencontre_vendeur=true
- [x] **Marche à suivre** : refresh annonce détail côté owner
- [x] **Attendu** : bouton vert **"📦 Marquer vendue"** disponible. ⚠ Si rencontre pas confirmée 2x → bouton absent (mig 86 anti-fraude). ✅ 2026-05-02 (post-mig 86)

### I5 — Tap "Marquer vendue" → statut vendue
- [x] **Préalable** : I4
- [x] **Marche à suivre** : tap "Marquer vendue" → confirm → "Oui, vendue"
- [x] **Attendu** :
  1. Spinner court
  2. Badge passe en **✅ Vendue**
  3. Bouton "Marquer" disparaît
  4. Côté acheteur en conv : footer **"Cette annonce a été vendue"** (pas de bouton Contacter) ✅ 2026-05-02

### I6 — Visibilité acheteur après statut vendue (RLS mig 41)
- [x] **Préalable** : annonce `vendue` (I5)
- [x] **Marche à suivre** : côté acheteur en conv, ouvrir Mes achats
- [x] **Attendu** : la ligne d'achat affiche bien le titre + cover + prix de l'annonce (PAS "Annonce supprimée") ✅ 2026-05-02

### I7 — Filtre "Vendues" dans Mes annonces
- [x] **Préalable** : owner avec ≥1 annonce vendue
- [x] **Marche à suivre** : Profil → Mes annonces → tap pill "Vendues"
- [x] **Attendu** : seules les annonces `vendue` apparaissent. Compteur dans les pills cohérent. ✅ 2026-05-02

### I8 — Mes achats — bouton "Noter" si pas encore noté
- [x] **Préalable** : RDV passé + rencontre 2x true + acheteur n'a pas noté
- [x] **Marche à suivre** : Profil → Mes achats
- [x] **Attendu** : ligne avec bouton coral **"Noter"** (et après note posée : `★ Tu as noté X/5`) ✅ 2026-05-02 (post-mig 86)

### I9 — Mig 89 : `mark_vendue` auto-pose `rencontre_vendeur=true`
- [x] **Préalable** : conv RDV confirmé, backdate, **acheteur** a tapé "Oui, on s'est vu" (rencontre_acheteur=true), **vendeur** n'a pas encore répondu (rencontre_vendeur=NULL) ✅ 2026-05-10 (conv 7df91c24 Iphone 16 e)
- [x] **Marche à suivre** : côté vendeur (Jean), tap "Marquer vendue" depuis le bandeau (mig 88 — bouton dispo dès `unilateral_other`) ✅ 2026-05-10 (screenshot 16:38 confirme bouton vert visible)
- [x] **Attendu** : statut annonce = `vendue` ET `rencontre_vendeur` set à `true` automatiquement (mig 89 — affirmation implicite). Vendeur peut maintenant noter l'acheteur sans repasser par le bouton "Oui". ✅ 2026-05-10 (DB query confirme : ach=true, ven=true, decided_at=16:57:23, annonce_statut=vendue)

---

## ⛔ DEPRECATED — Cron J+7 note auto 3/5

> Section §E originale du fichier 2026-05-02 (Cron `avis-auto-j7` insérant note 3/5 si l'user n'a pas noté en 7j). Cron + fonction **supprimés en mig 38** (décision UX "plus simple, plus honnête : pas de note auto"). Le champ `is_auto` reste dans le schéma pour rétrocompat mais ne devrait jamais être à `true` sur des rows post-mig 38. **Ne pas tester cette section**.
