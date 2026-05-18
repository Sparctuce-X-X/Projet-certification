# Module Modération automatique — Backend

> Source de vérité backend du module **Modération automatique** (CDC v4.0 §2.7, hors numéro de feature).
> Couvre : couche 1 substring DB (`mots_interdits` + triggers, mig 29+105+117+118), couche 2 contextuelle ML texte (Edge Function `moderate-text` + OpenAI Moderation API), couche 3 enforcement images (Edge Function `moderate-image` + AWS Rekognition), **couche 4 modération messagerie async (Edge Function `moderate-message` + OpenAI Moderation API)**, wiring client mobile.
>
> **Migrations concernées** : **29 (table `mots_interdits` + helper `fn_check_forbidden_words` + triggers BEFORE INSERT/UPDATE annonces & messages)**, **35 (bypass `type='systeme'` sur trigger messages)**, **94 (REVOKE EXECUTE `fn_check_forbidden_words` from authenticated)**, **105 (RLS deny-all `mots_interdits`)**, **117 (seed 42 scam patterns marketplace)**, **118 (seed 6 patterns adulte zone grise OpenAI)**, **119 (user système Niqo Auto-Modération pour signalements auto)**, **120 (trigger AFTER INSERT messages → pg_net → `moderate-message`)**.
>
> **Tier RGPD** : 🟢 **P2** texte ; 🟡 **P1** images (transfert binaire vers AWS Rekognition eu-west-1, stateless). Logs `niqo_event_log` (mig 106) stockent `text_preview` (100 chars) UNIQUEMENT en cas critique (`moderation.critical_minors`) pour permettre à l'admin de prendre une décision éclairée. Les autres flags loggent juste les catégories + longueur. Côté images : AWS ne persiste rien (Rekognition stateless), Niqo ne logue jamais le binaire — uniquement `image_bytes` (taille) + `labels` (top-level Rekognition).

---

## 1. Vue d'ensemble — 4 couches en cascade

```
   TEXTE annonce            IMAGES annonce               MESSAGES chat
       │                          │                           │
       ▼                          ▼                           ▼
┌──────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│ COUCHE 1 (sync)  │     │ COUCHE 3 (sync)    │     │ COUCHE 1 (sync)    │
│ DB trigger       │     │ moderate-image EF  │     │ DB trigger         │
│ mots_interdits   │     │ AWS Rekognition    │     │ mots_interdits     │
│ (BEFORE INSERT)  │     │ (eu-west-1)        │     │ (BEFORE INSERT)    │
│ 111 entrées      │     │ AVANT upload Storage     │ Bypass type=systeme│
└──────────────────┘     └────────────────────┘     └────────────────────┘
       │                          │                           │
       ▼                          ▼                           ▼
┌──────────────────┐                                ┌────────────────────┐
│ COUCHE 2 (sync)  │                                │ COUCHE 4 (async)   │
│ moderate-text EF │                                │ moderate-message EF│
│ OpenAI Moderation│                                │ OpenAI Moderation  │
│ AVANT INSERT     │                                │ APRÈS INSERT       │
│ (bloque publi)   │                                │ → signalement auto │
└──────────────────┘                                │   (system user)    │
                                                    └────────────────────┘
```

**Pourquoi 4 couches** :

- **Couche 1** est ultra-rapide, déterministe, non contournable (appliquée au niveau trigger DB, un client qui skip l'appel Edge Function est quand même bloqué). Couvre les patterns canoniques (armes, drogues, OTP, paiement à l'avance, URLs raccourcies). 0 faux positif sur substring matching strict. **S'applique à la fois aux annonces et aux messages**.
- **Couche 2** apporte la classification contextuelle ML sur le texte d'annonce : détecte `sexual`, `hate`, `violence`, `self-harm`, `illicit` sans avoir besoin de connaître les mots à l'avance. Bypassable techniquement (un attaquant qui forge l'INSERT direct skip cette couche), mais la couche 1 rattrape les pires patterns + F08 Signalements rattrape le reste post-publication.
- **Couche 3** est le seul bouclier image : pas d'équivalent DB-trigger possible (Postgres ne lit pas les pixels). Bypassable (attaquant qui upload directement sur Storage en sautant l'EF), mais le wizard Step4Photos est le seul chemin de publication via l'app mobile MVP. F08 Signalements rattrape les images NSFW restantes post-publication.
- **Couche 4** scanne les messages chat **APRÈS** insertion (async via trigger DB + pg_net) : ne dégrade pas la latence chat (le destinataire voit le message instantanément). Si flagged → signalement auto attribué au user système. La cascade existante (3 signalements confirmés/30j → auto-suspend score_abus≥3) prend le relais. Best-effort, fail-open : un message toxique non détecté est rattrapé par F08 Signalements communauté.

---

## 2. Couche 1 — substring DB (mots_interdits)

