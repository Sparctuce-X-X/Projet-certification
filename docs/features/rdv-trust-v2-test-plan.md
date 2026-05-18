# Test plan UX — RDV trust v2 (PR1 → D + mig 95-96)

> Test plan complet pour valider sur **2 iPhones** tout le scope RDV livré (migs 86 → 96).
> À suivre dans l'ordre. Durée estimée : **~2h30** (~15-20 min par bloc).
>
> Feedback à reporter au fil : ✅ ok / ⚠️ détail UX à fixer / ❌ bug bloquant.
>
> **Mise à jour 2026-05-08** : ajout mig 95 (admin revert annonce) + mig 96 (bandeau résolu + filtre Home banner) → blocs 4.6, 4.7, 5.6, 6.7 ajoutés. Reset DB en setup pour repartir clean.

---

## Setup commun (à faire une seule fois — repartir de zéro)

### Devices
- **Device A** = iPhone (réel ou simu) → compte **Marie** (acheteuse, pays CI, +225)
- **Device B** = autre iPhone (réel ou simu) → compte **Jean** (vendeur, pays CI, +225)

### Préalables
- [ ] Builds récents sur les 2 devices (post-mig 95/96 — restart les apps après upload du nouveau code)
- [ ] Connexion Wi-Fi stable, pas de mode avion
- [ ] **Marie** et **Jean** sont 2 comptes Google distincts (pas même Apple ID partagé)
- [ ] Notifications push activées sur les 2 devices (sinon tester quand même mais sans push)
- [ ] Pour les tests admin web : avoir **Dominique admin** prêt sur ordi (`/admin/login`)
- [ ] Migs 86 → 96 toutes jouées en prod (vérifier via Supabase Dashboard)

### Reset DB pour repartir clean (recommandé avant Bloc 1)
Si tu as déjà des données de test précédentes, exécute ces queries dans Supabase SQL Editor pour repartir vraiment de zéro :

```sql
-- 1. Supprime toutes les conv Marie ↔ Jean (cascade messages, rdv, rencontre, photos)
delete from public.conversations
where (acheteur_id = '<UID_Marie>' and vendeur_id = '<UID_Jean>')
   or (acheteur_id = '<UID_Jean>' and vendeur_id = '<UID_Marie>');

-- 2. Supprime toutes les annonces de test de Jean (libère le namespace)
delete from public.annonces where vendeur_id = '<UID_Jean>' and titre like '%test%';

-- 3. Reset compteurs Marie + Jean
update public.users
set score_abus = 0, nb_signalements = 0, nb_ventes = 0, nb_achats = 0,
    note_vendeur = 0, note_acheteur = 0, is_active = true
where id in ('<UID_Marie>', '<UID_Jean>');

-- 4. Supprime les avis croisés Marie ↔ Jean (au cas où)
delete from public.avis
where (auteur_id = '<UID_Marie>' and cible_id = '<UID_Jean>')
   or (auteur_id = '<UID_Jean>' and cible_id = '<UID_Marie>');

-- 5. Supprime les signalements Marie/Jean (et historique)
delete from public.signalements
where signaleur_id in ('<UID_Marie>', '<UID_Jean>');
```

> ⚠ Remplace `<UID_Marie>` et `<UID_Jean>` par les vrais UID. Récupère-les via `select id, prenom from public.users where prenom in ('Marie', 'Jean');`

### État DB initial à créer (après reset)
1. [Device B / Jean] Créer une annonce **« iPhone test trust v2 »** (catégorie Téléphones, prix 100 000 FCFA, ville Abidjan, état Bon, ajouter **2-3 photos** pour tester la galerie admin)
2. Vérifier qu'aucune conversation Marie ↔ Jean n'existe encore

