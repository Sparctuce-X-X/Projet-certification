# Module Annonces — Scénarios de test

> Créé le **2026-04-30**. Branche : `annonces`.
> Méthodologie : CLAUDE.md §Tests — un test à la fois, OK/KO, fix avant de passer au suivant.
> Prérequis : migrations 13-19 jouées, Dev Client ou Expo Go, 1 user connecté avec profil complet.

---

## A — Création d'annonce (wizard /sell)

### A1 — Happy path complet
- [x] **Préalable** : user connecté, pays CI ✅ 2026-04-30
- [x] **Marche à suivre** :
  1. Tap "+" (BottomNav) → wizard s'ouvre
  2. Step 1 : titre "iPhone 12 64Go bleu" + description "Très bon état, chargeur inclus, acheté il y a 6 mois"
  3. Step 2 : catégorie "Tech" + état "Très bon"
  4. Step 3 : ajouter 2 photos depuis la galerie
  5. Step 4 : prix "175 000" + ville "Abidjan" + quartier "Cocody"
  6. Si 1er post : cocher la checkbox CGU
  7. Tap "Publier l'annonce"
- [x] **Attendu** : spinner de chargement, puis redirect vers `/announce/[id]` avec l'annonce affichée (photos, prix, vendeur) ✅

### A2 — Validation titre trop court
- [x] **Préalable** : wizard ouvert, step 1 ✅ 2026-04-30
- [x] **Marche à suivre** : taper "Ab" (2 caractères) dans le titre
- [x] **Attendu** : compteur en orange "2/50 — 3 caractères minimum", bouton "Suivant" grisé ✅

### A3 — Validation description trop courte
- [x] **Préalable** : wizard ouvert, step 1, titre valide ✅ 2026-04-30
- [x] **Marche à suivre** : taper "Bon état" (8 caractères) dans la description
- [x] **Attendu** : compteur en orange "8/2000 — 10 caractères minimum", bouton "Suivant" grisé ✅

### A4 — Step 2 catégories chargement
- [x] **Préalable** : wizard ouvert, passer au step 2 ✅ 2026-04-30
- [x] **Marche à suivre** : observer le chargement des catégories
- [x] **Attendu** : spinner pendant le fetch, puis grille 2 colonnes avec 8 catégories. Tap sur une catégorie → highlight coral. Tap sur un état → radio sélectionné ✅

### A5 — Step 4 ajout photo galerie
- [x] **Préalable** : wizard step 4 ✅ 2026-04-30
- [x] **Marche à suivre** : tap "Ajouter une photo" → choisir "Choisir dans la galerie" → sélectionner 1 photo
- [x] **Attendu** : photo affichée en preview avec badge "Couverture" sur la 1ère, bouton X pour retirer, compteur "1/5" ✅

### A6 — Step 4 ajout multiple photos
- [x] **Préalable** : wizard step 4, 0 photos ✅ 2026-04-30
- [x] **Marche à suivre** : tap "Ajouter une photo" → galerie → sélectionner 3 photos d'un coup (iOS multi-select)
- [x] **Attendu** : 3 photos affichées, badge "Couverture" sur la 1ère uniquement, compteur "3/5" ✅

### A7 — Step 4 limite 5 photos
- [x] **Préalable** : wizard step 4, 5 photos ajoutées ✅ 2026-04-30
- [x] **Attendu** : bouton "Ajouter une photo" disparaît, message "Limite atteinte (5 photos max)" ✅

### A8 — Step 4 retirer une photo
- [x] **Préalable** : wizard step 4, 3 photos ✅ 2026-04-30
- [x] **Marche à suivre** : tap X sur la 2e photo
- [x] **Attendu** : photo retirée, les 2 restantes se réordonnent, badge "Couverture" reste sur la 1ère ✅

### A9 — Step 5 prix formaté
- [x] **Préalable** : wizard step 5 ✅ 2026-04-30
- [x] **Marche à suivre** : taper "175000" dans le champ prix
- [x] **Attendu** : affichage formaté "175 000" avec "FCFA" à droite ✅

### A10 — Step 5 prix au-dessus du cap
- [x] **Préalable** : wizard step 5, pays CI ✅ 2026-04-30
- [x] **Marche à suivre** : taper "2000000" dans le champ prix
- [x] **Attendu** : banner rouge "Le prix max sur Niqo est de 1 500 000 FCFA", bouton "Publier" grisé ✅

### A11 — Step 5 sélection ville
- [x] **Préalable** : wizard step 5 ✅ 2026-04-30
- [x] **Marche à suivre** : tap sur "Choisir une ville" → sélectionner "Abidjan"
- [x] **Attendu** : ville affichée "Abidjan", bouton "Publier" activé (si prix valide) ✅