### Table `public.mots_interdits` (mig 29)

| Colonne | Type | Default | Sémantique |
|---|---|---|---|
| `id` | `serial` | — | PK |
| `mot` | `text` | — | Substring à matcher, case-insensitive (UNIQUE) |
| `categorie` | `text` | `'autre'` | Étiquette pour stats admin |
| `created_at` | `timestamptz` | `now()` | — |

**Catégories** : `armes`, `drogues`, `contrefaçons`, `adulte`, `arnaques`, `animaux`, `insultes` (mig 29) + `arnaques_otp`, `arnaques_avance`, `arnaques_frais`, `arnaques_liens` (mig 117).

**Total entries** : 63 mig 29 + 42 mig 117 = **105 patterns**.

**Sécurité** : RLS deny-all (mig 105) — aucun client ne peut télécharger la liste pour la bypasser via orthographes alternatives. Lecture exclusivement via le SECURITY DEFINER helper qui bypasse la RLS.

### Helper `fn_check_forbidden_words(text)` (mig 29)

SECURITY DEFINER, search_path locked (mig 94), EXECUTE revoked from `authenticated` (mig 94). Appel uniquement depuis les triggers, pas depuis le client.

```sql
position(lower(m.mot) in lower(p_text)) > 0  -- substring match, case-insensitive
```

Returns le premier mot trouvé, ou `null` si rien.

### Triggers

| Trigger | Surface | Mig | Comportement |
|---|---|---|---|
| `tg_annonces_content_filter` | BEFORE INSERT/UPDATE `annonces` | 29 | Check titre + description → raise `'contenu_interdit'` (P0001) |
| `tg_messages_content_filter` | BEFORE INSERT `messages` | 29 | Check contenu → raise `'contenu_interdit'`. Bypass si `NEW.type = 'systeme'` (mig 35) |

### Décisions de scope (zero faux positif)

Patterns explicitement écartés (auraient causé des faux positifs en substring matching) :

- ❌ `envoie code` → match `code postal/wifi/promo`
- ❌ `frais de transfert` → match cession véhicule (carte grise)
- ❌ bare `t.me/` / `t.co/` → match `petit.me/` / `petit.co/`
- ❌ `wave avance` / `mtn avance` → match "comment avance ton projet"
- ❌ patterns email / téléphone → faux positifs élevés sur diaspora + business pro
- ❌ `whatsapp` / `caution` / `frais livraison` → gray zone, reportés couche 2

---

## 3. Couche 2 — OpenAI Moderation API

### Edge Function `moderate-text`

**Fichier** : `supabase/functions/moderate-text/index.ts`

**Endpoint** : `POST /functions/v1/moderate-text`

**Auth** : JWT user via Authorization header (pattern `pawapay-init-deposit`). Refuse anon (anti-DDoS, anti-cost).

**Request** :
```json
{
  "texte": "Mon iPhone à vendre, paiement à l'avance via Wave",
  "surface": "annonce.create" | "annonce.update" | "message"
}
```

**Response 200 — pass** :
```json
{ "ok": true }
```

**Response 200 — flag** :
```json
{
  "ok": false,
  "reason": "sexual",
  "hint": "Le texte contient du contenu à caractère sexuel non autorisé."
}
```

**Errors** : `AUTH_REQUIRED` (401), `AUTH_INVALID` (401), `INVALID_JSON` (400), `INVALID_SURFACE` (400), `EMPTY_TEXT` (400), `TEXT_TOO_LONG` (413, >4 000 chars), `METHOD_NOT_ALLOWED` (405).

### Catégories OpenAI → décision Niqo

OpenAI Moderation `omni-moderation-latest` retourne 11 catégories booléennes. Mapping Niqo :

| Catégorie OpenAI | Décision | Hint FR |
|---|---|---|
| `sexual` | 🔴 **BLOCK** | Contenu à caractère sexuel non autorisé |
| `sexual/minors` | 🔴🔴 **BLOCK + CRITIQUE** (Sentry error + niqo_event_log severity=error → alerte admin) | Contenu impliquant des mineurs. Tentative enregistrée |
| `violence` | 🔴 **BLOCK** | Contenu violent non autorisé |
| `violence/graphic` | 🔴 **BLOCK** | Contenu violent explicite |
| `hate` | 🔴 **BLOCK** | Propos haineux |
| `hate/threatening` | 🔴 **BLOCK** | Menaces haineuses |
| `self-harm` | 🔴 **BLOCK** | Contenu lié à l'automutilation |
| `self-harm/intent` | 🔴 **BLOCK** | Intention d'automutilation |
| `illicit` | 🔴 **BLOCK** | Activité illicite |
| `illicit/violent` | 🔴 **BLOCK** | Activité illicite violente |
| `harassment/threatening` | 🔴 **BLOCK** | Menaces |
| `harassment` | 🟢 **PASS** (trop contextuel pour bloquer en négociation marketplace) | — |
| `self-harm/instructions` | 🟢 **PASS** (cas marketplace ~jamais rencontré) | — |