### Glossaire d'états (migs 86 + 96)
- **pending** : RDV passé, ni Marie ni Jean n'ont répondu Oui/Non
- **unilateral_self** : moi j'ai répondu, en attente de l'autre
- **unilateral_other** : l'autre a répondu, à moi de répondre
- **met** : les 2 ont dit "Oui on s'est vu" → débloque mark_vendue + notation
- **disputed** : 1 dit Oui, 1 dit Non → tout bloqué + bandeau orange + signaler
- **unconfirmed** : les 2 ont dit "Non" → annonce revert active
- **admin_resolved** *(mig 96)* : un signalement post-RDV sur la conv a été décidé par l'admin (traite OU rejete) → `admin_signalement_decided_at` set → bandeau gris "examiné par l'équipe Niqo", card "disputed" disparaît du Home banner

### Glossaire migrations couvertes
| Mig | Sujet | Couverture test |
|---|---|---|
| 86 | Confirmation mutuelle post-RDV | S3.1, S3.2, S4.1, S8.1, S8.2 |
| 87 | Cron rencontre reminder + reset propose/cancel | S7, S8.1 |
| 88 | mark_vendue voix acheteur seule | S3.2 (bouton dispo dès ach=true) |
| 89 | mark_vendue auto-confirm vendeur | S3.3 (msg système + Realtime sync) |
| 90 | Cron mark_vendue reminder | S7 |
| 91 | Signalement contextualisé post-RDV | S4.2-S4.5 |
| 92 | Photos post-RDV anti-fraude | S5.1-S5.5 |
| 93 | RPC bannière Home actions | S6.1-S6.6 |
| **95** | **Admin revert annonce à active** | **S4.6** |
| **96** | **admin_signalement_decided_at + UX résolu** | **S4.7, S5.6, S6.7** |
| **97** | **Rappels push J-1 + H-2 avant RDV confirmé** | **S2.4** |
| **98** | **Verdict signalement visible côté user (closure)** | **S4.8** |
| PR1.8 | ChatSafetyTips | S1.1-S1.3 |

---

## Bloc 1 — Conseils sécurité chat (PR1.8)

> Cible : `components/chat/ChatSafetyTips.tsx`

### S1.1 — Premier ouvre conversation
- [ ] [Marie / A] Browse Home → tap annonce **« iPhone test trust v2 »** → tap **"Contacter le vendeur"**
- [ ] [Marie / A] Envoyer "Bonjour, l'iPhone est dispo ?" → conv créée
- [ ] **Attendu** : bandeau **coral light** "Conseils de sécurité pour le RDV" visible entre header et zone messages
- [ ] **Attendu** : bandeau compact (1 ligne + chevron down)

### S1.2 — Expand + numéros urgence
- [ ] [Marie / A] Tap le bandeau
- [ ] **Attendu** : 5 conseils numérotés affichés
- [ ] **Attendu** : section "NUMÉROS D'URGENCE" avec **Police 110** + **Gendarmerie 185** (CI)
- [ ] [Marie / A] Tap "Police 110" → app téléphone s'ouvre avec 110 pré-composé (annuler l'appel)
- [ ] [Marie / A] Tap "J'ai lu, ne plus afficher" → bandeau disparaît immédiatement

### S1.3 — Persistence dismiss
- [ ] [Marie / A] Fermer l'app (kill swipe up)
- [ ] [Marie / A] Relancer + revenir sur la même conv → bandeau **TOUJOURS masqué** (AsyncStorage)
- [ ] [Marie / A] Si Marie a une autre conv (créer si pas le cas) → bandeau **réapparaît** (dismiss est par conv, pas global)

---

## Bloc 2 — Proposition + confirmation RDV (mig 35)

### S2.1 — Marie propose
- [ ] [Marie / A] Dans la conv, taper **"Proposer un RDV"** (bandeau coral en haut)
- [ ] [Marie / A] Saisir lieu **"Marché de Cocody"** + date dans 2 jours, 18h00 → Envoyer
- [ ] **Attendu A** : message système dans le chat "Marie propose un RDV le ... à Marché de Cocody"
- [ ] **Attendu A** : bandeau gris **"En attente de confirmation"** + détails RDV + boutons Modifier / Annuler

