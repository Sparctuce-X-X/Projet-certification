# Push notifications FCM (Android prod) — Setup

> Documente la mise en place de Firebase Cloud Messaging pour les push
> notifications Android en production, avec EAS Build (cloud).
>
> **iOS marche déjà** via APNs (auto-géré par Expo Push) — ce doc concerne
> uniquement Android, qui est marqué "Phase 2 prod" dans `CLAUDE.md` §F10.
>
> Démarré 2026-05-08 par Dominique.

---

## Coordonnées Firebase

| Champ | Valeur |
|---|---|
| Projet Firebase | **Niqo** |
| Project ID | `niqo-1118d` |
| Project Number | `13966564240` |
| Plan | Spark (gratuit) — suffit pour FCM |
| Android package | `com.niqo.africa` |

---

## Ce qui est déjà fait

- [x] Projet Firebase créé sur la console
- [x] App Android ajoutée (package `com.niqo.africa`)
- [x] `google-services.json` téléchargé et placé à la racine du projet (`./google-services.json`) — **commité dans le repo** (pas un secret, cf. note ci-dessous)
- [x] `.gitignore` updated — seul `firebase-service-account.json` (vrai secret bypass auth) est gitignored
- [x] `app.json` `android.googleServicesFile` pointe vers `./google-services.json`

> **Note sur `google-services.json`** : malgré son nom, ce fichier n'est PAS un
> secret. Il contient le Project ID + App ID + API Key client (restreinte au
> bundle ID `com.niqo.africa`). Il est **destiné à être bundlé dans l'APK** et
> donc accessible par décompilation. Firebase + Expo recommandent de le commit
> dans le repo — c'est aussi ce qui résout l'erreur "File ... is not checked in
> to your repository" lors du build EAS Cloud.
>
> Le **vrai secret** est `firebase-service-account.json` (Service Account JSON
> qui bypasse l'auth Firebase) — ce dernier est gitignored et uploadé sur
> Expo Dashboard, jamais sur GitHub.

---

## Ce qui reste — par ordre

### 1. FCM V1 API — Service Account JSON

Depuis juin 2024, Firebase a déprécié la "Cloud Messaging API (Legacy)" alias FCM Server Key. Expo Push utilise désormais **FCM V1 API** qui exige un Service Account JSON Google Cloud.

**Étapes :**

1. Console Firebase → projet Niqo → ⚙️ Paramètres du projet → onglet **Comptes de service**
2. Cliquer **"Générer une nouvelle clé privée"** → confirme → un fichier JSON se télécharge (ex : `niqo-1118d-firebase-adminsdk-xxxxx.json`)
3. **⚠️ NE COMMIT JAMAIS ce fichier** — il bypasse toute auth Firebase. Garde-le en local + upload-le immédiatement aux endroits qui en ont besoin.
4. **Renommer en `firebase-service-account.json`** (déjà gitignored)
5. **Upload sur Expo Dashboard** :
   - Va sur https://expo.dev → projet Niqo → onglet **Credentials** → **Android** → **FCM V1 service account key**
   - Clique **Upload** et sélectionne `firebase-service-account.json`
   - Expo le stocke et l'utilise pour envoyer les push Android

**Alternative CLI** (si le Dashboard est down) :
```bash
eas credentials --platform android
# → Service account key for Push Notifications (FCM V1) → Upload
```

### 2. Build dev client Android

Pour tester avant le build production :

```bash
# Pré-requis : être loggé dans EAS
eas login   # → email + password Expo

# Build le dev client Android (APK installable sur device)
eas build --profile development --platform android
```

Ça va :
1. Builder dans le cloud Expo (~10-15 min sur free tier)
2. Sortir une URL de l'APK quand fini
3. Installer l'APK sur device Android (download depuis l'URL → installer manuellement)
4. Lancer l'app dev client → scan QR du `npx expo start --dev-client`
5. Sign in dans Niqo → trigger `registerForPushNotifications()` → token FCM stocké dans `push_tokens`

### 3. Tester un push

Une fois le token enregistré :

**Option A — Via Expo Push Tool (debug)**
- https://expo.dev/notifications
- Coller le token (récupérable via `select * from push_tokens where user_id = 'ton-uid' order by last_used_at desc limit 1`)
- Envoyer un test push → vérifier la réception sur device

**Option B — Via fonction métier réelle**
- Compte A propose un RDV à compte B (où B a le device Android avec le token enregistré)
- Le trigger `tg_push_rdv_proposed` (mig 66) déclenche `fn_send_push` → pg_net → Edge Function → Expo Push → FCM → device

### 4. Vérifier dans les logs Edge Function

```bash
# Dans Supabase Dashboard → Edge Functions → push-notify → Logs
# OU via CLI :
supabase functions logs push-notify --tail
```

Tu dois voir des appels avec `tickets[].status === "ok"`. Si `error: DeviceNotRegistered`, c'est que le token est invalide (cron `purge_stale_tokens` mig 68 le retirera au prochain run).

---

## Pré-requis matériel pour tester