### Fail-open strategy

L'Edge Function fail-open dans 3 cas :

1. **OPENAI_API_KEY absent** (dev local) → log `moderation.api_disabled` (warning) + return `{ok:true}`
2. **OpenAI HTTP timeout / 5xx** → log `moderation.api_error` (warning) + Sentry `captureMessage` + return `{ok:true}`
3. **OpenAI returns 200 mais `results` vide** → log Sentry `captureMessage` + return `{ok:true}`

**Justification** : un user honnête ne doit pas être bloqué par une panne externe. La couche 1 mots_interdits couvre déjà les pires patterns au niveau DB. Les contenus borderline qui passeraient en cas de panne seront rattrapés par F08 (signalements communauté + auto-suspend score≥3).

Côté client (`lib/moderation.ts`) : `supabase.functions.invoke` qui échoue (network mobile, timeout) → return `{ok:true}` de la même façon. La couche 1 DB reste la dernière ligne de défense non bypassable.

### Secrets requis

```bash
supabase secrets set OPENAI_API_KEY=sk-...
# Optionnel — override default omni-moderation-latest :
# supabase secrets set OPENAI_MODERATION_MODEL=text-moderation-latest
```

**Coût** : 0€. Le modèle `omni-moderation-latest` est **gratuit** sur l'API OpenAI (annoncé par OpenAI en oct. 2024). Pas de plafond rate limit problématique pour Niqo MVP.

### Déploiement

**Production** — passer par le script pre-deploy qui lance les tests live avant le push :

```bash
npm run deploy:moderate-text
```

Ce script (`scripts/predeploy-moderate-text.sh`) :
1. Démarre `supabase functions serve moderate-text` en background contre `supabase/.env`
2. Attend que l'EF réponde (curl probe, max 30s)
3. Lance la suite Vitest avec `MODERATE_TEXT_SERVED=true OPENAI_AVAILABLE=true` → tests A1-E1 + D1 actifs
4. Si vert → demande confirmation interactive → `supabase functions deploy moderate-text`
5. Si rouge → abort, EF non déployée

**Justification** : la CI GitHub Actions (`backend-tests.yml`) skip la suite moderation parce que Edge Functions runtime n'est pas exposé en CI. Le pre-deploy live test comble ce gap au moment où il a le plus de valeur (juste avant push prod).

**Bypass manuel** (déconseillé) :
```bash
supabase functions deploy moderate-text
```

---

## 3bis. Couche 3 — AWS Rekognition (images)

### Edge Function `moderate-image`