### S2.2 — Jean reçoit + confirme
- [ ] [Jean / B] Push notif reçu **"Marie te propose un RDV"** + corps avec date + lieu
- [ ] [Jean / B] Tap notif → ouvre la conv Marie ↔ Jean
- [ ] **Attendu B** : bandeau coral **"Marie propose un RDV"** + détails + boutons **Refuser** / **Confirmer**
- [ ] [Jean / B] Tap **Confirmer**
- [ ] **Attendu B** : bandeau passe au vert **"RDV confirmé"** avec date + lieu

### S2.3 — Marie reçoit confirmation
- [ ] [Marie / A] Push notif reçu **"RDV confirmé !"** + détails dans la tz d'Abidjan (mig 68)
- [ ] [Marie / A] Bandeau passe au vert **"RDV confirmé"** (Realtime sync sans refresh manuel)
- [ ] **Vérif annonce statut** : aller sur `/announce/[id]` côté Marie → **disparaît du Home** (statut auto `en_cours`, mig 39)

### S2.4 — Rappels push avant RDV (mig 97) — non testable iPhone temps réel
> Les rappels sont déclenchés par le cron horaire `rdv-reminder` qui appelle `fn_push_rdv_reminder()`. Pour les tester manuellement, exécuter le helper côté Supabase SQL Editor.

- [ ] [Dominique / SQL] Force `rdv_date` à `now() + interval '12 hours'` sur la conv puis exécute :
  ```sql
  select public.fn_push_rdv_reminder();
  ```
- [ ] **Attendu Marie + Jean** : push reçu **"Rappel : RDV demain"** + corps avec heure (timezone Abidjan) + lieu
- [ ] **Vérif counter** : `select rdv_reminders_sent from conversations where id = '<conv>';` → **1**
- [ ] [Dominique / SQL] Force `rdv_date` à `now() + interval '1 hour'` puis re-set `rdv_reminders_sent = 1` (le trigger reset à 0 sur change date) puis re-run helper :
  ```sql
  select public.fn_push_rdv_reminder();
  ```
- [ ] **Attendu Marie + Jean** : push reçu **"RDV dans 2h"** + corps "RDV à HHhMM à « lieu »..."
- [ ] **Vérif counter** : `rdv_reminders_sent` = **2**
- [ ] **Edge case rdv_date passé** : force date dans le passé → re-run helper → **aucun push** (filtre `rdv_date > now()`)

---

## Bloc 3 — Confirmation rencontre post-RDV (mig 86 + 88 + 89)

> ⚠️ Pour rendre le RDV "passé" : le plus simple est de modifier `rdv_date` directement dans Supabase Dashboard à une date passée (ou attendre 2 jours réels).

### S3.1 — État pending (les 2 voient les boutons)
- [ ] [Marie / A] Bandeau passe au gris **"RDV passé"** + texte "Vous êtes-vous rencontrés ?" + 2 boutons **Oui / Non** (mig 86)
- [ ] [Jean / B] Idem côté Jean : bandeau pending avec boutons Oui / Non
- [ ] **Vérif anti-buyer-only** : les 2 doivent voir les boutons (correctif mai 2026)

### S3.2 — Marie dit Oui (état unilateral_self / unilateral_other)
- [ ] [Marie / A] Tap **"Oui, on s'est vu"** → confirm Alert → Confirmer
- [ ] **Attendu A** : bandeau passe à un texte info "Tu as confirmé la rencontre. En attente de Jean."
- [ ] **Attendu B Realtime** : Jean voit "Marie a déjà répondu. À ton tour : vous êtes-vous vus ?" (état unilateral_other)
- [ ] **Mig 88 — bouton mark_vendue débloqué côté Jean** : bouton "Marquer vendue" visible côté Jean dans le bandeau (car ach=true vend=null suffit)