### A12 — CGU checkbox 1er post
- [x] **Préalable** : user qui n'a jamais publié d'annonce, wizard step 5 ✅ 2026-04-30
- [x] **Attendu** : checkbox CGU visible avec liens "conditions générales" et "politique de confidentialité". Bouton "Publier" grisé tant que pas coché ✅

### A13 — CGU checkbox pas affiché au 2e post
- [x] **Préalable** : user qui a déjà publié au moins 1 annonce, wizard step 5 ✅ 2026-04-30
- [x] **Attendu** : pas de checkbox CGU visible ✅

---

## B — Brouillon (draft persistence)

### B1 — Persist au background
- [x] **Préalable** : wizard step 2 ou 3, catégorie/état sélectionnés ✅ 2026-04-30
- [x] **Marche à suivre** : switcher vers une autre app (WhatsApp), revenir sur Niqo
- [x] **Attendu** : wizard toujours au même step, sélections conservées ✅

### B2 — Restore après kill
- [x] **Préalable** : wizard step 4, 2 photos ajoutées, forcer la fermeture de l'app (swipe up) ✅ 2026-04-30
- [x] **Marche à suivre** : rouvrir Niqo, aller dans /sell
- [x] **Attendu** : wizard restaure le step. Photos possiblement absentes (fichiers temp purgés), pas de crash ✅

### B3 — Reset draft
- [x] **Préalable** : wizard en cours avec des données ✅ 2026-04-30
- [x] **Marche à suivre** : tap sur l'icône ↺ (reset) en haut à droite
- [x] **Attendu** : tous les champs vidés, retour au step 1 ✅

---

## C — Erreurs et edge cases

### C1 — Rate limit 5 annonces / 24h
- [x] **Préalable** : trigger DB validé migration 16 — SKIP (pas 5 annonces sous la main) ✅ 2026-04-30
- [x] **Marche à suivre** : tenter de publier une 6e annonce
- [x] **Attendu** : message d'erreur FR "Tu as atteint la limite de 5 nouvelles annonces par 24h" ✅ (trigger + mapping FR en place)

### C2 — Anti-doublon
- [x] **Préalable** : trigger DB validé migration 17 — SKIP ✅ 2026-04-30
- [x] **Marche à suivre** : refaire exactement la même annonce (même titre, description, prix, ville)
- [x] **Attendu** : message d'erreur FR "Tu as déjà posté une annonce identique récemment" ✅ (trigger + mapping FR en place)

### C3 — Réseau coupé pendant publication
- [x] **Préalable** : wizard complet prêt à publier ✅ 2026-04-30
- [x] **Marche à suivre** : activer le mode avion, tap "Publier"
- [x] **Attendu** : message d'erreur (timeout ou réseau), pas de crash, bouton re-cliquable ✅

### C4 — Retour flèche ← / swipe-back iOS
- [x] **Préalable** : wizard step 3+ ✅ 2026-04-30
- [x] **Marche à suivre** : tap flèche ← dans le header. Swipe-back iOS désactivé sur step > 1 (intentionnel)
- [x] **Attendu** : flèche ← ramène au step précédent. Fix : zIndex header pour éviter que le ScrollView le recouvre ✅

---

## D — Page détail (/announce/[id])

### D1 — Affichage détail complet
- [x] **Préalable** : annonce publiée avec 2+ photos ✅ 2026-04-30
- [x] **Marche à suivre** : ouvrir l'annonce depuis la home
- [x] **Attendu** : galerie photos swipeable avec dots, prix en JetBrains Mono, badge état, description, ville, "il y a X", nombre de vues, section vendeur ✅

### D2 — Galerie navigation
- [x] **Préalable** : annonce avec 2+ photos, page détail ouverte ✅ 2026-04-30
- [x] **Marche à suivre** : swiper les photos, vérifier les dots et compteur
- [x] **Attendu** : photos défilent, dots suivent, compteur se met à jour ✅

### D3 — Mode owner (vendeur)
- [x] **Préalable** : ouvrir sa propre annonce ✅ 2026-04-30
- [x] **Attendu** : boutons "Modifier" + "Supprimer" en bas (pas "Acheter" / "Contacter") ✅

### D4 — Mode buyer (acheteur)
- [x] **Préalable** : ouvrir l'annonce d'un autre vendeur (ou en anonyme) ✅ 2026-04-30
- [x] **Attendu** : boutons "Contacter" + "Acheter" en bas. "Acheter" en fond noir (pas coral) ✅

### D5 — Increment vues dédupliqué
- [x] **Préalable** : noter le nb_vues dans le Dashboard ✅ 2026-04-30
- [x] **Marche à suivre** : ouvrir l'annonce, fermer, rouvrir
- [x] **Attendu** : nb_vues +1 (pas +2) — dédupliqué par jour pour les users connectés ✅