| | |
|---|---|
| Path | `supabase/functions/moderate-image/index.ts` |
| Auth | JWT user obligatoire (refuse anon → anti-DDoS, anti-coût) |
| Body | `{ photo_base64: string, surface: "annonce.create" }` |
| Response | `{ ok: boolean, reason?, hint? }` |
| Surface | `annonce.create` uniquement (PAS update — édition n'autorise pas le changement de photos en MVP) |
| Modèle | AWS Rekognition `DetectModerationLabels` (MinConfidence 75%) |
| Région | `eu-west-1` (Irlande) — choisie pour RGPD UE + RTT acceptable vers Supabase EU |
| Timeout | 5 s (au-delà → fail-open) |
| Body limit côté EF | base64 ≤ 4 500 000 chars (~3.4 MB binaire) ; rejected via `IMAGE_TOO_LARGE` |
| Sanity check binaire | 1 KB ≤ taille ≤ 5 MB (limites Rekognition) |

### Catégories Rekognition → décision Niqo

`DetectModerationLabels` retourne une liste hiérarchique. On bloque sur les **top-level labels** suivants (match du `Name` OU `ParentName`) :

| Label AWS | Critique ? | Hint FR |
|---|---|---|
| `Explicit Nudity` | non | L'image contient de la nudité explicite, ce qui est interdit. |
| `Explicit` | non | L'image contient du contenu explicite, ce qui est interdit. |
| `Non-Explicit Nudity of Intimate parts and Kissing` | non | L'image contient du contenu intime non autorisé. |
| `Suggestive` | non | L'image contient du contenu suggestif à caractère sexuel, ce qui est interdit. |
| `Violence` | non | L'image contient du contenu violent, ce qui est interdit. |
| `Visually Disturbing` | non | L'image contient du contenu visuellement perturbant, ce qui est interdit. |
| `Drugs & Tobacco` / `Drugs & Tobacco Paraphernalia & Use` | non | L'image contient des drogues / objets liés à la drogue, ce qui est interdit. |
| `Hate Symbols` | ✅ oui | L'image contient des symboles haineux. Cette tentative est enregistrée. |

Cohérent avec mig 118 (le texte `suggestive` est aussi bloqué — pas de zone grise asymétrique entre photo et description).

### Fail-open strategy

Comme couche 2 : si Rekognition timeout/5xx → return `{ ok: true }` + `niqo_event_log` `moderation.image.api_error` (severity=warning). Justification :

- L'EF n'est PAS le seul bouclier — F08 Signalements rattrape (auto-suspend score≥3).
- Un user honnête en CI/CG (3G instable) ne doit pas être bloqué par une panne AWS externe.
- Pour les cas critiques (Hate Symbols flag confirmé), la severity passe à `error` → trigge l'alerte digest Resend quotidienne (mig 108).

### Secrets requis

| Secret | Source | Notes |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user `niqo-rekognition` | Policy `AmazonRekognitionReadOnlyAccess` (couvre `DetectModerationLabels`) |
| `AWS_SECRET_ACCESS_KEY` | IAM user `niqo-rekognition` | Affiché une seule fois à la création de la key |
| `AWS_REGION` | — | Default `eu-west-1`. Override possible si on déplace l'infra. |

À set via :

```bash
supabase secrets set AWS_ACCESS_KEY_ID=AKIA...
supabase secrets set AWS_SECRET_ACCESS_KEY=...
supabase secrets set AWS_REGION=eu-west-1
```

### Déploiement

**Recommandé** — via le script pre-deploy qui lance les live tests AVANT push :

```bash
npm run deploy:moderate-image
```

Le script :
1. Vérifie `supabase/.env` contient les 2 clés AWS
2. Vérifie `supabase start` tourne
3. Lance `supabase functions serve moderate-image` en background (curl probe max 30s)
4. Exécute `MODERATE_IMAGE_SERVED=true AWS_AVAILABLE=true npm test moderation-image`
5. Demande confirmation interactive si verts
6. `supabase functions deploy moderate-image`
7. Cleanup background EF (trap EXIT INT TERM)

**Bypass manuel (déconseillé)** :

```bash
supabase functions deploy moderate-image
```

---

## 3ter. Couche 4 — modération messagerie async (`moderate-message`)

À la différence des couches 2 et 3 qui sont **bloquantes** (refus avant publication), la couche 4 tourne en **fire-and-forget après l'INSERT** d'un message. Pourquoi async :

- **Latence chat critique** : ajouter 300-500 ms de scan OpenAI avant chaque envoi dégrade l'UX (l'utilisateur voit son message en pending). Inacceptable sur 3G CI/CG.
- **Cascade signalement existante suffit** : F08 mig 25/56-57 auto-suspend l'user à 3 signalements confirmés en 30j. Cette cascade rattrape les cas toxiques sans bloquer le destinataire.
- **Couche 1 mots_interdits reste enforced** sur les messages (mig 29 trigger BEFORE INSERT) : les pires patterns (armes, insultes canoniques, OTP, etc.) sont déjà filtrés au niveau DB.

### Architecture

```
INSERT messages (user mobile via PostgREST)
   │ (RLS-checked)
   ▼
Trigger BEFORE INSERT tg_messages_content_filter (mig 29, couche 1)
   ├─ contient un mot interdit ? raise → INSERT bloqué
   └─ OK → INSERT committed
   ▼
Trigger AFTER INSERT trg_moderate_message_async (mig 120, couche 4)
   ├─ filtre : type='texte' AND auteur != system_user AND not deleted
   └─ public._invoke_moderate_message(NEW.id)
        ▼
        pg_net.http_post (fire-and-forget non-bloquant)
        ▼
   Edge Function moderate-message
        ├─ Auth NIQO_INTERNAL_KEY (secret partagé, constant-time match)
        ├─ Load message via service_role
        ├─ OpenAI Moderation API (omni-moderation-latest)
        └─ Si flagged →
             INSERT public.signalements (
               target_type='message',
               target_id=NEW.id,
               signaleur_id='00000000-0000-0000-0000-000000000001' (system)
             )
             ▼
             AVERTISSEMENT UTILISATEUR (fire-and-forget) :
               1. INSERT message type='systeme' dans la conv (visible 2 parties)
                  "⚠ Modération Niqo : un contenu détecté comme inapproprié..."
               2. Push notif privative à l'auteur via send-push-notification EF
                  "Avertissement Niqo — ton dernier message..."
             ▼
             Trigger fn_signalement_check_threshold (mig 25)
             (déclenché plus tard quand admin passe à 'traite')
             → score_abus++ → si >=3 en 30j : is_active=false
```

### User système Niqo Auto-Modération (mig 119)