### S3.3 — Jean tape mark_vendue depuis le chat (mig 89)
- [ ] [Jean / B] Tap **"Marquer vendue"** → confirm Alert "Ton annonce ne sera plus visible…" → Oui, vendue
- [ ] **Attendu B** : bandeau bascule en `met` (succès) + bouton mark_vendue remplacé par badge "Annonce marquée vendue"
- [ ] **Attendu A Realtime** : Marie voit aussi état met (Jean est passé en rencontre_vendeur=true via auto-confirm mig 89)
- [ ] **Vérif message système** : nouveau msg système dans le chat "Annonce marquée vendue — rencontre confirmée"
- [ ] **Vérif annonce statut** : `/announce/[id]` côté Jean → statut **vendue**

### S3.4 — Notation post-mark_vendue (mig 86 + 89)
- [ ] [Marie / A] Bouton **"Noter Jean"** visible dans le bandeau
- [ ] [Marie / A] Tap → modal "Note la rencontre" avec étoiles 1-5
- [ ] [Marie / A] Note 4★ + commentaire "Très sérieux" → Envoyer
- [ ] **Attendu A** : modal ferme + bandeau affiche "Tu as noté Jean ★★★★☆"
- [ ] [Jean / B] Bouton "Noter Marie" visible côté Jean (note réciproque)
- [ ] [Jean / B] Note 5★ + Envoyer
- [ ] **Vérif profil public** : `/u/[id]` Marie → note acheteur visible (4.0). Idem Jean → note vendeur visible (5.0)
- [ ] [Jean / B] Push notif reçu **"Avis reçu ★★★★☆"** + preview commentaire (mig 67/68)

---

## Bloc 4 — État disputed + signalement contextualisé (mig 91)

> Tu auras besoin d'une nouvelle conv (ou reset rencontre_* via Dashboard).
> Suggestion : créer une 2e annonce **« iPhone test disputed »** côté Jean, refaire propose+confirm RDV puis force date passée.

### S4.1 — Setup disputed
- [ ] Créer 2e conv + RDV passé entre Marie et Jean
- [ ] [Marie / A] Tap **"Oui, on s'est vu"**
- [ ] [Jean / B] Tap **"Non"** (côté Jean) → confirm
- [ ] **Attendu** : bandeau orange "Vous n'êtes pas d'accord sur la rencontre…" + bouton **"Signaler ce RDV"**

### S4.2 — Modal signalement contextualisé (PR2.2)
- [ ] [Marie / A] Tap **"Signaler ce RDV"**
- [ ] **Attendu** : modal bottom sheet avec 7 motifs sélectables :
  - Absent au rendez-vous · Produit ne correspond pas · Produit défectueux · Tentative de fraude · Comportement dangereux · Complot suspecté · Autre
- [ ] [Marie / A] Sélectionner **"Autre"** + description vide → Envoyer
- [ ] **Attendu** : Alert "Description requise"
- [ ] [Marie / A] Re-sélectionner **"Tentative de fraude"** + description "Faux billet" → Envoyer
- [ ] **Attendu** : Alert "Signalement envoyé. Notre équipe l'examinera sous 48h."

### S4.3 — Anti-doublon
- [ ] [Marie / A] Re-tap **"Signaler ce RDV"** → modal réouvert → re-Envoyer
- [ ] **Attendu** : Alert "Tu as déjà signalé ce RDV"

### S4.4 — Admin web : voir le signalement (PR2.3)
- [ ] [Dominique admin / Web] Aller sur `/admin/signalements`
- [ ] **Attendu liste** : nouvelle ligne avec badge cible **"RDV"** (icône CalendarX), motif "Tentative de fraude", statut En attente
- [ ] [Dominique / Web] Tap chevron → ouvre `/admin/signalements/[id]`
- [ ] **Attendu détail** : RdvPostTargetCard affiche :
  - Header bordé orange "RDV signalé" + badge rouge **"Motif fraude"** en haut à droite
  - Section "Motif typé" : **"Tentative de fraude"** (en rouge)
  - Section "Annonce" : titre + statut courant
  - Section "Rendez-vous" : date + lieu
  - Section "État rencontre" : Marie ✅ "On s'est vus", Jean ❌ "Ne s'est pas vu"
  - Section "Parties impliquées" : 2 mini cards avec score abus
  - Bandeau gris snapshot info banner avec date snapshot
  - Bandeau rouge "Auto-action si traité — annonce auto-suspendue"