- **Device Android physique** OU **émulateur Android Studio** (avec Google Play Services installé — important pour FCM)
- Si émulateur : choisir une AVD avec "Google Play" dans le nom (ex : `Pixel 6 API 34 (Google Play)`), pas "Google APIs"
- Connexion internet sur le device (FCM transite par les serveurs Google)

---

## Coûts

- **Firebase Spark (gratuit)** : quota FCM de plusieurs millions de messages/mois (largement suffisant MVP)
- **EAS Build free tier** : 30 builds/mois, ~10-15 min chacun. Largement suffisant pour le dev. Si on attaque les builds prod fréquents → upgrade EAS Production ($29/mois) plus tard.

---

## Risques connus

- **Plan Blaze invitation** : Firebase pousse vers Blaze (carte de crédit + crédit 300$). **Refuser** — Spark suffit pour FCM, et on évite le risque de surfacturation accidentelle.
- **Service Account JSON committé par erreur** : double-checke que `firebase-service-account.json` est bien dans `.gitignore` avant tout `git add`.
- **Cron `purge_stale_tokens` (mig 68)** : si l'app n'envoie pas de push pendant 60j, les tokens sont purgés. Pas critique mais à surveiller en early stage.

---

## Validation — état au 2026-05-09

### ✅ Déjà validé (test 2026-05-09 sur Redmi Note 13 Pro 5G)

- [x] Pipeline DB → pg_net → Edge Function → Expo Push → FCM V1 → device Android
- [x] Service Account FCM V1 uploadé sur Expo (profil `development`)
- [x] `google-services.json` bundlé dans l'APK Android
- [x] Token Android s'enregistre dans `push_tokens` au login (RPC `register_push_token`)
- [x] Notif système Android arrive (titre + body + son default + priority high)
- [x] Channel Android `default` reconnue (créée par `expo-notifications` automatiquement)
- [x] Cron `purge_stale_tokens` actif en prod (mig 68 — purge les `DeviceNotRegistered`)

> **Méthode** : `select public._notify_push(array['<uid>']::uuid[], 'Test', 'Body', '{}'::jsonb)` depuis SQL Editor → push reçu en ~3s sur Redmi.

### 🔴 À valider avant lancement prod (bloquants)

- [ ] **Credentials profil `production` vérifiées** :
  ```bash
  eas credentials --platform android
  # → sélectionner "production" → vérifier que FCM V1 service account est aussi assigné
  ```
  Si non assigné → ré-uploader le service account pour le profil production (mêmes étapes que pour development).
- [ ] **Build production réel** : `eas build --profile production --platform android` puis re-tester `_notify_push` sur cet APK. Hermes + ProGuard + R8 + signature release peuvent introduire des comportements différents du dev client.
- [ ] **Test sur device baseline Niqo** : Tecno Spark, Itel A56, ou Infinix Smart (couches HiOS/ItelOS plus agressives que MIUI). Acheter d'occasion ou tester via un proche en CI/CG.

### 🟡 À valider avant lancement (forte recommandation)

- [ ] **Cold start Android** : ferme complètement l'app → envoie un push avec `data: {"url": "/messages"}` → tap la notif → l'app doit s'ouvrir directement sur Messages (pas Home). Géré par `lib/push.ts` via `getLastNotificationResponseAsync()`.
- [ ] **Foreground vs background** : tester les 2 chemins de code (notif système Android quand app en background, listener `addNotificationReceivedListener` quand app en foreground).
- [ ] **Symétrie iOS** : lancer le même `_notify_push` SQL avec un user_id côté iPhone perso pour confirmer qu'iOS fonctionne aussi (APNs auto, déjà validé en théorie mais bon à re-checker).
- [ ] **Icône notif Android** : vérifier visuellement que l'icône Niqo apparaît bien dans la barre de statut Android (pas un carré gris). Android Lollipop+ exige une icône monochrome blanche transparente — déjà configurée dans `app.json` `expo-notifications.icon`, mais à valider visuellement.

### 🟢 À surveiller en prod (post-lancement)

- [ ] **Latence réseau 3G/Edge en CI/CG** : FCM peut prendre 30-60s à délivrer chez un user sur Edge. Si signalements users → c'est attendu, pas un bug.
- [ ] **Rate limit Expo Push** : free tier ~600/sec, illimité en volume. Largement OK pour MVP. Si scale > 10k users actifs/jour → activer `EXPO_ACCESS_TOKEN` (cf. `send-push-notification/index.ts:63`) pour rate-limit étendu.
- [ ] **Channels Android multiples** (Phase 2) : aujourd'hui tout passe par `default`. Idéalement, channels séparés (`messages`, `rdv`, `marketing`) pour que l'user puisse couper certaines catégories sans tout couper.

### Checklist condensée pour copier-coller (état au lancement)

```
[ ] eas credentials --platform android → profil production → FCM V1 assigné
[ ] eas build --profile production --platform android (build réussi)
[ ] _notify_push test SQL sur APK production (push reçu)
[ ] Test sur 1 Tecno OU 1 Itel (pas juste Redmi)
[ ] Cold-start Android (app fermée → tap notif → bon écran)
[ ] Foreground + background (les 2 chemins de code)
[ ] iOS test équivalent (symétrie)
[ ] Icône Niqo visible dans barre statut Android (pas carré gris)
```