| | |
|---|---|
| UUID figé | `00000000-0000-0000-0000-000000000001` |
| Email | `auto-moderation@niqo.africa` (jamais consulté) |
| Identité affichée | "Niqo Auto-Modération" (visible dans back-office signalements) |
| `is_active` | `true` (sinon RLS éventuelle bloquerait l'INSERT signalement) |
| `is_admin` | `false` |
| `auth.users.aud` / `role` | `authenticated` (sinon GoTrue refuse le compte) |
| `raw_app_meta_data.provider` | `email` |

**Pourquoi un user dédié plutôt qu'un `signaleur_id` nullable** :
- Garde la contrainte UNIQUE `(target_type, target_id, signaleur_id)` qui dédoublonne automatiquement les re-scans (idempotence).
- Garde le schéma signalements + back-office admin inchangé.
- Permet de filtrer trivialement `signaleur_id = SYSTEM_UUID` pour distinguer les signalements communauté vs auto.

### Edge Function `moderate-message`

| | |
|---|---|
| Path | `supabase/functions/moderate-message/index.ts` |
| Auth | `NIQO_INTERNAL_KEY` shared secret (gateway `verify_jwt=false`, EF check constant-time) |
| Body | `{ message_id: uuid }` |
| Response | `{ ok: true }` toujours (fail-open) ou `{ error: "..." }` sur validation |
| Modèle | OpenAI `omni-moderation-latest` |
| Timeout | 5 s |
| Max input | 4 000 chars (slice du contenu si plus long) |
| Coût | 0€ (free tier OpenAI Moderation) |

### Catégories OpenAI → décision Niqo

À la différence de `moderate-text` qui **skip** `harassment` (zone grise négociation), `moderate-message` **flag** `harassment` car en chat ciblé c'est un vrai problème (insultes directes au vendeur/acheteur).

| Catégorie OpenAI | Critique ? | Motif signalement |
|---|---|---|
| `sexual` | non | Contenu sexuel |
| `sexual/minors` | ✅ oui | Contenu impliquant des mineurs (CRITIQUE) |
| `violence` | non | Contenu violent |
| `violence/graphic` | non | Violence explicite |
| `hate` | non | Propos haineux |
| `hate/threatening` | ✅ oui | Menaces haineuses |
| `harassment` | non | Harcèlement |
| `harassment/threatening` | ✅ oui | Menaces |
| `self-harm` | non | Contenu lié à l'automutilation |
| `self-harm/intent` | ✅ oui | Intention d'automutilation |
| `illicit` | non | Activité illicite |
| `illicit/violent` | ✅ oui | Activité illicite violente |

Les cas critiques → `niqo_event_log` severity=`error` + `captureMessage` Sentry → alert digest Resend quotidien.

### Fail-open strategy

Toute erreur (message introuvable, OpenAI 5xx, INSERT signalement échoue) → log + `return 200 ok:true`. On ne veut JAMAIS faire échouer le caller (pg_net est non-bloquant, le retour HTTP de l'EF n'affecte rien — mais ça garde des logs propres).

Si `OPENAI_API_KEY` n'est pas set côté EF → log `moderation.message.api_disabled` + skip. La couche 1 reste enforced au niveau DB.

### Secrets requis

| Secret | Source | Notes |
|---|---|---|
| `NIQO_INTERNAL_KEY` | shared avec Vault Postgres (mig 65) | Stocké AUSSI dans `vault.decrypted_secrets` sous le nom `service_role_key` (même valeur que pour push notif). |
| `OPENAI_API_KEY` | compte OpenAI Niqo | Même clé que `moderate-text`. |
| `OPENAI_MODERATION_MODEL` | optionnel | Default `omni-moderation-latest`. |

À set via :

```bash
supabase secrets set NIQO_INTERNAL_KEY=$(openssl rand -hex 32)
supabase secrets set OPENAI_API_KEY=sk-...
```

Puis stocker la MÊME valeur dans Vault Postgres :

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'service_role_key'),
  '<MÊME-VALEUR>'
);
-- ou si pas existant : vault.create_secret('<VALEUR>', 'service_role_key', '...')
```

### Déploiement

**Recommandé** — script pre-deploy avec live tests :

```bash
npm run deploy:moderate-message
```

Le script :
1. Vérifie `supabase/.env` contient `OPENAI_API_KEY` + `NIQO_INTERNAL_KEY`
2. Vérifie `supabase start` tourne
3. Lance `supabase functions serve moderate-message` en background
4. Exécute `MODERATE_MESSAGE_SERVED=true OPENAI_AVAILABLE=true npm test moderation-message`
5. Demande confirmation
6. `supabase functions deploy moderate-message`

**Bypass manuel (déconseillé)** :

```bash
supabase functions deploy moderate-message
```

⚠ **Ne PAS oublier d'appliquer les migs 119 + 120 dans Supabase Dashboard SQL Editor AVANT le premier déploiement** — sinon le trigger n'existe pas et le scan n'est jamais déclenché. Vérifier post-mig :

```sql
select tgname from pg_trigger where tgname = 'trg_moderate_message_async';
select id, email from public.users where id = '00000000-0000-0000-0000-000000000001';
```

---

## 4. Wiring client (mobile)

### `lib/moderation.ts`

- `moderateText({ texte, surface })` → wrapper sur `supabase.functions.invoke('moderate-text', ...)`
- `moderateAnnonceText({ titre, description, surface })` → helper concat titre+description séparés par double newline

Returns `{ ok, reason?, hint? }`. Fail-open si l'invoke échoue (timeout réseau, etc.).

### Intégration dans `lib/annonces.ts`

#### `createAnnonce()` — placé AVANT photo upload

```ts
const moderation = await moderateAnnonceText({
  titre: input.titre,
  description: input.description,
  surface: "annonce.create",
});
if (!moderation.ok) {
  throw new Error(`moderation_blocked: ${moderation.hint ?? "..."}`);
}
// → ensuite upload photos + INSERT (mots_interdits trigger reste enforced)
```

**Pourquoi avant upload** : fail-fast. Si le texte est rejeté, on évite d'uploader 5 photos puis de devoir les cleanup. Coût latence : +300-500ms si pass, mais c'est avant le block lent d'upload de toute façon.

#### `updateAnnonce()` — uniquement si patch touche titre OU description

```ts
if (cleanPatch.titre !== undefined || cleanPatch.description !== undefined) {
  const moderation = await moderateText({ ... });
  if (!moderation.ok) throw new Error(`moderation_blocked: ...`);
}
```

### Error mapping `lib/annonces/errors.ts`

Marqueur sentinel `moderation_blocked:` reconnu en case 0 du mapper (avant les match de contrainte) → pass-through du hint FR généré par l'Edge Function tel quel à l'user.

### `moderateImage({ uri, surface })` (couche 3 images)

Wrapper côté client de `moderate-image`. Pipeline interne :

1. **Resize** local via `expo-image-manipulator` à 1024 px côté long max, JPEG quality 0.75 → base64 obtenu directement via `saveAsync({ base64: true })`.
2. **Invoke** `supabase.functions.invoke('moderate-image', { body: { photo_base64, surface } })`.
3. **Fail-open** si compression / invoke / timeout échouent → return `{ ok: true }`.

Pourquoi resize avant envoi :
- Rekognition donne le même résultat sur 1024 px que sur 4032 px pour la détection NSFW (modèles entraînés sur low-res).
- Économie bande passante CI/CG (3G : 100 KB vs 3 MB = 10× plus rapide).
- Coût Rekognition identique (per-image, pas per-pixel) mais latence plus basse.

### Intégration dans `components/sell/Step4Photos.tsx`

```ts
// Après ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true })
const newUris = result.assets.map((a) => a.uri);
setScanning(true);
const accepted = await filterUrisByModeration(newUris); // scan parallèle
if (accepted.length === 0) return;
onChange({ photoUris: [...photoUris, ...accepted].slice(0, MAX_PHOTOS_PER_ANNONCE) });
setScanning(false);
```

`filterUrisByModeration` :
- `Promise.allSettled` sur toutes les URIs (scan en parallèle).
- Promesses `rejected` → fail-open (la photo passe).
- Réponses `ok:false` → exclues + `Alert.alert` affichant le `hint` de la première rejetée.
- Réponses `ok:true` → ajoutées à la queue `photoUris`.

UX : spinner pendant le scan dans le bouton "Ajouter une photo" (label "Analyse en cours… Vérification de la photo"), disabled. Latence typique 600-1500 ms pour 1-5 photos parallèles.

---

## 5. Observabilité (niqo_event_log + Sentry)

Tous les appels de l'Edge Function `moderate-text` produisent un event dans `niqo_event_log` (mig 106) :

**Couche 2 — `moderate-text`** :

| `event_type` | `severity` | Quand | Payload |
|---|---|---|---|
| `moderation.passed` | `info` | Texte OK | `{surface, text_length}` |
| `moderation.flagged` | `warning` | Au moins 1 catégorie bloquante hors critical | `{surface, categories, text_length}` |
| `moderation.critical_minors` | `error` | `sexual/minors` flagged | `{surface, category, text_length, text_preview}` (100 chars) |
| `moderation.api_error` | `warning` | OpenAI HTTP 4xx/5xx ou timeout | `{surface, http_status?, error?, text_length}` |
| `moderation.api_disabled` | `warning` | `OPENAI_API_KEY` non set | `{surface, text_length, reason: "no_openai_key"}` |

**Couche 3 — `moderate-image`** :

| `event_type` | `severity` | Quand | Payload |
|---|---|---|---|
| `moderation.image.passed` | `info` | Image OK | `{surface, image_bytes}` |
| `moderation.image.flagged` | `warning` | Label AWS bloquant hors critical | `{surface, labels, image_bytes}` |
| `moderation.image.critical_hate` | `error` | `Hate Symbols` flagged | `{surface, label, all_labels, image_bytes}` |
| `moderation.image.api_error` | `warning` | Rekognition 4xx/5xx ou timeout | `{surface, image_bytes, error?}` |
| `moderation.image.api_disabled` | `warning` | `AWS_ACCESS_KEY_ID` non set | `{surface, image_bytes, reason: "no_aws_credentials"}` |

**Couche 4 — `moderate-message`** :

| `event_type` | `severity` | Quand | Payload |
|---|---|---|---|
| `moderation.message.passed` | `info` | Message clean | `{message_id, text_length}` |
| `moderation.message.flagged` | `warning` | Au moins 1 catégorie bloquante hors critical → signalement créé | `{message_id, categories, text_length}` |
| `moderation.message.critical` | `error` | Catégorie critique (sexual/minors, hate/threatening, harassment/threatening, self-harm/intent, illicit/violent) → signalement + Sentry error | `{message_id, category, all_categories, text_length}` |
| `moderation.message.duplicate` | `info` | Re-scan du même message déjà signalé (unique constraint) | `{message_id, categories}` |
| `moderation.message.not_found` | `info` | message_id introuvable (deleted entre INSERT et invoke) | `{message_id}` |
| `moderation.message.load_error` | `warning` | Échec SELECT messages | `{message_id, error_code}` |
| `moderation.message.api_error` | `warning` | OpenAI 4xx/5xx ou timeout | `{message_id, http_status?, error?, text_length}` |
| `moderation.message.insert_error` | `error` | INSERT signalement échoue (autre que duplicate) | `{message_id, categories, error_code}` |
| `moderation.message.api_disabled` | `warning` | `OPENAI_API_KEY` non set | `{message_id, text_length, reason: "no_openai_key"}` |
| `moderation.message.warning_sent` | `info` | Push + message système envoyés à l'offensant après signalement auto réussi | `{message_id, conversation_id, critical}` |
| `moderation.message.warning_message_failed` | `warning` | INSERT du message système chat échoue | `{message_id, error_code}` |

**Pas de `text_preview` / `image_preview` en log** sauf pour les events `error` (texte critique uniquement, 100 chars). Côté image : on ne logue **jamais** le binaire (RGPD + coût stockage).

**Sentry** :
- `captureMessage` warning sur `moderation.api_error` / `moderation.image.api_error`
- `captureMessage` error sur `moderation.critical_minors` / `moderation.image.critical_hate`
- `captureException` sur fetch throws (timeout, network)

**Dashboard `/admin/observability`** : les counts par event_type apparaissent automatiquement (no extra wiring) via les tiles de la mig 106-109.

**Alerte email digest** (mig 108) : `moderation.critical_minors` et `moderation.image.critical_hate` étant severity=error, déclenchent l'alert digest quotidien Resend → email aux recipients actifs.

---

## 6. Limites connues + roadmap

### Couche 1 (substring DB)

- ❌ Pas de regex (pas de pattern phone/email/full-URL)
- ❌ Pas de log des tentatives bloquées (un trigger `raise exception` ne loggue pas dans event_log par défaut — à ajouter en étape ultérieure si besoin de tracker les brouteurs qui tâtonnent)

### Couche 2 (OpenAI)

- ❌ **Bypassable** par un attaquant qui POST directement sur PostgREST `/annonces` sans appeler l'Edge Function. Acceptable pour MVP — la couche 1 + F08 rattrapent.
- ❌ Pas de scan **après** publication (un user pourrait éditer hors-flow ou updateAnnonce direct via API). Mitigé par RLS update strict (`statut='active'` only).
- ⚠ Multi-langue : OpenAI couvre bien le français standard, moins bien le Nouchi (CI) et lingala (CG). Pour ces argots, la couche 1 reste plus fiable (patterns Nouchi déjà dans `mots_interdits`).

### Couche 3 (Rekognition images)

- ❌ **Bypassable** par un attaquant qui upload directement sur Storage `annonces-photos` puis INSERT manuel sur `annonces` (le RLS storage gate juste l'ownership du sous-dossier, pas le contenu). Acceptable pour MVP — Step4Photos est le seul chemin via l'app. F08 Signalements rattrape le reste.
- ❌ Pas de scan **après** publication. Un user ne peut pas remplacer une photo via `updateAnnonce` en MVP (l'édition n'autorise pas le changement de photos — cf. lifecycle annonce). Mais un attaquant qui upload via API directe sur Storage POURRAIT mettre une photo NSFW sans passer par l'EF. Mitigation : audit régulier des derniers `niqo_event_log` `moderation.image.*` pour détecter une chute d'appels (= indice de bypass massif).
- ⚠ `MinConfidence = 75` : seuil compromis FP/FN. Trop bas (50) bloque des photos d'art ou de mode légitimes ; trop haut (90) laisse passer des images suggestives. À retuner après 1-2 mois de prod selon les false positives signalés par les vendeurs.
- ⚠ Pas de scan des photos de **profil** (avatar) ni des photos de **CNI vérification** — ces flux sont déjà gated (admin web validation manuelle pour CNI, profil interne au compte). Si on étend la modération à ces surfaces, ajouter une `surface: "profil.avatar"` et le wiring dans `lib/users.ts` / `lib/verification.ts`.

### Couche 4 (messagerie async)

- ❌ **Best-effort** : si OpenAI est down, le message passe sans signalement (fail-open). Couche 1 mots_interdits + F08 Signalements communauté rattrapent.
- ❌ Pas de scan **rétroactif** : seuls les messages insérés APRÈS déploiement de la mig 120 sont scannés. Si on veut auditer l'historique, écrire un script one-shot qui itère sur `messages` et call l'EF.
- ❌ Pas de scan des messages **système** (`type='systeme'` : confirmations RDV) ni des **images** envoyées en chat (`type='image'`). Décision phase 4 : "texte user uniquement" pour éviter le bruit log + PII (messages RDV contiennent prénoms/adresses qu'on ne veut pas envoyer à OpenAI).
- ⚠ **OpenAI = sous-traitant US** (San Francisco). Tout message chat scanné transite chez eux. Compte API Niqo configuré en **zero retention** (clause API standard 2024-12) → OpenAI ne stocke pas les messages au-delà du traitement temps réel. Documenté dans `docs/references/rgpd-audit.md` entrée #12. À mentionner en CGU v1.2 (sous-traitants) avant launch public.
- ⚠ Anti-loop : le trigger filtre `expediteur_id <> system_uuid`, et si l'EF est appelée 2× sur le même `message_id`, l'INSERT signalement échoue silencieusement (unique constraint) → log `moderation.message.duplicate`. Idempotent.

---

## 7. Vérifications après déploiement

### Couche 2 — `moderate-text`

```bash
# 1. Edge Function déployée
supabase functions list | grep moderate-text

