# Module Authentification — Plan de tests

> Créé le **2026-04-29**. À exécuter un test à la fois avec confirmation OK/KO avant de passer au suivant.
> **Règle :** un test KO = stop, fix, relance. Ne jamais empiler des KO.

---

## Légende environnement

| Symbole | Signification |
|---|---|
| 🟢 Expo Go | Testable dans Expo Go (scan QR) |
| 🔵 Dev Client | Requiert `npx expo run:ios` ou `npx expo run:android` (deep links `niqo://`) |

---

## Groupe A — Auth gate (browse-first)

### A1 — Accès home sans compte 🟢

**Préalable :** app démarrée, aucun compte connecté.

**Marche à suivre :**
1. Ouvrir l'app
2. Observer l'écran d'accueil (annonces)
3. Scroller dans la liste

**Attendu :** la liste des annonces s'affiche normalement. Aucune modale d'auth. Aucune redirection.

- [x] A1

---

### A2 — Tap "Vendre" déclenche la gate 🟢

**Préalable :** aucun compte connecté, écran home visible.

**Marche à suivre :**
1. Taper le bouton "Vendre" (ou CTA vente selon UI)

**Attendu :** le bottom-sheet AuthGate s'ouvre avec le titre contextualisé "vendre". Les 3 boutons (Google, Apple, Email) sont visibles. Le fond est assombri.

- [x] A2

---

### A3 — Fermeture de la gate sans action 🟢

**Préalable :** la gate AuthGate est ouverte (suite de A2).

**Marche à suivre :**
1. Taper en dehors du bottom-sheet (zone assombrie) OU swipe bas

**Attendu :** le bottom-sheet se ferme. On revient à l'écran home. Aucun message d'erreur.

- [x] A3

---

## Groupe B — Signup email

### B1 — Signup complet (happy path) 🟢

**Préalable :** aucun compte existant avec cet email. Réseau disponible.

**Marche à suivre :**
1. Ouvrir la gate → taper "Continuer avec Email"
2. Étape 1 : saisir un email valide (ex : `test+001@gmail.com`) + mot de passe fort (`Test1234!`)
3. Observer l'indicateur de force du mot de passe : doit afficher "fort" (3 barres vertes)
4. Taper "Suivant"
5. Étape 2 : saisir prénom + nom
6. Taper "Suivant"
7. Étape 3 : saisir un numéro CI valide (ex : `0701234567`) + sélectionner la ville + quartier (optionnel)
8. Taper "Créer mon compte"

**Attendu :** un spinner s'affiche pendant le signup. Ensuite l'écran home apparaît avec un banner jaune/info "Vérifie ton email — un lien de confirmation t'a été envoyé." Le bouton "Renvoyer" est visible mais désactivé avec un countdown (60s).

- [x] B1

---

### B2 — Indicateur de force du mot de passe 🟢

