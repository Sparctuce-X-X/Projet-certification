# Module Storage — Buckets Supabase Storage — Backend

> Source de vérité backend du module **Storage** (transversal). Couvre les **4 buckets Supabase Storage** consommés par Niqo : 1 pour les avatars utilisateurs, 1 pour les photos d'annonces, 1 pour les pièces d'identité KYC, 1 pour les preuves photos post-RDV. RLS bucket-level, triggers de purge en cascade, crons de purge RGPD, Edge Function `purge-annonces-photos`, et secrets Vault associés.
>
> **Migrations concernées** :
> - **09** (`avatars` public + RLS owner)
> - **14** (`annonces-photos` public + RLS owner, pas d'UPDATE par design)
> - **16** (cron `expire-annonces` + cron `purge-expired-annonces` + Edge Function URL/token via Vault + `fn_purge_expired_annonces`)
> - **46** (`cni-verifications` privé + RLS admin/owner)
> - **48** (RLS `cni-verifications` patch SELECT/UPDATE own — fix bug Supabase upload post-INSERT)
> - **53** (purge CNI au delete account — version SQL DELETE, supplantée par mig 73)
> - **54** (cron `purge-expired-kyc-verifications` + trigger `trg_purge_cni_storage` BEFORE DELETE)
> - **65** (Vault secret `service_role_key` pour HTTP fire-and-forget)
> - **73** (policy DELETE owner `cni-verifications` + simplification `delete_my_account` — purge passe côté client via Storage API HTTP)
> - **92** (`rencontre-photos` privé + RLS double-foldername + table `rencontre_photos` + RPC `add_rencontre_photo`)
> - **94** (security advisor — drop policies `*_public_read` listing leak + revoke EXECUTE triggers/crons + search_path lock fonctions storage)
> - **102** (lock `add_rencontre_photo` après `admin_signalement_decided_at` posé — defense in depth)
> - **110** (fix critique `trg_purge_cni_storage` — passage SQL DELETE → `net.http_delete` vers Storage REST API, débloque cron + cascade)
>
> **Tier RGPD** : 🔴 **P0** sur `cni-verifications` (PII sensibles, conservation bornée 30j/6mois/60j), 🟡 **P1** sur `annonces-photos` + `rencontre-photos` (photos liées à un user/annonce/RDV, cascade RGPD), 🟢 **P2** sur `avatars` (image profil, photo publique du user).

---

## 1. Vue d'ensemble

Niqo stocke 4 types de fichiers dans Supabase Storage. Chaque bucket a sa propre RLS, son propre cycle de vie, et son propre mécanisme de purge.

| Bucket | Public | Path pattern | RLS INSERT | RLS SELECT | RLS DELETE | Purge auto | Migs |
|---|---|---|---|---|---|---|---|
| `avatars` | ✅ true | `{uid}/avatar.{ext}` | owner (`foldername[1] = uid`) | public via CDN (URL directe) | owner | manuel via client `delete_my_account` | 09, 94 |
| `annonces-photos` | ✅ true | `{uid}/{annonceId}/{uuid}.{ext}` | owner (`foldername[1] = uid`) | public via CDN (URL directe) | owner | cron `purge-expired-annonces` daily 03h → Edge Function `purge-annonces-photos` | 14, 16, 94 |
| `cni-verifications` | 🔒 false | `{uid}/{verif_id}/{recto\|verso\|selfie}.jpg` | owner (`foldername[1] = uid`) | owner + admin | owner + admin | cron `purge-expired-kyc-verifications` daily 03h → trigger HTTP DELETE vers Storage REST | 46, 48, 54, 73, 94, 110 |
| `rencontre-photos` | 🔒 false | `{conv_id}/{uid}/{photo_id}.jpg` | owner (`foldername[2] = uid` + participant check) | owner (auteur seul) + admin | admin uniquement | aucun automatique (TODO Phase 2 : purge si conv supprimée >90j) | 92, 102, 94 |

**Invariants non-négociables :**

| Invariant | Enforcement |
|---|---|
| Aucun user ne peut écrire dans le folder d'un autre user | RLS storage.objects `(storage.foldername(name))[1] = auth.uid()::text` (avatars / annonces-photos / cni) ou `[2] = uid + participant check` (rencontre-photos) |
| Buckets publics → URL CDN directe pour browse-first | `avatars.public = true`, `annonces-photos.public = true` — pas besoin d'URL signée ni de policy SELECT, le CDN sert tout objet à n'importe qui qui connaît le path |
| Buckets privés → 0 URL publique possible | `cni-verifications.public = false` + `rencontre-photos.public = false` — accès via URL signée admin (server-side) ou via session JWT propriétaire |
| Pas de listing leak sur buckets publics | Policy `*_public_read` **drop** mig 94 (avatars + annonces-photos). Sans policy SELECT, `storage.objects.list()` retourne vide → personne ne peut énumérer le bucket, mais URL directe reste OK (CDN bypass RLS sur buckets `public=true`) |
| CNI immutables au niveau bucket | Pas de policy UPDATE `cni-verifications` — re-soumission = nouvelle row + nouveaux fichiers (DELETE puis INSERT) |
| Photos post-RDV invisibles à l'autre partie | RLS `rencontre_photos_owner_select` checke `foldername[2] = uid` → seul l'auteur voit ses preuves. Anti-revanche (l'autre partie ne peut pas répondre photo-pour-photo). |
| `cni-verifications` purgé en cascade strict | Trigger BEFORE DELETE on `verifications_identite` → `purge_cni_storage_on_verif_delete()` fait HTTP DELETE vers Storage REST API (mig 110 — remplace SQL DELETE bloqué par `storage.protect_objects_delete` Supabase ~2026-Q1) |
| Cascade RGPD au delete compte | Côté client : `purgeUserBucket('avatars', uid)` + `purgeUserBucket('annonces-photos', uid)` + `purgeUserBucket('cni-verifications', uid)` AVANT `delete_my_account()` RPC (mig 73 ligne 64-69 — Storage purge ne peut PAS passer par SQL à cause de `storage.protect_objects_delete`) |
| Auth admin pour purge serveur-side | Trigger `purge_cni_storage_on_verif_delete` lit `service_role_key` depuis Vault, passe le Bearer dans le header HTTP DELETE (mig 110) — la service_role_key bypass RLS donc le DELETE Storage REST réussit même sans JWT user |
| Edge Function `purge-annonces-photos` gated par token statique | `PURGE_AUTH_TOKEN` env var côté Edge + Vault secret `purge_auth_token` côté cron — match strict du Bearer header sinon 401 |
| `add_rencontre_photo` gated par signalement-décidé | Gate `signalement_decided` (mig 102) — quand admin a tranché, plus de nouvelles preuves possibles (cohérence UX bandeau gris mig 96) |

**Sécurité par défense en profondeur :**
- RLS bucket-level (storage.objects) : 1er rempart, gate par path pattern
- RPC SECURITY DEFINER pour les flux sensibles (`add_rencontre_photo` valide path AVANT insert table)
- Triggers DB BEFORE DELETE pour cascade Storage (orphelins évités)
- Vault pour les credentials (jamais en hardcoded)
- Mig 94 REVOKE EXECUTE bulk sur les trigger functions (pas REST-callable)

---

## 2. Bucket `avatars` (mig 09)

### 2.1 Configuration

```sql
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true);
```

- **Public** : `true` — la photo de profil est consommée par d'autres users sans auth (cards annonces, profil vendeur public)
- **File size limit** : configuré côté Dashboard, pas scriptable SQL (recommandé : 2 MB)
- **Allowed MIME** : `image/jpeg, image/png, image/webp` (Dashboard)
- **Path pattern** : `{uid}/avatar.{ext}` — la 1ère foldername est l'UID du propriétaire

### 2.2 RLS (5 policies, 4 actives après mig 94)

| Policy | Action | Condition | Statut |
|---|---|---|---|
| `avatars_public_read` | SELECT | `bucket_id = 'avatars'` | ❌ **droppée mig 94** (anti listing leak) |
| `avatars_owner_insert` | INSERT | `(storage.foldername(name))[1] = auth.uid()::text` | ✅ active |
| `avatars_owner_update` | UPDATE | `(storage.foldername(name))[1] = auth.uid()::text` | ✅ active |
| `avatars_owner_delete` | DELETE | `(storage.foldername(name))[1] = auth.uid()::text` | ✅ active |

**Sémantique post-mig 94** : un client REST `.list()` retourne vide (pas de policy SELECT), mais une URL CDN directe `https://<project>.supabase.co/storage/v1/object/public/avatars/<uid>/avatar.jpg` reste accessible à tous (le CDN bypass RLS sur les buckets `public=true`). C'est volontaire — c'est ce qui permet le browse-first.

### 2.3 Purge

Pas de cron. Purge côté client uniquement, au moment du droit à l'oubli :

```ts
// lib/supabase.ts ligne ~255
await purgeUserBucket("avatars", userId);
await purgeUserBucket("annonces-photos", userId);
await purgeUserBucket("cni-verifications", userId);
// puis: supabase.rpc("delete_my_account") qui cascade auth.users
```

`purgeUserBucket` (`lib/supabase.ts` ligne 188) liste tout le folder `{uid}/`, supprime fichiers + récurse dans les sous-folders pour annonces-photos.

---

## 3. Bucket `annonces-photos` (mig 14)

### 3.1 Configuration

```sql
insert into storage.buckets (id, name, public)
values ('annonces-photos', 'annonces-photos', true);
```

- **Public** : `true` — annonces visibles sans compte (browse-first CDC §F03)
- **File size limit** : 5 MB (Dashboard manuel)
- **Allowed MIME** : `image/jpeg, image/png, image/webp` (Dashboard)
- **Path pattern** : `{uid}/{annonceId}/{uuid}.{ext}` — 2 foldername levels, le 1er = UID propriétaire

### 3.2 RLS (3 policies, 2 actives après mig 94)

| Policy | Action | Condition | Statut |
|---|---|---|---|
| `annonces_photos_public_read` | SELECT | `bucket_id = 'annonces-photos'` | ❌ **droppée mig 94** (anti listing leak) |
| `annonces_photos_owner_insert` | INSERT | `(storage.foldername(name))[1] = auth.uid()::text` | ✅ active |
| `annonces_photos_owner_delete` | DELETE | `(storage.foldername(name))[1] = auth.uid()::text` | ✅ active |

**Pas de policy UPDATE par design** : si l'user veut remplacer une photo, on fait DELETE + INSERT (nouveau path UUID → invalide automatiquement le cache CDN). Cohérent avec mig 14 §2 ligne 34.

### 3.3 Cycle de vie + purge auto

1. **Création** : `lib/storage/annonces-photos.ts` upload via Supabase Storage SDK (path enforcé côté client via `{uid}/{annonceId}/{uuid}.{ext}`)
2. **Expiration** : cron `expire-annonces` 02h UTC daily → `annonces.statut = 'expiree'` quand `expires_at < now()` (mig 16 §1). N'affecte PAS Storage.
3. **Purge** : cron `purge-expired-annonces` 03h UTC daily → `fn_purge_expired_annonces()` (mig 16 §2) qui :
   - Aggrège `array_agg(unnest(photos))` pour les `statut='expiree' AND expires_at < now() - interval '28 days'`
   - POST par chunks de 100 paths à l'Edge Function `purge-annonces-photos` via `net.http_post`
   - DELETE les rows (cascade FK supprime conversations etc.)
4. **Edge Function** `purge-annonces-photos` (Deno) :
   - Auth : Bearer `PURGE_AUTH_TOKEN` (env Edge), match strict
   - `MAX_PATHS_PER_CALL = 100` (limite Deno timeout)
   - `supabase.storage.from('annonces-photos').remove(paths)` (service_role)
   - Log Sentry + `niqo_event_log` (purge.completed / purge.error)

**Best-effort** : si Edge Function down ou pg_net échoue, les rows sont quand même DELETE → photos orphelines sur le CDN. Sweep manuel admin TODO Phase 2 (cf. `docs/architecture/v4-deltas.md` ou mig 16 ligne 64).

---

## 4. Bucket `cni-verifications` (migs 46+48+54+73+110)

### 4.1 Configuration

```sql
insert into storage.buckets (id, name, public)
values ('cni-verifications', 'cni-verifications', false);
```

- **Public** : `false` — PII sensibles, jamais d'URL publique
- **File size limit** : 8 MB (qualité photo CNI)
- **Allowed MIME** : `image/jpeg, image/png` (Dashboard)
- **Path pattern** : `{uid}/{verif_id}/{recto|verso|selfie}.jpg`

### 4.2 RLS (5 policies actives)

| Policy | Action | Condition | Mig |
|---|---|---|---|
| `cni_verif_owner_insert` | INSERT | `(storage.foldername(name))[1] = auth.uid()::text` | 46 |
| `cni_verif_owner_select` | SELECT | `(storage.foldername(name))[1] = auth.uid()::text` | **48** (patch — sans cette policy, `upload()` SDK fail car SELECT post-INSERT pour récupérer metadata) |
| `cni_verif_owner_update` | UPDATE | `(storage.foldername(name))[1] = auth.uid()::text` | **48** (pour la recapture client `upsert: true`) |
| `cni_verif_owner_delete` | DELETE | `(storage.foldername(name))[1] = auth.uid()::text` | **73** (ajoutée pour permettre la purge RGPD côté client) |
| `cni_verif_admin_select` | SELECT | `users.is_admin = true` | 46 |
| `cni_verif_admin_delete` | DELETE | `users.is_admin = true` | 46 (admin garde DELETE pour cron purge) |

**Évolution sémantique** :
- Mig 46 disait "user ne peut PAS relire ses propres CNI" (privacy by default)
- Mig 48 a relâché : SDK Supabase Storage exige SELECT post-INSERT → user voit SES uploads (cohérent RGPD "c'est sa data")
- Mig 73 a ajouté DELETE owner pour permettre la purge RGPD côté client (le trigger `protect_objects_delete` Supabase ~2026-Q1 bloque `DELETE FROM storage.objects` en SQL → seul chemin : Storage API HTTP avec policy DELETE owner)

### 4.3 Trigger `trg_purge_cni_storage` (mig 54+110)

```sql
create trigger trg_purge_cni_storage
  before delete on public.verifications_identite
  for each row
  execute function public.purge_cni_storage_on_verif_delete();
```

**Version mig 54 (initiale, SQL DELETE direct)** : `delete from storage.objects where bucket_id='cni-verifications' and name in (recto, verso, selfie)`. Cassé ~2026-Q1 quand Supabase a ajouté `storage.protect_objects_delete` qui raise `42501: Direct deletion from storage tables is not allowed`.

**Version mig 110 (actuelle, HTTP fire-and-forget)** : la fonction `purge_cni_storage_on_verif_delete()` (réécrite mig 110) :
1. Récupère `service_role_key` depuis `vault.decrypted_secrets`
2. Récupère URL Storage REST depuis Vault (`cni_storage_remove_url`) OU fallback hardcoded
3. POST `net.http_delete(url, body={"prefixes":[recto,verso,selfie]}, headers={Bearer ...})` fire-and-forget
4. Si Vault vide ou pg_net erreur → `raise notice` mais continue (orphelin best-effort)

**Conséquence** : toute suppression d'une row `verifications_identite` (cron purge, cascade `users → verifications_identite`, admin manual) déclenche la purge HTTP automatiquement.

### 4.4 Cron `purge-expired-kyc-verifications` (mig 54)

```sql
select cron.schedule(
  'purge-expired-kyc-verifications',
  '0 3 * * *',
  $cron$select public.purge_expired_kyc_verifications();$cron$
);
```

`purge_expired_kyc_verifications()` (mig 54 §2) :
```sql
delete from public.verifications_identite
 where (statut = 'rejected' and reviewed_at < now() - interval '30 days')
    or (statut = 'verified' and reviewed_at < now() - interval '6 months');
```

→ DELETE row → trigger `trg_purge_cni_storage` fire → HTTP DELETE Storage REST → fichiers purgés.

Mig 75 (KYC) a étendu pour inclure `pending` abandonnés > 60j (vérifié dans `docs/backend/kyc.md`).

### 4.5 Cascade au delete compte (mig 73)

`delete_my_account()` (mig 73) NE FAIT PLUS de DELETE sur storage.objects (bloqué par `protect_objects_delete`). Le client mobile (`lib/supabase.ts deleteMyAccount`) appelle `purgeUserBucket("cni-verifications", uid)` AVANT la RPC, qui passe par Storage API HTTP propre.

---

## 5. Bucket `rencontre-photos` (migs 92+102)

### 5.1 Configuration

```sql
insert into storage.buckets (id, name, public)
values ('rencontre-photos', 'rencontre-photos', false);
```

- **Public** : `false` — preuves anti-fraude post-RDV, jamais public
- **File size limit** : 5 MB (max 3 MB côté client, marge upload)
- **Allowed MIME** : `image/jpeg, image/webp` (Dashboard)
- **Path pattern** : `{conv_id}/{uid}/{photo_id}.jpg` — 2 foldername levels, **2ème = UID auteur** (différent des autres buckets où c'est le 1er)

### 5.2 Table coupled `public.rencontre_photos` (mig 92)

```sql
create table public.rencontre_photos (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  auteur_id       uuid not null references users(id) on delete cascade,
  role_auteur     text not null check (role_auteur in ('acheteur','vendeur')),
  storage_path    text not null,
  created_at      timestamptz not null default now()
);
```

**Indexes** :
- `idx_rencontre_photos_conv` on (conversation_id, created_at desc) — pour query admin
- `idx_rencontre_photos_auteur` on (auteur_id, created_at desc)

**RLS table** :
- `rencontre_photos_select_own` : auteur voit ses photos
- `rencontre_photos_select_admin` : admin voit toutes
- Pas de policy INSERT directe — passe par RPC `add_rencontre_photo` SECURITY DEFINER

### 5.3 RLS storage.objects (4 policies)

| Policy | Action | Condition |
|---|---|---|
| `rencontre_photos_owner_insert` | INSERT | `foldername[2] = uid` **ET** caller est participant de la conv (FK lookup) |
| `rencontre_photos_owner_select` | SELECT | `foldername[2] = uid` (auteur seul, anti-revanche) |
| `rencontre_photos_admin_select` | SELECT | `users.is_admin = true` |
| `rencontre_photos_admin_delete` | DELETE | `users.is_admin = true` |

Pas d'UPDATE (photos immutables).

### 5.4 RPC `add_rencontre_photo(p_conversation_id, p_storage_path)` (mig 92+102)

**Signature** : `(uuid, text) → jsonb`
**Gate chain** (8 gates dans l'ordre) :

1. `not_authenticated` — `auth.uid() is null`
2. `path_required` — path vide ou null
3. `invalid_path` — `split_part(path,'/',1) != conv_id` OU `split_part(path,'/',2) != uid` (path enforcement défense en profondeur, même si RLS bucket-level l'enforce déjà)
4. `conversation_not_found` — conv inexistante
5. `not_participant` — `uid != acheteur_id` ET `uid != vendeur_id`
6. `no_confirmed_rdv` — `rdv_confirme_at IS NULL`
7. `rdv_not_past` — `rdv_date >= now()`
8. **`signalement_decided`** — `admin_signalement_decided_at IS NOT NULL` (mig 102 — lock cohérence bandeau gris mig 96)
9. `quota_exceeded` — déjà 5 photos pour cet auteur sur cette conv

Puis : INSERT dans `rencontre_photos` + return `{ success: true, count_after: N+1 }`.

### 5.5 Pas de cron purge auto

À étudier Phase 2 (mig 92 ligne 39 : "purge si conv suppr depuis > 90j"). Aujourd'hui : cascade FK `conversation_id ON DELETE CASCADE` supprime la row table mais pas le fichier Storage → orphelin best-effort.

Cascade RGPD au delete compte : `auteur_id ON DELETE CASCADE` → la row table disparaît, mais pas le fichier Storage (pas de trigger BEFORE DELETE comme `trg_purge_cni_storage`). 🟡 finding documenté §10.

---

## 6. Edge Function `purge-annonces-photos`

**Path** : `supabase/functions/purge-annonces-photos/index.ts`
**Trigger** : POST par cron `purge-expired-annonces` via `net.http_post` (mig 16)

### 6.1 Contract

```
POST /functions/v1/purge-annonces-photos
Headers:
  Authorization: Bearer <PURGE_AUTH_TOKEN>
  Content-Type: application/json
Body:
  { "paths": ["uid/annonceId/uuid1.jpg", "uid/annonceId/uuid2.jpg"] }
Response 200:
  { "ok": true, "deleted": N }
Response 4xx/5xx:
  { "ok": false, "reason": "<message>" }
```

### 6.2 Sécurité

- **Auth** : Bearer header **strict match** vs `Deno.env.get("PURGE_AUTH_TOKEN")` — sinon 401
- **Quota** : `MAX_PATHS_PER_CALL = 100` — au-delà, 400
- **Validation** : `paths` doit être un array de strings non-vides
- **Action** : `supabase.storage.from('annonces-photos').remove(paths)` via service_role
- **Observability** : Sentry capture errors + `niqo_event_log` (`purge.completed` / `purge.error`)

### 6.3 Déploiement

```bash
supabase functions deploy purge-annonces-photos
supabase secrets set PURGE_AUTH_TOKEN=<random-32-chars>
```

Le même token doit être posé côté Vault (mig 16) pour que le cron passe le bon Bearer :
```sql
select vault.create_secret('<same-token>', 'purge_auth_token');
select vault.create_secret('https://<project>.supabase.co/functions/v1/purge-annonces-photos', 'purge_function_url');
```

---

## 7. Vault secrets

Quatre secrets Supabase Vault utilisés par le module Storage :

| Secret | Migration | Lu par | Usage |
|---|---|---|---|
| `service_role_key` | 65 (push) | `purge_cni_storage_on_verif_delete` (mig 110), `fn_send_push` (mig 65) | Bearer pour appeler Storage REST API DELETE + Expo Push |
| `purge_auth_token` | 16 (annonces) | `fn_purge_expired_annonces` (mig 16) | Bearer pour appeler Edge Function `purge-annonces-photos` (match avec env `PURGE_AUTH_TOKEN`) |
| `purge_function_url` | 16 (annonces) | `fn_purge_expired_annonces` (mig 16) | URL Edge Function (override prod/staging sans mig) |
| `cni_storage_remove_url` | 110 (KYC) | `purge_cni_storage_on_verif_delete` (mig 110) | URL Storage REST DELETE bucket `cni-verifications` (fallback hardcoded si Vault vide) |

**Lecture** : `select decrypted_secret from vault.decrypted_secrets where name = '<key>' limit 1`. Si absent : log notice + continue (best-effort).

---

## 8. Crons Storage-related

| Cron job | Horaire UTC | Fonction | Effet Storage |
|---|---|---|---|
| `expire-annonces` | `0 2 * * *` (02h) | inline `update annonces set statut='expiree' where ...` | ❌ aucun (juste statut DB) |
| `purge-expired-annonces` | `0 3 * * *` (03h) | `fn_purge_expired_annonces()` | ✅ POST Edge Function → `remove(paths)` bucket `annonces-photos` |
| `purge-expired-kyc-verifications` | `0 3 * * *` (03h) | `purge_expired_kyc_verifications()` | ✅ DELETE rows → trigger `trg_purge_cni_storage` → HTTP DELETE Storage REST bucket `cni-verifications` |

Tous instrumentés via mig 109 (`niqo_event_log`).

---

## 9. Intégrations client

### 9.1 Mobile (Expo)

| Fichier | Bucket | Pattern |
|---|---|---|
| `lib/storage/annonces-photos.ts` | annonces-photos | upload wizard (5 photos max), génération paths `{uid}/{annonceId}/{uuid}.{ext}` |
| `lib/storage/` (autres helpers) | avatars / cni / rencontre | upload via Supabase Storage SDK |
| `lib/supabase.ts purgeUserBucket(bucket, uid)` | 3 buckets owner-deletable | listing récursif + `.remove(paths)`, appelé par `deleteMyAccount` (mig 73) |
| `lib/supabase.ts deleteMyAccount()` | tous | purge 3 buckets côté client AVANT `delete_my_account()` RPC |
| `lib/rencontre.ts addRencontrePhoto()` | rencontre-photos | upload Storage SDK puis call RPC `add_rencontre_photo` ; si RPC fail, rollback fichier Storage |
| `lib/rencontre.ts getRencontrePhotos()` | rencontre-photos | list + signed URLs (admin uniquement) ou owner direct download |

### 9.2 Admin web (Next.js, `landing/`)

- `landing/src/app/admin/(admin-protected)/verifications/[id]/` : génère URL signée server-side pour afficher CNI recto/verso/selfie (admin lit via service_role côté server)
- Pas d'upload depuis l'admin web (read-only sur Storage)

---

## 10. Drift & findings

| Finding | Niveau | Détail | Action |
|---|---|---|---|
| Avatars orphelins si crash entre signOut et purge | 🟡 P2 | `deleteMyAccount` appelle `purgeUserBucket('avatars', uid)` puis RPC `delete_my_account`. Si le client crash entre les deux, l'avatar reste orphelin sur le CDN (pas de FK cascade DB sur avatars). | Sweep manuel Phase 2 (script qui diff bucket vs `auth.users`). Best-effort accepté pour MVP. |
| `annonces-photos` orphelins si Edge Function down | 🟡 P2 | `fn_purge_expired_annonces` POST best-effort. Si Edge timeout, les rows annonces sont quand même DELETE → photos orphelines. | Documenté mig 16 ligne 64. Sweep manuel TODO Phase 2 (diff bucket vs `unnest(photos)` actives). |
| `rencontre-photos` orphelins après delete user/conv | 🟡 P2 | Pas de trigger BEFORE DELETE comme `trg_purge_cni_storage`. Cascade FK supprime la row table, mais pas le fichier Storage. Documenté mig 92 ligne 39 ("purge si conv suppr > 90j à étudier Phase 2"). | Phase 2 : ajouter trigger HTTP DELETE comme pour CNI. |
| Bucket `rencontre-photos` pas de quota total | 🟢 cosmétique | RPC `add_rencontre_photo` limite à 5 photos par auteur par conv (mig 92), mais pas de quota global sur le bucket (un user pourrait empiler 5 × N conversations). | Phase 2 si abus observés. Filtre client+RPC limite naturellement. |
| `avatars` pas de policy SELECT mais `public=true` | 🟢 design | Post-mig 94, pas de policy SELECT → `.list()` vide pour tous (anti listing leak). URL CDN directe fonctionne (CDN bypass RLS sur `public=true`). Pattern volontaire et documenté. | Aucune. |
| File size limit + MIME types non-scriptables SQL | 🟢 doc-only | Doivent être configurés manuellement Dashboard Storage → Settings par bucket. Pas dans les migs. | Vérifier au moment du setup d'un nouvel env Supabase (`docs/backend/observability.md` checklist pre-prod). |
| Pas de purge auto avatars (vs cron pour CNI/annonces-photos) | 🟢 ok | Avatar = 1 fichier par user, peu volumineux. Cascade au delete compte côté client suffit. Pas de cycle d'expiration. | Aucune. |
| `avatars_owner_update` policy sans `WITH CHECK` explicite (mig 09) | 🟡 P2 | La policy UPDATE n'a que `USING`, pas de `WITH CHECK`. Découvert au backfill 2026-05-12 : Supabase Storage SDK avec `upsert: true` envoie un `INSERT...ON CONFLICT DO UPDATE` qui exige `WITH CHECK` valide → upload `.upload(path, body, { upsert: true })` fail RLS sur le bucket avatars en local. Le client mobile n'utilise jamais `upsert` sur avatars (path UUID unique par upload), donc pas d'impact prod observé, mais drift vs `cni_verif_owner_update` (mig 48) qui a USING+WITH CHECK. | Ajouter `WITH CHECK` à `avatars_owner_update` si on veut autoriser upsert. Pas bloquant. |
| `.remove()` silencieux sur avatars local (DELETE n'efface pas) | 🟡 P2 | Découvert au backfill 2026-05-12 sur Supabase local : `client.storage.from('avatars').remove([path])` retourne `data=[]` sans erreur mais le fichier reste. `cni-verifications` (policy DELETE owner mig 73 avec auth.uid()-not-null guard) marche normalement. Hypothèse : différence de robustesse entre policy avec ou sans `auth.uid() IS NOT NULL`. À investiguer en prod avant le launch (impact `purgeUserBucket('avatars',uid)` → avatars orphelins post-delete account). | Reproduire en prod ; si confirmé, aligner policy `avatars_owner_delete` sur le pattern mig 73 (add `auth.uid() IS NOT NULL`). |

---

## 11. Tests scope

**pgTAP** (`tests/sql/storage.test.sql`) couvre :
- Existence + config (public flag) des 4 buckets
- Comptage RLS policies par bucket
- Trigger `trg_purge_cni_storage` BEFORE DELETE wired
- Crons `expire-annonces` + `purge-expired-annonces` + `purge-expired-kyc-verifications` enregistrés
- Vault secrets présents (`service_role_key`, `purge_auth_token`, `purge_function_url`, `cni_storage_remove_url`)
- Drop policies listing (mig 94 — `avatars_public_read` + `annonces_photos_public_read` absentes)
- Path validation `add_rencontre_photo` (re-test des invariants déjà couverts par `rencontre.test.sql`, mais ciblé Storage)

**Vitest** (`tests/integration/storage.test.ts`) couvre :
- Upload avatar + RLS cross-user (Alice ne peut pas écrire dans `bob/avatar.jpg`)
- Upload annonces-photos + RLS cross-user (path enforcement)
- Upload cni-verifications + listing privé (anon `.download()` fail)
- RLS cross-user cni (Alice ne peut pas SELECT le path de Bob)
- Upload rencontre-photos via `add_rencontre_photo` RPC happy path (validation path)
- `deleteMyAccount` purge avatars + annonces-photos (cascade RGPD)
- Buckets publics : URL CDN directe accessible sans JWT

**Tests non-automatisés** :
- Edge Function `purge-annonces-photos` end-to-end (requiert deploy + token côté env Edge — manual test post-deploy)
- Trigger `trg_purge_cni_storage` HTTP DELETE réel (requiert Vault secrets prod + pg_net actif — testé en local Supabase via cron manual après `delete from verifications_identite`)
- Cron `purge-expired-kyc-verifications` réel sur fixture > 30j (vérifié `kyc.test.sql` mig 110)

**Cross-references** :
- `rencontre.test.sql` couvre déjà `add_rencontre_photo` gates (not_auth, not_participant, path, quota) — on ne re-teste pas ici
- `rdv.test.sql` Test 23 couvre `add_rencontre_photo` lock après `admin_signalement_decided_at` (mig 102)
- `kyc.test.sql` couvre déjà l'effet trigger `trg_purge_cni_storage` côté DB (mig 110)

---

## 12. Références

- `docs/backend/PROCESS.md` — Process backend ownership
- `docs/backend/kyc.md` — Module KYC (consomme `cni-verifications`)
- `docs/backend/rdv.md` — Module RDV (consomme `rencontre-photos`)
- `docs/backend/annonces.md` — Module Annonces (consomme `annonces-photos`)
- `docs/migrations/INDEX.md` — Index des migrations
- `supabase/migrations/20240101000900_profile_updates.sql` — mig 09 avatars
- `supabase/migrations/20240101001400_storage_annonces_photos.sql` — mig 14
- `supabase/migrations/20240101001600_annonces_expiration.sql` — mig 16 crons + Edge Function
- `supabase/migrations/20240101004600_storage_cni_verifications.sql` — mig 46
- `supabase/migrations/20240101004800_storage_cni_user_self_select.sql` — mig 48
- `supabase/migrations/20240101005400_cron_purge_kyc_verifications.sql` — mig 54 cron + trigger
- `supabase/migrations/20240101011300_fix_storage_delete_owner.sql` — mig 73 DELETE owner + cascade client
- `supabase/migrations/20240101013200_rencontre_photos.sql` — mig 92 rencontre-photos
- `supabase/migrations/20240101013400_security_advisor_cleanup.sql` — mig 94 drop public_read + revoke
- `supabase/migrations/20240101014200_lock_photos_after_admin_decided.sql` — mig 102 lock
- `supabase/migrations/20240101015000_fix_kyc_storage_purge_http.sql` — mig 110 HTTP fix
- `supabase/functions/purge-annonces-photos/index.ts` — Edge Function
- `lib/storage/annonces-photos.ts` — upload client annonces
- `lib/supabase.ts` lignes 188-262 — `purgeUserBucket` + `deleteMyAccount`
- `lib/rencontre.ts` — upload preuves post-RDV