# 2. Secret OPENAI_API_KEY set
supabase secrets list | grep OPENAI_API_KEY  # masked, juste vérifier présence

# 3. Smoke test invoke (texte clean)
curl -X POST "${SUPABASE_URL}/functions/v1/moderate-text" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"texte":"iPhone 13 état neuf","surface":"annonce.create"}'
# attendu : {"ok":true}
```

### Couche 3 — `moderate-image`

```bash
# 1. Edge Function déployée
supabase functions list | grep moderate-image

# 2. Secrets AWS set
supabase secrets list | grep -E "AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|REGION)"

# 3. Smoke test invoke (image clean — fournir une photo benign en base64)
PHOTO_B64=$(base64 -i ./tests/fixtures/clean.jpg | tr -d '\n')
curl -X POST "${SUPABASE_URL}/functions/v1/moderate-image" \
  -H "Authorization: Bearer ${USER_JWT}" \
  -H "Content-Type: application/json" \
  -d "{\"photo_base64\":\"${PHOTO_B64}\",\"surface\":\"annonce.create\"}"
# attendu : {"ok":true}
```

### Couche 4 — `moderate-message`

```bash
# 1. Migrations 119 + 120 jouées
psql -c "select id, email from public.users where id = '00000000-0000-0000-0000-000000000001';"
psql -c "select tgname from pg_trigger where tgname = 'trg_moderate_message_async';"