**Préalable :** écran signup step 1 ouvert (suite d'une ouverture de gate → Email).

**Marche à suivre :**
1. Taper dans le champ mot de passe : `abc` (trop court, pas de critères)
2. Observer l'indicateur
3. Taper : `Abcdef12` (longueur ≥8 + majuscule + chiffre = 3 critères)
4. Observer l'indicateur
5. Taper : `Abcdef12!` (+ caractère spécial = 4 critères)
6. Observer l'indicateur

**Attendu :**
- `abc` → 1 barre rouge, label "Faible", hint "8 caractères minimum"
- `Abcdef12` → 2 barres oranges, label "Correct"
- `Abcdef12!` → 3 barres vertes, label "Fort"

- [x] B2

---

### B3 — Email déjà existant 🟢

**Préalable :** un compte existe déjà avec l'email `test+001@gmail.com` (créé lors de B1).

**Marche à suivre :**
1. Ouvrir la gate → Email
2. Étape 1 : saisir `test+001@gmail.com` + `Test1234!`
3. Taper "Suivant"
4. Étape 2 : saisir prénom + nom
5. Taper "Suivant"
6. Étape 3 : saisir le téléphone + ville
7. Taper "Créer mon compte"

**Attendu :** un message d'erreur en français apparaît dans le banner rouge : "Cette adresse email est déjà utilisée." (ou équivalent `authErrorToFr`). Le champ email est bordé en rouge. Aucune navigation.

- [x] B3

---

### B4 — Numéro de téléphone invalide (CI) 🟢

**Préalable :** pays sélectionné = Côte d'Ivoire (+225). Étape 3 signup ouverte.

**Marche à suivre :**
1. Saisir `0812345678` (préfixe 08 inexistant en CI)
2. Taper "Créer mon compte"

**Attendu :** message d'erreur "Numéro invalide pour la Côte d'Ivoire" (ou équivalent). Le champ téléphone est bordé en rouge. Aucun appel Supabase.

- [x] B4

---

### B5 — Resend email de confirmation + countdown 🟢

**Préalable :** signup complété (B1), banner "Vérifie ton email" visible sur home, countdown 60s en cours.

**Marche à suivre :**
1. Attendre la fin du countdown (60s)
2. Taper "Renvoyer l'email"
3. Observer le countdown redémarrer

**Attendu :** un nouvel email de confirmation est envoyé (vérifier la boîte). Le countdown repart de 60s. Le bouton est à nouveau désactivé pendant 60s.

- [x] B5

---

## Groupe C — Signin email

### C1 — Signin avec compte non confirmé 🟢

**Préalable :** compte `test+001@gmail.com` créé (B1) mais email **non** confirmé (ne pas cliquer le lien).

**Marche à suivre :**
1. Ouvrir la gate → Email
2. Basculer en mode "Connexion" (si le form est en mode signup)
3. Saisir `test+001@gmail.com` + `Test1234!`
4. Taper "Se connecter"

**Attendu :** message d'erreur en français "Confirme ton adresse email avant de te connecter." Aucune navigation.

- [ ] C1

---

### C2 — Signin avec mauvais mot de passe 🟢

**Préalable :** compte confirmé existant.

**Marche à suivre :**
1. Gate → Email → mode Connexion
2. Saisir l'email du compte + `MauvaisPassword123`
3. Taper "Se connecter"

**Attendu :** message d'erreur "Email ou mot de passe incorrect." Le champ mot de passe est bordé en rouge. Aucune navigation.

- [x] C2

---

### C3 — Signin happy path 🟢

**Préalable :** compte email confirmé existant (email cliqué dans la boîte mail, ou créé en dev avec "Confirm email" OFF dans Supabase).

**Marche à suivre :**
1. Gate → Email → mode Connexion
2. Saisir email + mot de passe corrects
3. Taper "Se connecter"

**Attendu :** navigation vers home. L'utilisateur est connecté (avatar / profil visible si applicable). Banner email non visible (email confirmé). Le bottom-sheet AuthGate est fermé.

- [x] C3

---

### C4 — Signin hors-ligne 🟢

**Préalable :** Wi-Fi et données mobiles désactivés.

**Marche à suivre :**
1. Gate → Email → mode Connexion
2. Saisir email + mot de passe
3. Taper "Se connecter"

**Attendu :** message immédiat "Pas de connexion internet. Vérifie ton réseau." Le bouton ne tourne pas 15s. Aucun appel réseau.

- [x] C4

---

## Groupe D — Reset password (Dev Client requis)

### D1 — Demande de reset (anti-énumération) 🔵

**Préalable :** Dev Client lancé. Réseau disponible.

**Marche à suivre :**
1. Gate → Email → "Mot de passe oublié ?"
2. Saisir `email-qui-nexiste-pas@x.com`
3. Taper "Envoyer"

**Attendu :** message neutre "Si un compte existe avec cet email, un lien de réinitialisation t'a été envoyé." (pas de confirmation d'existence du compte). Countdown 60s sur le bouton.

- [ ] D1

---

### D2 — Reset happy path 🔵

**Préalable :** compte email confirmé existant. Dev Client lancé (deep links actifs).

**Marche à suivre :**
1. Gate → Email → "Mot de passe oublié ?"
2. Saisir l'email du compte
3. Taper "Envoyer"
4. Ouvrir la boîte mail → cliquer le lien de reset (depuis le device avec Dev Client)
5. L'app s'ouvre sur l'écran reset password
6. Saisir un nouveau mot de passe (`NouveauPass456!`) dans les deux champs
7. Taper "Réinitialiser"

**Attendu :** l'app navigue vers home (ou login). Se reconnecter avec le nouveau mot de passe doit fonctionner (test C3 avec le nouveau mdp).

- [ ] D2

---

### D3 — Lien de reset expiré 🔵

**Préalable :** Dev Client. Avoir un lien de reset **expiré** (attendre >1h après l'avoir reçu, ou utiliser un vieux lien).

**Marche à suivre :**
1. Cliquer un lien de reset expiré depuis la boîte mail
2. L'app s'ouvre sur l'écran reset password
3. Observer le message d'erreur

**Attendu :** message "Ce lien a expiré." avec un CTA "Demander un nouveau lien" qui renvoie vers l'écran forgot-password. Aucun crash.

- [ ] D3

---

## Groupe E — OAuth Google

### E1 — Signup Google (nouveau compte) 🔵

**Préalable :** Dev Client iOS ou Android. Compte Google non encore utilisé sur Niqo. Réseau disponible.

**Marche à suivre :**
1. Gate → "Continuer avec Google"
2. Le navigateur in-app s'ouvre sur la page de sélection de compte Google
3. Choisir un compte Google
4. Autoriser l'accès

**Attendu :** le navigateur se ferme. L'app navigue vers `/auth/complete-profile` (écran de complétion : ville + quartier + téléphone). Le profil est incomplet (`has_phone = false`).

- [ ] E1

---

### E2 — Complétion profil post-Google 🔵

**Préalable :** suite de E1, écran `/auth/complete-profile` visible.

**Marche à suivre :**
1. Choisir une ville (ex : Abidjan)
2. Saisir un quartier (optionnel)
3. Saisir un téléphone CI valide (ex : `0701234567`)
4. Taper "Terminer mon inscription"

**Attendu :** navigation vers home. L'utilisateur est connecté. Aucun banner email non confirmé (OAuth = email déjà vérifié). `has_phone = true` → `needsProfileCompletion = false` → plus de redirection vers complete-profile.

- [ ] E2

---

### E3 — "Plus tard" sur complete-profile 🔵

**Préalable :** nouveau compte OAuth, écran `/auth/complete-profile` visible (E1 sans avoir complété E2).

**Marche à suivre :**
1. Taper "Plus tard (me déconnecter)"

**Attendu :** signOut. Navigation vers home anonyme. L'AuthGate peut se rouvrir si on tape "Vendre". Le compte existe en DB mais avec `has_phone = false`.

- [ ] E3

---

### E4 — Signin Google (compte existant) 🔵

**Préalable :** compte Google déjà utilisé sur Niqo (E1 + E2 complétés).

**Marche à suivre :**
1. Se déconnecter si connecté
2. Gate → "Continuer avec Google"
3. Choisir le même compte Google

**Attendu :** le navigateur se ferme. Navigation directe vers home (pas de complete-profile — profil déjà complet). L'utilisateur est connecté.

- [ ] E4

---

### E5 — Annulation OAuth Google (silencieuse) 🔵

**Préalable :** Dev Client. Réseau disponible.

**Marche à suivre :**
1. Gate → "Continuer avec Google"
2. Le navigateur in-app s'ouvre
3. Fermer le navigateur sans choisir de compte (croix / swipe down)

**Attendu :** le bottom-sheet AuthGate se referme (ou revient). **Aucun banner rouge d'erreur.** Le cancel est silencieux.

- [ ] E5

---

## Groupe F — OAuth Apple (iOS uniquement)

### F1 — Signup Apple (nouveau compte) 🔵

**Préalable :** Dev Client **iOS** (Apple Sign In non disponible Android). Compte Apple non encore utilisé sur Niqo.

**Marche à suivre :**
1. Gate → "Continuer avec Apple"
2. Le navigateur in-app s'ouvre sur la page Apple
3. Se connecter avec un Apple ID
4. Autoriser (choisir "Partager mon email" ou "Masquer mon email")

**Attendu :** le navigateur se ferme. Navigation vers `/auth/complete-profile`. Même comportement que E1.

- [ ] F1

---

### F2 — Complétion profil post-Apple 🔵

**Préalable :** suite de F1, écran complete-profile visible.

**Marche à suivre :** identique à E2.

**Attendu :** identique à E2.

- [ ] F2

---

### F3 — Annulation OAuth Apple (silencieuse) 🔵

**Préalable :** Dev Client iOS.

**Marche à suivre :**
1. Gate → "Continuer avec Apple"
2. Navigateur in-app ouvert
3. Fermer sans s'authentifier

**Attendu :** aucun banner rouge. Retour silencieux. Identique à E5.

- [ ] F3

---

## Groupe G — Suspension de compte

### G1 — Connexion avec compte suspendu 🟢

**Préalable :** un compte email existant dont `is_active = false` dans Supabase (modifier manuellement via Dashboard → Table Editor → users → is_active = false). Réseau disponible.

**Marche à suivre :**
1. Gate → Email → Connexion
2. Saisir les identifiants du compte suspendu
3. Taper "Se connecter"

**Attendu :** message "Ton compte a été suspendu. Contacte support@niqo.africa." L'utilisateur est déconnecté (signOut forcé). Aucune navigation vers home. L'email.tsx copie le message du contexte auth.

- [x] G1

---

## Groupe H — Email verification banner

### H1 — Banner visible post-signup non confirmé 🟢

**Préalable :** signup email complété (B1), email **non** confirmé.

**Marche à suivre :**
1. Observer l'écran home après le signup

**Attendu :** banner jaune/info visible sous le header : "Vérifie ton email — un lien de confirmation t'a été envoyé à [email]." Bouton "Renvoyer l'email" avec countdown.

- [ ] H1

---

### H2 — Banner absent pour les comptes OAuth 🔵

**Préalable :** connecté via Google ou Apple (E4).

**Marche à suivre :**
1. Observer l'écran home

**Attendu :** aucun banner email visible. Les comptes OAuth ont l'email automatiquement confirmé par le provider.

- [ ] H2

---

## Groupe I — Confirmation email cold-start

### I1 — Clic sur le lien de confirmation (app fermée) 🔵

**Préalable :** Dev Client. Compte créé (B1), email reçu, **app complètement fermée** (swipe up depuis le switcher).

**Marche à suivre :**
1. Ouvrir la boîte mail sur le device
2. Taper le lien de confirmation

**Attendu :** l'app s'ouvre sur `/auth/callback` (spinner "Connexion en cours…"). L'échange de code est effectué. Navigation vers home. L'utilisateur est connecté. Le banner email disparaît.

- [ ] I1

---

## Récapitulatif

| Groupe | Tests | Env |
|---|---|---|
| A — Auth gate | A1, A2, A3 | 🟢 Expo Go |
| B — Signup email | B1, B2, B3, B4, B5 | 🟢 Expo Go |
| C — Signin email | C1, C2, C3, C4 | 🟢 Expo Go |
| D — Reset password | D1, D2, D3 | 🔵 Dev Client |
| E — OAuth Google | E1, E2, E3, E4, E5 | 🔵 Dev Client |
| F — OAuth Apple | F1, F2, F3 | 🔵 Dev Client iOS |
| G — Suspension | G1 | 🟢 Expo Go |
| H — Email banner | H1, H2 | 🟢 / 🔵 |
| I — Cold-start | I1 | 🔵 Dev Client |

**Total : 24 tests** — 12 Expo Go · 12 Dev Client

---

## Shippable quand

Toutes les cases ci-dessus sont cochées ET les sections 🔴 de `docs/auth-todo.md` sont vides.
Les sections 🟡 et 🟢 peuvent rester ouvertes pour Phase 2.
