# Gotchas connus & recettes de debug

> Pièges déjà rencontrés. Vérifier ici avant de chercher loin.
>
> Index pointé depuis `CLAUDE.md` (qu'on garde court pour les perfs Claude Code).

---

## Outillage / IDE

- **L'éditeur affiche des erreurs SQL Server (T-SQL) sur les fichiers `.sql`** → ce sont des faux positifs. Postgres `do $$ ... $$`, `if not exists`, `create or replace function` sont rejetés par le parser T-SQL. Toujours valider en jouant la migration dans Supabase plutôt qu'en se fiant aux diagnostics IDE.
- **JSDoc qui contient `*/` casse `tsc`** : un commentaire `propose_*/confirme_at` ferme prématurément le block comment. Reformuler (`propose_*`, `confirme_at`).

## React Native / Expo

- **`@react-native-community/datetimepicker` sur iOS** → utiliser `mode="datetime"` ou deux pickers `display="compact"` côte à côte. Ne **jamais** switcher dynamiquement le `mode` d'un seul `<DateTimePicker>` (provoque un onChange à epoch 1970-01-01 au remount).
- **`expo-image` ne consomme pas `className` pour les dimensions** → toujours passer `style={{ width, height }}` explicite.
- **Clavier qui cache un `TextInput` dans un `<Modal>`** → wrapper le contenu de la modal dans un `<KeyboardAvoidingView behavior="padding">` (iOS). Pour les écrans plein écran (pas modal) avec input, depuis la 1.0.1 on utilise `KeyboardAvoidingView` de `react-native-keyboard-controller` qui gère correctement Android `edgeToEdgeEnabled` + iOS.

## Supabase

- **Toute nouvelle table à syncer côté client** → `alter publication supabase_realtime add table public.<table>;` dans la migration. Sans ça, les UPDATE/INSERT n'arrivent jamais en `postgres_changes`.
- **Trigger BEFORE INSERT global sur `messages`** → bypass explicite pour `NEW.type = 'systeme'`. Tout RPC SECURITY DEFINER qui insère un message système doit pouvoir passer même si le contenu matcherait un mot interdit (cas RDV "Marché bombe artisanal").
- **Format de date dans un message serveur** → générera un mismatch tz si proposeur ≠ viewer. Préférer afficher la date+heure dans un **bandeau client** (`toLocaleString` avec tz du device), garder le message serveur **sans heure** (juste lieu, prénom, action).
- **`auth.uid()` dans un SECURITY DEFINER** → renvoie l'UID de l'**appelant** (lu depuis le JWT), pas celui du owner de la fonction. Garder ce mental model en tête.

## Vercel (admin web `landing/`)

- **Env vars `NEXT_PUBLIC_*` doivent être cochées en Production + Preview + Development** dans Vercel Dashboard → Settings → Environment Variables. Sinon `await supabase.auth.getUser()` du middleware throw → tout `/admin/*` crash en `MIDDLEWARE_INVOCATION_FAILED` (incident vécu 2026-05-10). Symptôme côté user : 500 sur n'importe quelle page admin, même `/admin/login`.
- **`NEXT_PUBLIC_SUPABASE_URL` ne doit PAS avoir de trailing slash** ni `http://`. Format exact : `https://<project-ref>.supabase.co`.
- **Supabase JS FK joins typés comme array** : quand tu fais `signaleur:users!fk_name(...)`, le compilateur infer `[]` même si la FK est unique. Cast via `as unknown as Array<{ ... signaleur: {...} | null }>` (pas `as Array<...>` direct). Sinon `npm run build` Vercel fail le typecheck.

## Front-end UX

- **iOS `display="spinner"` du DateTimePicker sur fond clair** → texte gris pâle illisible. Forcer `textColor="#1A1A1A"` + `themeVariant="light"` + `locale="fr-FR"`. Ou switcher en `display="compact"` (overlay natif iOS, plus moderne).

## Compliance Apple/Google UGC (Guideline 1.2 + Google Play UGC)

- **Apple a rejeté la build 1.0.0 (4) le 2026-05-15** pour Guideline 1.2 UGC : *"A mechanism for users to block abusive users. Blocking should also notify the developer of the inappropriate content and should remove it from the user's feed instantly."*
- Fix : feature Block (F15, mig 129-132). 4 piliers compliance désormais en place : (1) EULA visible (CGU+CGV), (2) filtre auto contenu (couches 1-4 modération), (3) flag/report (F08 signalement), (4) **block user** (F15). Apple a re-validé la build 1.0.0 (6) en 24h.
- Toute nouvelle plateforme avec UGC (Play Store, futurs stores) attendra ces 4 piliers — ne pas régresser.
- **"Notify the developer" en pratique** : `block_user` (mig 131) crée un signalement implicite via `INSERT ON CONFLICT DO UPDATE` — l'admin reçoit un email Resend même si le signalement existait déjà (auto-trigger `tg_admin_notif_signalement` fire sur INSERT, fallback `_notify_admin_email` manuel sur UPDATE détecté via `xmax = 0`).
- **"Remove from feed instantly"** : couvert sur 2 canaux. (a) Annonces : filter front via `useBlockedUsers` hook + `excludeVendeurIds` côté `lib/annonces.ts` (`.not('vendeur_id', 'in', blockedIds)`). (b) Messages : trigger DB `fn_messages_block_check` BEFORE INSERT raise `BLOCKED_BY_RECIPIENT` côté bloqué — front affiche message neutre non-révélateur.

## EAS Build / App Store Connect (Apple)

- **`supportsTablet: true` dans `app.json` → Apple exige des screenshots iPad 13"** (2064×2752). Si tu n'as pas designé/testé l'iPad, met `supportsTablet: false` pour skip cette exigence. Modifier après build → rebuild requis (UIDeviceFamily est figé à la compilation). Vécu 2026-05-14.
- **App Store Connect rejette flag emojis 🇨🇮 🇨🇬 + ★ dans la Description** → erreur `"This field contains one or more invalid characters."`. Remplacer par texte (`Côte d'Ivoire`, `4 étoiles ou plus`). Em-dashes `—` et bullets `•` passent.
- **App Privacy questionnaire n'est PAS visible sur la fiche App Store tant qu'on n'a pas cliqué "Publish"** (pas juste "Save"). Sans Publish, l'erreur `"Admin must provide information about the app's privacy practices"` bloque le submit.
- **ASC perd parfois le contenu des champs texte (Description, Keywords, URLs) après navigation sans Save** → toujours cliquer le bouton bleu "Save" en haut à droite AVANT de cliquer "Add for Review", et **refresh la page (Cmd+R) pour vérifier la persistance** avant submission.
- **Apple rejette `version` déjà submitted en App Store** → quand `version: 1.0.0` est LIVE sur App Store, tout `eas submit` ultérieur avec la même `expo.version` échoue avec "You've already submitted this version of the app". Bump `expo.version` à la prochaine PATCH (`1.0.1`) avant rebuild. `buildNumber` auto-incrément ne suffit pas pour App Store (TestFlight si).
- **Sentry React Native nécessite `SENTRY_AUTH_TOKEN` au build time** pour upload les sourcemaps. Sans le secret en env EAS, le build production fail avec un sourcemap upload error. Workaround temporaire : neutraliser `lib/sentry.ts` en no-op mock + retirer le plugin de `app.json` (cf. état 2026-05-14, task #18 pour restoration).
- **DSA (Digital Services Act) Apple — Phone + Address sont PUBLIÉS sur la fiche App Store EU** : utiliser un numéro pro/virtuel, pas le perso. L'email DSA est aussi public — préférer `legal@niqo.africa` à une adresse personnelle.
- **App Review "Contact Information" (différent du DSA)** → privé à Apple staff, OK d'utiliser un numéro perso pour les appels durant la review. À ne PAS confondre avec le DSA qui est public.
- **Apple Review Notes** : argumenter explicitement le choix paiement externe (Mobile Money via PawaPay) en citant les précédents Leboncoin/Vinted/Jumia → réduit le risque de rejet guideline 3.1.1 (Required IAP) pour les services digitaux côté vendeur (boost, vérification).
- **Demo account Apple Review** doit être pré-vérifié (KYC complete) pour que le reviewer voie le badge "Vendeur vérifié" sans uploader sa propre CNI. Script SQL one-shot dans `scripts/sql/pre-approve-apple-review.sql` à jouer manuellement dans Supabase SQL Editor après signup du compte via l'app.

## EAS Update (OTA) — pièges projectId

- **`updates.url` dans `app.json` est figé dans Info.plist au build time** → tout build EAS embarque l'URL EAS Update qui était dans `app.json` au moment du build, pas celle du projet courant. Si `extra.eas.projectId` et `updates.url` pointent vers des projets différents, l'app live polle une URL et tu publies sur l'autre → **0 install** côté users. Vécu 2026-05-17 : build 1.0.0(6) avait `updates.url = cdbe4f8b-...` (ancien projectId), `extra.eas.projectId = c45ee9d2-...` (nouveau), conséquence : aucun `eas update --channel production` ne peut atteindre le binaire live → seule sortie = rebuild + resubmit store.
- **Avant tout build prod** : vérifier que `app.json` `extra.eas.projectId` et `updates.url` matchent le même projectId via `eas project:info`. EAS CLI corrige automatiquement `app.json` au prochain `eas update` mais c'est trop tard pour le binaire déjà live.
- **EAS CLI peut dupliquer les permissions Android** dans `app.json` lors d'un push update qui touche aux configs natives (`RECORD_AUDIO` + `CAMERA` en double). Cleanup manuel avant commit.
- **`eas update --channel <name>` échoue si le channel n'a pas de branch lié** → erreur "Channel has no branches associated". Solution : `eas update --branch <name>` (auto-crée le branch et le lie au channel), ou `eas channel:edit <name> --branch <name>` pour le faire manuellement.