# 2. Edge Function déployée + verify_jwt=false
supabase functions list | grep moderate-message
grep -A 1 "moderate-message" supabase/config.toml

# 3. Secrets set
supabase secrets list | grep -E "(OPENAI_API_KEY|NIQO_INTERNAL_KEY)"

# 4. Vault sync
psql -c "select name from vault.decrypted_secrets where name in ('service_role_key','moderate_message_function_url');"

# 5. Smoke test : insère un message texte d'un user via SQL, attends 1-2s, vérifie event
psql <<SQL
-- Suppose qu'une conversation existe (récupère l'ID via SELECT FROM conversations LIMIT 1)
insert into public.messages (conversation_id, expediteur_id, type, contenu)
values ('<CONV_ID>', '<USER_ID>', 'texte', 'Salut, est-ce que c''est encore dispo ?');
SQL

# Attendre 1-2s puis :
psql -c "select event_type, payload->>'message_id' as mid, occurred_at
         from public.niqo_event_log
         where module = 'moderate-message'
         order by occurred_at desc limit 3;"
# attendu : moderation.message.passed (severity info)
```

### Events tracés

```sql
-- Couches 2 + 3 + 4 dans niqo_event_log
select module, event_type, severity, count(*)
from public.niqo_event_log
where module in ('moderate-text', 'moderate-image', 'moderate-message')
  and occurred_at > now() - interval '1 hour'
group by 1, 2, 3
order by 1, 2;
```