### S4.5 — Admin valide → auto-suspend annonce
- [ ] [Dominique / Web] Tap **"Marquer comme traité"** → preview affiche "Annonce auto-suspendue (motif fraude)" en rouge → Confirmer
- [ ] **Vérif annonce** : statut passe à **suspendue** (visible dans `/admin/signalements/[id]` après refresh + visible côté Jean dans son dashboard)
- [ ] **Vérif Marie** : push notif reçu **"Signalement pris en compte. Action prise contre l'auteur."**
- [ ] **Vérif score abus Jean** : `/admin/signalements/[id]` Risk Box → score 1/3 (incrémenté)
- [ ] **Vérif mig 96 — bandeau résolu côté chat** : ouvrir la 2e conv côté Marie ET côté Jean → bandeau orange remplacé par **bandeau gris "Ce RDV a été examiné par l'équipe Niqo"** (sans bouton signaler)

### S4.6 — Admin revert annonce à active sur signalement non-fraude (mig 95)
> Cible : RPC `admin_revert_annonce_to_active` + bouton `_revert-annonce-button.tsx` côté admin web
>
> **Préalable** : il te faut un signalement post-RDV avec motif **non-fraude** (`produit_defectueux`, `no_show`, etc.) déjà traité. Si pas le cas, refais un mini-setup :
> 1. Créer 3e annonce Jean **"iPhone test produit défectueux"** (avec 2-3 photos)
> 2. Marie contacte → RDV → Jean confirme → force date passée
> 3. Marie dit Oui, Jean dit Non
> 4. Marie signale → motif **"Produit défectueux"**
> 5. Admin valide (statut → traite). L'annonce reste `en_cours` (pas auto-suspend, motif non-fraude).

- [ ] [Dominique / Web] Hard refresh `/admin/signalements/[id]` du signalement non-fraude
- [ ] **Attendu — galerie photos annonce** : section "Annonce" affiche maintenant un sous-bloc **"Photos de l'annonce (X)"** avec grid 4 colonnes des photos du vendeur. Click photo → ouvre plein écran nouvel onglet (URL publique)
- [ ] **Attendu — bouton revert** : encart "Action sur l'annonce" avec bouton coral **"Remettre l'annonce en vente"** + texte explicatif "Le motif n'est pas typé fraude → l'annonce n'a pas été auto-suspendue..."
- [ ] **Vérif visibilité conditionnelle** : le bouton n'apparaît PAS si :
  - signalement encore `en_attente` (admin pas décidé)
  - motif fraude (auto-suspend déjà fait)
  - annonce déjà `vendue` / `suspendue` / `expiree` / `active`
- [ ] [Dominique / Web] Tap **"Remettre l'annonce en vente"**
- [ ] **Attendu preview** : encart coral avec 4 bullets :
  - Statut `en_cours` → `active`
  - L'annonce redevient visible sur Home + Recherche
  - Le vendeur reçoit un push « Annonce remise en vente »
  - Référence titre annonce
- [ ] [Dominique / Web] Tap **Confirmer**
- [ ] **Attendu** :
  - Spinner → encart vert **"Annonce remise en vente"** + sous-texte "Le vendeur reçoit une notification push."
  - **[Jean / B]** Push notif reçu : **"Annonce remise en vente"** + corps "Ton annonce « iPhone test produit défectueux » est de nouveau visible." + tap → deeplink `/announce/[id]`
  - **[Test 3rd device ou Marie en mode anonyme]** L'annonce **réapparaît sur Home** publique
  - **[Marie / A]** Sur sa propre vue Home → l'annonce reste invisible (RLS lui bloque toujours via la conv en disputed côté son écran — comportement attendu)