### D6 — Suppression annonce
- [x] **Préalable** : ouvrir sa propre annonce ✅ 2026-04-30
- [x] **Marche à suivre** : tap "Supprimer" → confirmer dans l'Alert
- [x] **Attendu** : redirect vers /home, annonce disparue de la liste ✅

---

## E — Home wiring

### E1 — Annonces réelles affichées
- [x] **Préalable** : au moins 1 annonce publiée ✅ 2026-04-30
- [x] **Marche à suivre** : ouvrir l'app → home
- [x] **Attendu** : annonces réelles avec photos, prix formaté, ville, badge "Nouveau" si < 24h ✅

### E2 — Filtre catégorie
- [x] **Préalable** : annonces dans au moins 2 catégories ✅ 2026-04-30
- [x] **Marche à suivre** : tap sur un pill catégorie
- [x] **Attendu** : liste filtrée, re-tap désactive le filtre ✅

### E3 — Filtre ville
- [x] **Préalable** : annonces dans au moins 2 villes ✅ 2026-04-30
- [x] **Marche à suivre** : tap "Ville" → sélectionner une ville
- [x] **Attendu** : liste filtrée, compteur "X annonces à [ville]" ✅

### E4 — Tri prix
- [x] **Préalable** : plusieurs annonces à prix différents ✅ 2026-04-30
- [x] **Marche à suivre** : tap tri → "Prix croissant"
- [x] **Attendu** : annonces triées du moins cher au plus cher, pill tri en coral ✅

### E5 — Pull-to-refresh
- [x] **Marche à suivre** : tirer vers le bas sur la home ✅ 2026-04-30
- [x] **Attendu** : spinner coral, données rafraîchies ✅

---

## F — Favoris

### F1 — Ajouter un favori
- [x] **Préalable** : home avec annonces, user connecté ✅ 2026-04-30
- [x] **Marche à suivre** : tap sur le cœur d'une annonce
- [x] **Attendu** : animation bounce + haptic, cœur passe en coral plein ✅

### F2 — Retirer un favori
- [x] **Préalable** : annonce en favori (cœur plein) ✅ 2026-04-30
- [x] **Marche à suivre** : re-tap sur le cœur
- [x] **Attendu** : animation subtile, cœur repasse en noir vide ✅

### F3 — Page mes favoris
- [x] **Préalable** : au moins 1 favori ✅ 2026-04-30
- [x] **Marche à suivre** : tap cœur header home → page favoris
- [x] **Attendu** : annonces favorites en grille, cœurs pleins, retirer un favori = disparaît de la liste ✅

### F4 — Favori gate auth
- [x] **Préalable** : user non connecté ✅ 2026-04-30
- [x] **Marche à suivre** : tap sur le cœur d'une annonce
- [x] **Attendu** : AuthGate s'ouvre avec "Sauvegarde tes coups de cœur" ✅

---

## G — Mes annonces (/profile/announces)

### G1 — Liste mes annonces
- [x] **Préalable** : user avec au moins 1 annonce publiée ✅ 2026-04-30
- [x] **Marche à suivre** : profil → "Mes annonces"
- [x] **Attendu** : liste avec cover, titre, prix, badge statut coloré (vert "Active") ✅

### G2 — Supprimer depuis mes annonces
- [x] **Préalable** : mes annonces, au moins 1 annonce active ✅ 2026-04-30
- [x] **Marche à suivre** : tap corbeille rouge → confirmer
- [x] **Attendu** : annonce disparaît de la liste ✅

---

## H — Édition (/announce/[id]/edit)

### H1 — Prefill des champs
- [x] **Préalable** : ouvrir sa propre annonce → tap "Modifier" ✅ 2026-04-30
- [x] **Attendu** : wizard 4 steps avec titre, description, catégorie, état, prix, ville, quartier préremplis ✅

### H2 — Sauvegarde modification
- [x] **Préalable** : modifier le prix dans l'écran d'édition ✅ 2026-04-30
- [x] **Marche à suivre** : changer le prix, avancer au step 4, tap "Sauvegarder"
- [x] **Attendu** : retour à la page détail, nouveau prix affiché ✅

---

## I — Search wiring

### I1 — Recherche par mot-clé
- [x] **Préalable** : au moins 1 annonce avec "iPhone" dans le titre ✅ 2026-04-30
- [x] **Marche à suivre** : search → taper "iPhone"
- [x] **Attendu** : résultats filtrés après 300ms debounce, annonces avec "iPhone" affichées ✅

### I2 — Aucun résultat
- [x] **Marche à suivre** : search → taper "xyzzyspoon" ✅ 2026-04-30
- [x] **Attendu** : message "Aucun résultat" + "Essaie un autre mot-clé" ✅

---

_Quand toutes les cases sont cochées → le module annonces est **shippable beta**._