- [ ] **Re-tap revert** : si tu cliques à nouveau sur le bouton revert (page non rafraîchie), il devrait tomber sur INVALID_STATE car annonce maintenant active → erreur affichée *"L'annonce est déjà en « active », pas en « en_cours »."*

### S4.7 — Bandeau gris résolu reste après revert annonce (mig 96)
- [x] [Marie / A] Ouvrir la conv concernée → **bandeau gris "examiné par l'équipe Niqo" toujours affiché** (le revert annonce ne touche PAS l'historique conv) ✅ 2026-05-09
- [x] [Marie / A] Vérifier que le bouton "Signaler ce RDV" **ne réapparaît PAS** ✅ 2026-05-09
- [x] [Marie / A] Tenter `mark_vendue` ou `submit_avis` côté Jean → **toujours bloqué** (rencontre disputed) ✅ 2026-05-09
- [x] **Vérif Home banner Marie** : la card "Désaccord à signaler" doit être **absente** de la bannière (signalement traité → admin_signalement_decided_at set → filtre actif) ✅ 2026-05-09 (cf. S6.7)
- [x] **Vérif Home banner Jean** : Jean qui n'a JAMAIS signalé → **pas de card disputed** non plus (admin a tranché → masqué pour les 2) ✅ 2026-05-09 (cf. S6.7)

### S4.8 — Verdict signalement visible côté user (mig 98)
> Closure psychologique : Marie qui a signalé doit voir le verdict admin directement dans le bandeau gris (pas seulement via push éphémère).

- [x] [Marie / A] Ouvrir la conv après que l'admin a validé son signalement
- [x] **Attendu** : sous le texte gris "Ce RDV a été examiné..." apparaît une 2e ligne séparée par un trait :
  - Si **traité** : *"✓ **Ton signalement a été validé.** Motif : Tentative de fraude"* (en vert)
  - Si **rejeté** : *"✗ **Ton signalement a été examiné — non retenu.** Motif : ..."* (en gris)
  - Si encore **en_attente** : *"Ton signalement (« motif ») est en cours d'examen."* (en coral) ✅ 2026-05-09 (testé branche traité ; rejeté + en_attente couverts par les emails)
- [x] **Côté Jean (autre partie sans signalement)** : pas de 2e ligne (anti-leak — Jean ne voit que le bandeau gris générique sans verdict) ✅ 2026-05-09
- [ ] **Edge case admin pas encore décidé mais Marie a signalé** : Marie voit *"en cours d'examen"* (statut=en_attente) (non testé — couvert par les emails verdict)

---

## Bloc 5 — Photos post-RDV (mig 92)

> Reprendre une conv en état met OU disputed (toute conv RDV passé).

### S5.1 — Capture in-app (Marie)
- [ ] [Marie / A] Bandeau RDV passé → bloc **"PREUVES PHOTO (0/5)"** visible
- [ ] [Marie / A] Tap bouton **"+ Ajouter"** (carré coral)
- [ ] **Attendu 1ère fois** : permission caméra demandée → Accepter
- [ ] **Attendu** : caméra native s'ouvre (PAS de menu pour importer galerie — anti-spoof)
- [ ] [Marie / A] Capturer une photo (n'importe quoi, ex : ton bureau) → Use Photo
- [ ] **Attendu** : spinner upload → thumbnail 64×64 apparaît dans le bloc, count "1/5"

### S5.2 — Lightbox preview
- [ ] [Marie / A] Tap thumbnail
- [ ] **Attendu** : modal plein écran noir avec photo en grand + bouton X en haut à droite
- [ ] [Marie / A] Tap X ou tap hors photo → ferme

### S5.3 — Quota max 5
- [ ] [Marie / A] Ajouter 4 photos supplémentaires (5 total)
- [ ] **Attendu** : bouton "+ Ajouter" disparaît, message "Limite de 5 photos atteinte"

### S5.4 — Anti-revanche (Jean ne voit pas les photos de Marie)
- [ ] [Jean / B] Ouvrir la même conv côté Jean
- [ ] **Attendu CRITIQUE** : bloc "PREUVES PHOTO (0/5)" — Jean voit **0 photo** (RLS auteur SELECT own)
- [ ] [Jean / B] Ajouter 1 photo de son côté → count "1/5" côté Jean
- [ ] **Attendu** : Marie ne voit PAS la photo de Jean (et vice versa, anti-revanche bilatérale)

### S5.5 — Admin viewer (PR3.3)
- [ ] [Dominique / Web] Sur le signalement post-RDV correspondant (S4.4) → scroll jusqu'à section **"Preuves photo · X"**
- [ ] **Attendu** : grid 3 colonnes avec thumbnails + badge `acheteur` (vert) ou `vendeur` (noir) en bas à gauche
- [ ] [Dominique / Web] Tap une thumbnail → s'ouvre dans nouvel onglet (signed URL 1h)
- [ ] **Attendu** : photo plein écran dans le navigateur (URL `?token=xxx&expires=xxx`)

### S5.6 — Galerie photos de l'annonce (mig 95 — comparaison preuves)
- [ ] [Dominique / Web] Sur le même signalement → section **"Annonce"** dans la `RdvPostTargetCard`
- [ ] **Attendu** : sous-bloc **"Photos de l'annonce (X)"** avec grid 4 colonnes des photos uploadées par Jean au moment de la création annonce
- [ ] [Dominique / Web] Click une photo → ouvre nouvel onglet plein écran (URL publique, pas signed)
- [ ] **Attendu use case** : tu peux comparer visuellement *"l'annonce montrait un iPhone neuf"* (photos annonce) vs *"l'acheteur a photographié un écran cassé"* (photos rencontre) → décision modération informée
- [ ] **Edge case annonce sans photo** : si l'annonce n'a pas de photo → message *"Aucune photo sur l'annonce."*
- [ ] **Edge case annonce supprimée** : la section reste affichée avec snapshot.annonce_titre + statut, juste pas de photos (pas de crash)

---

## Bloc 6 — Bannière Home actions pendantes (mig 93 + 96)

> Cible : `components/home/HomeActionsBanner.tsx`

### S6.1 — Affichage bannière
- [ ] [Marie / A] Aller sur Home (icône Bottom Nav)
- [ ] **Attendu** : bannière "X actions en attente" sous HomeHeader, avant catégories
- [ ] **Attendu** : ScrollView horizontal de cards 260px, chaque card a icône + titre + sous-titre + chevron

### S6.2 — Card mark_vendue (Jean)
- [ ] [Jean / B] Aller sur Home → si Jean a une annonce statut=en_cours avec conv met → card verte **"Marque ton annonce vendue"**
- [ ] [Jean / B] Tap la card → ouvre `/announce/[id]` (pas /messages, c'est mark_vendue)

### S6.3 — Card avis (Marie)
- [ ] [Marie / A] Si Marie est en met sans avis posé → card noire **"Note Jean"**
- [ ] [Marie / A] Tap la card → ouvre `/messages/[conv_id]` direct sur la conv

### S6.4 — Card disputed (urgent)
- [ ] [Marie / A] Sur la 2e conv en disputed → card orange **"Désaccord à signaler"**
- [ ] **Attendu ordering** : si Marie a plusieurs actions, disputed apparaît EN PREMIER (priority 1)

### S6.5 — Refetch au focus
- [ ] [Marie / A] Faire l'action correspondante (ex : noter Jean depuis le chat)
- [ ] [Marie / A] Revenir sur Home → la card "Note Jean" disparaît immédiatement (refetch on focus)

### S6.6 — Anonyme
- [ ] [Marie / A] Se déconnecter (Profil → Déconnexion)
- [ ] [Marie / A] Aller sur Home → **bannière entièrement masquée** (pas même le titre)

### S6.7 — Filtre disputed après signalement OU admin decided (mig 96)
> Ce test valide que la card "Désaccord à signaler" disparaît correctement de la bannière Home dans 2 cas distincts.

**Cas A — User a signalé, admin pas encore décidé** :
- [ ] Setup : nouvelle conv en disputed, [Marie / A] tape **"Signaler ce RDV"** + envoie un signalement (motif au choix) (non testé en isolation — directement couvert par cas B après admin trait)
- [ ] [Marie / A] Revenir sur Home immédiatement
- [ ] **Attendu** : card "Désaccord à signaler" **disparue** de la bannière (filtre `not exists` sur signalements signaleur=marie)
- [ ] [Jean / B] Sur Home → si Jean est l'autre partie ET il n'a pas signalé → **card disputed encore visible** côté Jean (chacun son filtre indépendant — Jean peut signaler en retour)

**Cas B — Admin a décidé (depuis n'importe quel signalement)** :
- [x] [Dominique / Web] Valider ou rejeter le signalement de Marie ✅ 2026-05-09 (validé "Tentative de fraude" en H1)
- [x] [Marie / A] Revenir sur Home → card disputed toujours absente (continuité OK) ✅ 2026-05-09
- [x] [Jean / B] Revenir sur Home → **card disputed maintenant aussi disparue** côté Jean (filtre `admin_signalement_decided_at is null` actif sur la conv) ✅ 2026-05-09

---

## Bloc 7 — Crons backend (mig 87 + 90) — non testable iPhone

Les crons tournent à 10h UTC daily. Pour les tester manuellement (Supabase SQL Editor) :

```sql
-- Cron 1 : relance push si silencieux post-RDV
select public.fn_push_rencontre_reminder();

-- Cron 2 : relance push si vendeur oublie mark_vendue
select public.fn_push_mark_vendue_reminder();
```

- [ ] [Dominique / SQL] Exécuter les 2 fonctions
- [ ] **Attendu** : push reçu sur Marie / Jean si conv éligible (silencieux post-RDV ou met avec annonce en_cours)
- [ ] **Vérif counter** : `select rencontre_reminders_sent from conversations where ...` → incrémenté de 1 si éligible

---

## Bloc 8 — Edge cases

### S8.1 — Re-propose après cancel reset rencontre (mig 87)
- [ ] [Marie / A] Sur une conv en met, [Jean / B] taper **"Annuler le RDV"** depuis le bandeau confirmé
- [ ] [Marie / A] Re-proposer un nouveau RDV
- [ ] **Vérif DB** : `rencontre_acheteur`, `rencontre_vendeur`, `rencontre_decided_at`, `rencontre_reminders_sent` tous reset à null/0

### S8.2 — Cancel après confirm reset rencontre
- [ ] Sur une conv en confirmed (avant RDV passé), Jean cancel
- [ ] **Attendu** : bandeau revient à "Proposer un RDV" + tous les champs RDV null + annonce revert active (trigger)

### S8.3 — Annonce expirée pendant un RDV
- [ ] Setup : RDV confirmé sur annonce dont `expires_at` passe (manipulation DB)
- [ ] **Attendu** : annonce passe expiree mais conv reste accessible. RDV inchangé.

### S8.4 — Compte suspendu pendant un RDV
- [ ] Setup : suspend Jean via DB (`is_active=false`)
- [ ] [Marie / A] Ouvrir la conv → fonctionnement normal côté Marie. Jean ne reçoit pas push.

---

## ✅ Validation finale

Quand tous les blocs sont ✅ :
- [ ] Reporter à l'équipe : "Trust v2 testé sur 2 devices, prêt pour ship"
- [ ] Décocher / créer ticket pour chaque ⚠️ détail UX trouvé
- [ ] Si ❌ bug bloquant : créer issue GitHub avec étape reproductible

---

> Le mapping migrations → tests détaillé est en haut du document (section "Setup commun → Glossaire migrations couvertes").
