# Module Conversations — Backend

> Source de vérité backend du module **Conversations** (CDC v4.0 §2.4, F04).
> Couvre : tables `public.conversations` (**17 colonnes**) + `public.messages` (**10 colonnes**) + `public.mots_interdits` (table de référence), **6 RLS policies** actives (3 conv + 3 msg, UPDATE conv revoked en mig 74), 5 triggers, 2 RPCs publiques + 1 admin, 0 cron direct (les pushes/RDV touchent ces tables via leurs propres triggers).
>
> **Migrations concernées** : **22 (CREATE TABLE conversations + messages + 4 RLS + trigger `tg_conversation_last_message` + RPCs `get_or_create_conversation` + `mark_messages_read` + Realtime messages)**, **23 (RLS `users_read_conversation_participant` — jointure profil participant)**, **24 (FK CASCADE `acheteur_id`/`vendeur_id`/`expediteur_id` pour droit à l'oubli)**, **29 (content filter `mots_interdits` — table + seed + `fn_check_forbidden_words` + trigger `tg_messages_content_filter`)**, **35 (colonnes RDV `rdv_*` + bypass content filter pour `type='systeme'` + Realtime conversations + RPCs `propose_rdv`/`confirm_rdv`/`cancel_rdv` — voir `rdv.md`)**, **36 (simplification texte messages système RDV)**, **40 (DROP `conversations.statut` + enum `statut_conv` — pivot v4.0)**, **57 (RPC admin `admin_soft_delete_message` + `admin_suspend_user` + `admin_suspend_annonce`)**, **65 (triggers push `trg_push_new_message` + `trg_push_rdv_confirmed`)**, **66 (triggers push `trg_push_rdv_proposed` + `trg_push_rdv_annule`)**, **71 (FK fix `rdv_propose_par`/`rdv_annule_par` SET NULL — pour delete_my_account)**, **74 (RLS hardening : REVOKE UPDATE conversations/messages + column-level GRANT `is_read` only + helper `is_my_account_active()` + guard INSERT messages)**, **86 (colonnes `rencontre_acheteur`/`rencontre_vendeur`/`rencontre_decided_at` + RPC `confirm_rencontre` + trigger `tg_annonce_statut_on_rencontre_change` — voir `rdv.md`)**, **105 (RLS deny-all sur `mots_interdits`)**.
>
> **Tier RGPD** : 🔴 **P0** — messagerie contient les négociations privées entre 2 users, données nominatives directement identifiantes (prénom dans messages système RDV, contenu libre). Cascade DELETE garantie via FK `ON DELETE CASCADE` (mig 24) sur user delete → toutes ses convs + messages partent. Pas de Storage attaché. Logs serveur (`niqo_event_log` mig 106) ne stockent pas le contenu — uniquement compteurs business. Conformité ARTCI 2024-30 (CI), ANRTIC 2023-15 (CG), loi 2021-058 RW.
>
> **Périmètre** : ce doc couvre les tables `conversations` + `messages` + `mots_interdits` + leurs RLS/triggers/RPCs. Le module **RDV** (colonnes `rdv_*` + `rencontre_*` + RPCs `propose_rdv`/`confirm_rdv`/`cancel_rdv`/`confirm_rencontre`) est documenté séparément dans **`docs/backend/rdv.md`** — ne pas dupliquer ici. Le module **Signalements** (qui peut cibler un message via `target_type='message'`) est en attente de backfill (P1).

---

## 1. Vue d'ensemble

Une conversation = **1 annonce × 1 acheteur**. Le vendeur est déduit de l'annonce, jamais passé en paramètre client (anti-triche). Une conversation est créée à la volée par `get_or_create_conversation` quand un acheteur tape "Contacter le vendeur" (auth gate `contact`, CLAUDE.md §Auth gate).

**Invariants produit non-négociables :**

| Invariant | Enforcement |
|---|---|
| 1 acheteur ne peut avoir qu'**1 conversation par annonce** | Constraint `conversations_unique (annonce_id, acheteur_id)` + `ON CONFLICT DO NOTHING` dans `get_or_create_conversation` |
| Le vendeur ne peut pas se messager lui-même | `get_or_create_conversation` raise `cannot_message_self` (mig 22) |
| Conversation créable seulement si annonce `active` ou `en_cours` | `get_or_create_conversation` raise `annonce_not_available` sinon (vendue/suspendue/expiree bloquées) |
| Acheteur/vendeur/annonce **immuables** après INSERT | RLS UPDATE conversations REVOKED (mig 74) — toute mutation passe par triggers ou RPCs SECURITY DEFINER |
| Seul le **destinataire** peut marquer un message lu | `mark_messages_read` filtre `expediteur_id != auth.uid()` + RLS UPDATE messages limite à `is_read` (column-level GRANT mig 74) |
| Pas de mot interdit dans `messages.contenu` | Trigger `tg_messages_content_filter` BEFORE INSERT (mig 29) raise `contenu_interdit` — **bypass `type='systeme'`** (mig 35) |
| User suspendu (`is_active=false`) ne peut plus envoyer de messages | RLS INSERT messages exige `is_my_account_active()` (mig 74) |
| Soft delete admin préserve l'historique | `admin_soft_delete_message` set `is_deleted=true` sans SUPPRIMER — query mobile filtre côté client |
| Realtime activé sur `messages` ET `conversations` | `alter publication supabase_realtime add table ...` (mig 22 messages, mig 35 conversations) |
| Cascade user delete | FK `acheteur_id`/`vendeur_id`/`expediteur_id` ON DELETE CASCADE (mig 24) — toute conv + tous msgs disparaissent |
| `mots_interdits` invisible aux clients | RLS deny-all (mig 105) — service_role only, `fn_check_forbidden_words` SECURITY DEFINER bypass |

---

## 2. Tables consommées

### 2.1 `public.conversations` (mig 22 + extensions 35, 40, 86)

**Total 17 colonnes** (8 base mig 22 − 1 `statut` DROPPED mig 40 = 7 + 7 RDV mig 35 + 3 rencontre mig 86 = 17).

| Colonne | Type | Default | NOT NULL | FK / CHECK | Mig | Sémantique |
|---|---|---|---|---|---|---|
| `id` | uuid | `uuid_generate_v4()` | ✅ | PK | 22 | |
| `annonce_id` | uuid | — | ✅ | → annonces(id) **ON DELETE SET NULL** (mig 39) | 22→39 | SET NULL préserve historique chat post-purge annonce |
| `acheteur_id` | uuid | — | ✅ | → users(id) ON DELETE CASCADE (mig 24) | 22→24 | Cascade user delete |
| `vendeur_id` | uuid | — | ✅ | → users(id) ON DELETE CASCADE (mig 24) | 22→24 | Cascade user delete |
| ~~`statut`~~ | ~~enum `statut_conv`~~ | ~~`'ouverte'`~~ | — | — | 22→40 | **DROPPED mig 40** (pivot v4.0 — enum lié à l'escrow v3.14) |
| `last_message_preview` | text | NULL | ✗ | — | 22 | Dénormalisé via trigger `tg_conversation_last_message` (100 chars max) |
| `last_message_at` | timestamptz | NULL | ✗ | — | 22 | Dénormalisé via trigger (tri liste conversations) |
| `created_at` | timestamptz | `now()` | ✅ | — | 22 | |
| `rdv_lieu` | text | NULL | ✗ | 1-100 chars (CHECK `conversations_rdv_lieu_max`) | 35 | Cf. `rdv.md` §2.1 |
| `rdv_date` | timestamptz | NULL | ✗ | — | 35 | Cf. `rdv.md` §2.1 |
| `rdv_propose_par` | uuid | NULL | ✗ | → users(id) **SET NULL** (mig 71) | 35→71 | SET NULL au delete_my_account |
| `rdv_propose_at` | timestamptz | NULL | ✗ | — | 35 | |
| `rdv_confirme_at` | timestamptz | NULL | ✗ | — | 35 | |
| `rdv_annule_par` | uuid | NULL | ✗ | → users(id) **SET NULL** (mig 71) | 35→71 | |
| `rdv_annule_at` | timestamptz | NULL | ✗ | — | 35 | |
| `rencontre_acheteur` | bool | NULL | ✗ | — | 86 | NULL=pas répondu, TRUE=vu, FALSE=pas vu. Cf. `rdv.md` §3.5 |
| `rencontre_vendeur` | bool | NULL | ✗ | — | 86 | idem côté vendeur |
| `rencontre_decided_at` | timestamptz | NULL | ✗ | — | 86 | Set quand les 2 ont répondu (état terminal figé) |

**Constraints :**
- `conversations_unique unique (annonce_id, acheteur_id)` — 1 conv max par couple
- `conversations_rdv_lieu_max check (rdv_lieu is null or char_length(rdv_lieu) between 1 and 100)` (mig 35)

**Indexes :**
- `idx_conversations_acheteur (acheteur_id, last_message_at DESC NULLS LAST)` — "mes convs côté acheteur"
- `idx_conversations_vendeur (vendeur_id, last_message_at DESC NULLS LAST)` — "mes convs côté vendeur"
- `idx_conversations_annonce (annonce_id)` — joins backoffice + cascade
- `idx_conversations_rdv_confirme (rdv_confirme_at DESC) WHERE rdv_confirme_at IS NOT NULL` — F06 + dashboard (mig 35)
- `idx_conversations_rdv_pending_decision (rdv_date) WHERE rdv_confirme_at IS NOT NULL AND rencontre_decided_at IS NULL` — cron relance rencontre (mig 86, cf. `rdv.md`)

**Realtime :** ✅ `alter publication supabase_realtime add table public.conversations` (mig 35) — sync 2 parties sur `rdv_*`.

### 2.2 `public.messages` (mig 22 + extension 74)

**Total 10 colonnes**.

| Colonne | Type | Default | NOT NULL | FK / CHECK | Mig | Sémantique |
|---|---|---|---|---|---|---|
| `id` | uuid | `uuid_generate_v4()` | ✅ | PK | 22 | |
| `conversation_id` | uuid | — | ✅ | → conversations(id) ON DELETE CASCADE | 22 | Purge en cascade quand conv supprimée |
| `expediteur_id` | uuid | — | ✅ | → users(id) ON DELETE CASCADE (mig 24) | 22→24 | Cascade user delete |
| `contenu` | text | — | ✅ | 1-2000 chars (CHECK `messages_contenu_max`) | 22 | Body du message |
| `type` | enum `type_message` | `'texte'` | ✅ | texte/offre_prix/systeme/image | 22 | `'offre_prix'` + `'image'` = Phase 2 (dormants) |
| `offre_montant` | numeric(12,0) | NULL | ✗ | > 0 (CHECK) | 22 | Phase 2 — dormant en MVP |
| `is_read` | bool | `false` | ✅ | — | 22 | Marqué `true` par `mark_messages_read` côté destinataire |
| `is_deleted` | bool | `false` | ✅ | — | 22 | Soft delete admin (mig 57) — query mobile filtre |
| `created_at` | timestamptz | `now()` | ✅ | — | 22 | |
| `updated_at` | timestamptz | `now()` | ✅ | — | 22 | Auto via trigger `set_messages_updated_at` (mig 10 helper réutilisé) |

**Constraints :**
- `messages_contenu_max check (char_length(contenu) <= 2000)` (mig 22)
- `contenu` inline check `char_length(contenu) > 0` (mig 22) — non-vide
- `offre_montant > 0` (mig 22) — si fourni (Phase 2)

**Indexes :**
- `idx_messages_conversation (conversation_id, created_at DESC)` — pagination chat
- `idx_messages_unread (conversation_id, expediteur_id) WHERE is_read = false` — badge unread (mig 22, partiel)

**Realtime :** ✅ `alter publication supabase_realtime add table public.messages` (mig 22) — subscribe par `conversation_id`.

### 2.3 `public.mots_interdits` (mig 29 + RLS 105)

Table de référence (blocklist). **63 entrées** seed mig 29 (armes / drogues / contrefaçons / adulte / arnaques / animaux / insultes — incluant argot Nouchi `gban`/`yamba`/`gbêh`/`kpakpato`/`tchoin`).

| Colonne | Type | Default | NOT NULL | Mig |
|---|---|---|---|---|
| `id` | serial | — | ✅ (PK) | 29 |
| `mot` | text | — | ✅ (UNIQUE) | 29 |
| `categorie` | text | `'autre'` | ✅ | 29 |
| `created_at` | timestamptz | `now()` | ✅ | 29 |

**RLS deny-all (mig 105)** : `enable row level security` + aucune policy + `revoke all from public, anon, authenticated`. service_role conserve l'accès (Dashboard admin). La fonction `fn_check_forbidden_words(text)` SECURITY DEFINER bypass RLS → triggers continuent à filtrer. Audit /cso 2026-05-10.

**Pourquoi le deny-all** : avant mig 105, la table était lisible via GET `/rest/v1/mots_interdits` avec la clé anon publique du bundle APK/IPA → un user pouvait récupérer la blocklist et publier des annonces avec orthographes alternatives (`kalashniko`, `co¢aine`, `ya mba`) pour bypasser le filtre.

**Test rapide** : `select count(*) from public.mots_interdits;` doit retourner 63 quand exécuté en service_role.

---

## 3. RLS policies actives

### 3.1 `conversations` — 2 policies actives (UPDATE/DELETE revoked)

| Policy | Action | Qui | Mig | Logique |
|---|---|---|---|---|
| `conversations_select_participants` | SELECT | participants | 22 | `auth.uid() = acheteur_id OR auth.uid() = vendeur_id` |
| `conversations_insert_buyer` | INSERT | acheteur | 22 | `auth.uid() = acheteur_id` — vendeur ne peut pas créer (anti-spam vendeur→acheteur) |
| ~~`conversations_update_participants`~~ | UPDATE | participants | 22→**74 DROPPED** | DROPPED + `revoke update from authenticated, anon` — tout passe par triggers/RPCs |
| (no DELETE policy) | DELETE | — | — | Aucune policy → deny-all par défaut. Cascade FK uniquement |

### 3.2 `messages` — 3 policies actives

| Policy | Action | Qui | Mig | Logique |
|---|---|---|---|---|
| `messages_select_participants` | SELECT | participants conv | 22 | `EXISTS (SELECT 1 FROM conversations WHERE id = conversation_id AND (acheteur_id OR vendeur_id))` |
| `messages_insert_participants` | INSERT | expéditeur + actif + participant | 22→74 | `auth.uid() = expediteur_id AND is_my_account_active() AND EXISTS (conv participant)` |
| `messages_update_participants` | UPDATE | participants conv | 22→74 | `EXISTS (conv participant)` USING + WITH CHECK. **Column-level GRANT `is_read` only** (mig 74) — `contenu`/`type`/`is_deleted` immutables côté client |
| (no DELETE policy) | DELETE | — | — | Aucune policy → deny-all. Cascade FK uniquement |

**Détail critique mig 74** :
- `revoke update on public.conversations from authenticated, anon` — bloque toute UPDATE conv côté client (les RPCs SECURITY DEFINER tournent en owner, bypass)
- `revoke update on public.messages from authenticated, anon` puis `grant update (is_read) on public.messages to authenticated` — seul `is_read` est updatable directement
- Helper `is_my_account_active()` SECURITY DEFINER STABLE — cache résultat dans la transaction

### 3.3 `mots_interdits` — deny-all (mig 105)

`enable row level security` + aucune policy + `revoke all from public, anon, authenticated`. service_role only.

### 3.4 `users_read_conversation_participant` (mig 23, sur `public.users`)

Hors de cette table mais à mentionner : permet à un participant de joindre le profil de l'autre (avatar, prénom) dans la requête conversations. Sans cette policy, la RLS `users_own_profile` (auth.uid() = id) bloque la jointure → liste de convs sans avatar/prénom.

```sql
create policy users_read_conversation_participant on public.users
  for select using (
    exists (
      select 1 from public.conversations c
      where (c.acheteur_id = auth.uid() or c.vendeur_id = auth.uid())
        and (c.acheteur_id = id or c.vendeur_id = id)
    )
  );
```

---

## 4. RPCs publiques (toutes SECURITY DEFINER, granted to authenticated)

### 4.1 `get_or_create_conversation(p_annonce_id uuid) → jsonb` (mig 22, refait mig 40)

Idempotent : retourne la conversation existante (`UNIQUE (annonce_id, acheteur_id)`) ou en crée une nouvelle. Le vendeur est déduit de `annonces.vendeur_id` (anti-triche).

**Validations séquentielles** :
| # | Condition | Erreur retournée (jsonb `error`) |
|---|---|---|
| 1 | `auth.uid()` null | `not_authenticated` |
| 2 | annonce inexistante | `annonce_not_found` |
| 3 | `auth.uid() = vendeur_id` | `cannot_message_self` |
| 4 | annonce `statut NOT IN ('active', 'en_cours')` | `annonce_not_available` |

**Effet succès** : `INSERT ... ON CONFLICT (annonce_id, acheteur_id) DO NOTHING` → réutilise la conv si elle existait, sinon en crée une. Retourne `{success: true, conversation: {id, annonce_id, acheteur_id, vendeur_id, created_at}}`.

**Note** : ne raise PAS d'exception, retourne toujours un jsonb (pattern v4.0). Le client mobile (`lib/conversation.ts`) lit `result.error` pour discriminer.

### 4.2 `mark_messages_read(p_conversation_id uuid) → void` (mig 22)

Batch update `is_read = true` sur tous les messages non-lus de la conv **dont l'expediteur n'est pas self**. Ne touche jamais ses propres messages.

**Validations** :
- `auth.uid()` null → `raise exception 'not_authenticated'` (pattern différent de `get_or_create_conversation` — historique mig 22)
- non-participant → `raise exception 'not_participant'`

**Effet** : `UPDATE messages SET is_read = true, updated_at = now() WHERE conversation_id = $1 AND expediteur_id != auth.uid() AND is_read = false`. Idempotent (un re-call sans nouveaux msgs ne fait rien).

### 4.3 RPCs RDV (déléguées à `rdv.md`)

Toutes opèrent sur `conversations.rdv_*` + insèrent un message `type='systeme'` (bypass content filter mig 35) :

- `propose_rdv(p_conversation_id uuid, p_lieu text, p_date timestamptz)` — mig 35, bloqué immo mig 100
- `confirm_rdv(p_conversation_id uuid)` — mig 35
- `cancel_rdv(p_conversation_id uuid)` — mig 35
- `confirm_rencontre(p_conversation_id uuid, p_rencontre boolean)` — mig 86

**Note pour les tests de ce module** : ne pas re-tester ces 4 RPCs (déjà couvertes par `tests/sql/rdv.test.sql` + `tests/sql/rencontre.test.sql`). Tester ici uniquement :
- Bypass `type='systeme'` du content filter
- Insertion message system par `propose_rdv` met à jour `last_message_preview` via trigger `tg_conversation_last_message`

---

## 5. RPCs admin (SECURITY DEFINER, gate `is_current_user_admin()`)

### 5.1 `admin_soft_delete_message(p_message_id uuid) → void` (mig 57)

`UPDATE messages SET is_deleted = true WHERE id = $1 AND is_deleted = false`. Préserve le contenu pour audit/modération. Le client mobile filtre `is_deleted=false` côté front (cf. `lib/messages.ts:fetchMessages`).

**Exceptions** (errcode P0001-P0003) :
- `AUTH_REQUIRED` — `auth.uid()` null
- `ADMIN_REQUIRED` — pas admin
- `MESSAGE_NOT_FOUND` — id inexistant (idempotent OK si déjà supprimé)

### 5.2 `admin_suspend_user(p_user_id uuid) → void` (mig 57)

`UPDATE users SET is_active = false`. Effet RLS mig 74 : ce user ne peut plus INSERT messages (ni annonces/signalements/favoris) jusqu'à réactivation. Idempotent (re-suspension OK silencieuse).

**Exceptions** :
- `AUTH_REQUIRED`, `ADMIN_REQUIRED`
- `CANNOT_SUSPEND_SELF` — admin ne peut pas se suspendre
- `USER_NOT_FOUND` — id inexistant

### 5.3 `admin_suspend_annonce(p_annonce_id uuid) → void` (mig 57)

Cross-module (touche `annonces`, pas `messages`/`conversations`). Documenté dans `annonces.md` §5 mais cité ici car partie du même tandem cascade admin.

---

## 6. Triggers actifs

### 6.1 Sur `messages`

| Trigger | When | Fonction | Effet | Mig |
|---|---|---|---|---|
| `tg_messages_content_filter` | BEFORE INSERT | `fn_messages_content_filter()` | Raise `contenu_interdit` si match `mots_interdits`. **Bypass `type='systeme'`** (mig 35). SECURITY DEFINER (bypass RLS deny-all mig 105 via `fn_check_forbidden_words`) | 29→35 |
| `tg_conversation_last_message` | AFTER INSERT | `fn_update_conversation_last_message()` | Dénormalise `conversations.last_message_preview` (100 chars) + `last_message_at = NEW.created_at`. SECURITY DEFINER (bypass UPDATE revoke mig 74) | 22 |
| `set_messages_updated_at` | BEFORE UPDATE | `set_updated_at()` (helper mig 10) | Force `updated_at = now()` à chaque update | 22 |
| `trg_push_new_message` | AFTER INSERT | `fn_push_new_message()` | Push Expo au destinataire si `type='texte'` (skip `'systeme'` + `is_deleted`). Fire-and-forget pg_net.http_post. SECURITY DEFINER | 65 |

### 6.2 Sur `conversations`

| Trigger | When | Fonction | Effet | Mig |
|---|---|---|---|---|
| `trg_push_rdv_proposed` | AFTER UPDATE OF `rdv_propose_at` | `fn_push_rdv_proposed()` | Push à l'autre participant. Fire transition NULL → non-NULL ou changement timestamp | 66 |
| `trg_push_rdv_confirmed` | AFTER UPDATE OF `rdv_confirme_at` | `fn_push_rdv_confirmed()` | Push aux 2 participants (cf. note mig 65 : pas d'accès auth.uid() fiable dans trigger AFTER UPDATE) | 65 |
| `trg_push_rdv_annule` | AFTER UPDATE OF `rdv_annule_at` | `fn_push_rdv_annule()` | Push à l'autre participant | 66 |
| `tg_annonce_statut_on_rencontre_change` | AFTER UPDATE OF `rencontre_decided_at` | `fn_annonce_statut_on_rencontre_change()` | Si `(rencontre_acheteur, rencontre_vendeur) = (false, false)` → annonce revert `en_cours → active`. Cf. `rdv.md` §3.5 | 86 |

**Trigger non-évident** : `tg_conversation_last_message` (mig 22) tourne en SECURITY DEFINER pour pouvoir updater conversations malgré le REVOKE UPDATE (mig 74). Sans le SECURITY DEFINER l'INSERT message échouerait à dénormaliser.

---

## 7. Helpers SQL (SECURITY DEFINER)

### 7.1 `fn_check_forbidden_words(p_text text) → text` (mig 29)

Cherche le **premier** mot interdit dans `p_text` (case-insensitive, sous-chaîne — pas mot entier strict pour tolérer les variantes). Retourne le mot trouvé ou NULL.

**Note d'implémentation** : utilise `position(lower(m.mot) in v_lower) > 0` — donc "assassin" matche "ass" si "ass" était dans la liste (volontaire, faux positifs acceptables vu le contenu de la liste).

SECURITY DEFINER → bypass RLS deny-all mig 105 sur `mots_interdits`.

### 7.2 `is_my_account_active() → boolean` (mig 74)

`SELECT is_active FROM users WHERE id = auth.uid()` — défaut `false` si user introuvable. SECURITY DEFINER STABLE (cache transaction).

Utilisé par RLS INSERT messages/annonces/signalements/favoris pour bloquer les users suspendus avant la purge cron J+30.

### 7.3 `_notify_push(p_user_ids uuid[], p_title text, p_body text, p_data jsonb) → void` (mig 65)

Helper privé fire-and-forget. SECURITY DEFINER avec `revoke all` (callable uniquement par triggers internes, pas exposé REST). Lit `service_role_key` + `push_function_url` depuis `vault.decrypted_secrets`, push via `net.http_post()` à l'Edge Function `send-push-notification`. Tous les fail-cases (vault vide, pg_net désactivé, http_post error) → `raise notice` + return (non-bloquant pour la transaction métier).

---

## 8. Crons

**Aucun cron direct** sur `conversations`/`messages`/`mots_interdits`. Les opérations cron qui touchent indirectement ces tables :
- `purge-suspended-users-cron` (mig 04) — DELETE `auth.users` après 30j `is_active=false` → cascade DELETE convs + messages via FK (mig 24)
- `expire-annonces` (mig 16) → annonces `expiree` → conversations.annonce_id passe à NULL via FK SET NULL (mig 39), **les convs et messages restent** (préserve historique)
- `purge-expired-annonces` (mig 16, instrumenté mig 109) — DELETE annonces après 28j expirées → idem, FK SET NULL préserve convs/messages
- Cron rencontre relance (mig 87, voir `rdv.md`) — push aux participants avec `rdv_date < now() - 24h AND rencontre_decided_at IS NULL`, ne mute pas les tables

---

## 9. Storage

**Aucun bucket** attaché au module. Les images en chat sont prévues Phase 2 (`type='image'` dans `type_message` enum mig 22, dormant). Les `rencontre_photos` (mig 92) ont leur propre table dédiée + bucket `rencontre-photos` (couvert par `rdv.md`).

---

## 10. Diagramme — lifecycle conversation

```
                  ┌─────────────────────┐
                  │ acheteur tape       │
                  │ "Contacter"         │
                  └──────────┬──────────┘
                             ▼
                  get_or_create_conversation(annonce_id)
                  ─ gate : annonce active|en_cours
                  ─ gate : auth.uid() != vendeur_id
                  ─ gate : 1 conv max par couple
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
          exists ?                      INSERT new conv
              │                             │
              └────────────┬────────────────┘
                           ▼
            ┌──────────────────────────────┐
            │ chat (messages.type='texte') │
            │  ─ trigger content_filter    │
            │  ─ trigger push_new_message  │
            │  ─ trigger last_message      │
            │  ─ realtime postgres_changes │
            └──────────────┬───────────────┘
                           │
                           ▼ (propose_rdv → confirm_rdv → confirm_rencontre)
            ┌──────────────────────────────┐
            │ cycle RDV — voir rdv.md       │
            │  conv.rdv_*  + rencontre_*   │
            │  messages.type='systeme'      │
            └──────────────┬───────────────┘
                           │
        ┌──────────────────┼─────────────────────┐
        ▼                  ▼                     ▼
   user delete         admin cascade        annonce purge
   FK CASCADE          (suspend/del)        FK SET NULL
   → DELETE conv       is_deleted=true      conv reste
   → DELETE msg        is_active=false      annonce_id=NULL
                       statut=suspendue
```

---

## 11. Points d'intégration cross-module

| Module | Comment ça interagit |
|---|---|
| **RDV** (`rdv.md`) | RPCs `propose_rdv`/`confirm_rdv`/`cancel_rdv`/`confirm_rencontre` mutent `conversations.rdv_*` + `rencontre_*` + insèrent messages `type='systeme'`. Bypass content filter mig 35. |
| **Annonces** (`annonces.md`) | FK `conversations.annonce_id ON DELETE SET NULL` (mig 39) — purge cron annonce préserve historique. `get_or_create_conversation` gate sur `annonces.statut`. Lifecycle `en_cours` (mig 39) déclenché par `confirm_rdv` trigger sur annonces (pas sur conv). |
| **Notation** (`notation.md`) | `avis.conversation_id` FK conversations(id) ON DELETE CASCADE (mig 37) — purge conv = purge avis. Gates `submit_avis` lit `conversations.rdv_confirme_at` + `rencontre_*`. |
| **Signalements** (P1 backfill pending) | `signalements.target_type='message'` → target_id = messages.id. Trigger `fn_signalement_check_threshold` (mig 25) update `users.score_abus` + auto-suspend. Trigger `fn_push_signalement_treated` (mig 65) push au target user à la décision admin. |
| **Push** (mig 64-68) | 4 triggers `trg_push_*` sur `conversations`/`messages` (cf. §6). Fire-and-forget non-bloquant. |
| **Audit log admin** (`audit.test.sql`) | Pas de log auto sur opérations conversations/messages — `admin_soft_delete_message` et `admin_suspend_user` n'enregistrent pas dans `audit_log_admin` (drift identifié — voir §13). |
| **Observability** (`observability.md`) | Aucune instrumentation `niqo_event_log` sur ce module. Le compteur "messages envoyés / jour" n'existe pas en MVP (à ajouter Phase 2 si KPI engagement). |

---

## 12. Realtime publication

| Table | Publication | Mig |
|---|---|---|
| `messages` | `supabase_realtime` | 22 |
| `conversations` | `supabase_realtime` | 35 |

Client mobile subscribe via `lib/messages.ts:subscribeToMessages(conversation_id)` (postgres_changes filtré par RLS). La RLS gate automatiquement les events aux 2 participants — pas besoin de filter côté client.

---

## 13. Écarts / drift identifiés

| # | Sévérité | Finding | Recommandation |
|---|---|---|---|
| F1 | 🟡 | **Pas d'audit log sur `admin_soft_delete_message` ni `admin_suspend_user`** — mig 57 a précédé l'audit log mig 103. Une action admin destructive sur un message n'est tracée que dans Postgres logs. | Ajouter `_log_admin_action(...)` dans les 3 RPCs admin de mig 57 (mig de cleanup P3). Non-bloquant MVP (admin = Dominique solo, pas de risque interne). |
| F2 | 🟡 | **type='image' et type='offre_prix' dormants** — enum `type_message` (mig 22) contient ces 2 valeurs Phase 2 jamais utilisées. Le trigger `fn_push_new_message` (mig 65) a un branchement `'image' → '📷 Photo'` jamais exécuté. | Garder (dans le CDC Phase 2). Documenter ici suffit. |
| F3 | 🟡 | **`offre_montant` jamais set** — colonne mig 22 sans usage côté code. | Garder (Phase 2 — offre de prix dans chat). Pas de migration de nettoyage justifiée. |
| F4 | 🟢 | **`get_or_create_conversation` ne raise PAS** — pattern jsonb. `mark_messages_read` raise par contre. Incohérence mineure héritée mig 22. | Garder (le client mobile gère déjà les 2 patterns). Pas de refactor à court terme. |
| F5 | 🟢 | **Pas de DELETE policy** sur `conversations` ni `messages` — seul cascade FK supprime. Le user lambda ne peut donc PAS supprimer sa conv/son msg manuellement. | Volontaire — préserve trace pour la modération (signalements). Documenter dans CGV/CGU si pas déjà fait. |
| F6 | 🟢 | **`mots_interdits` n'a pas d'index sur `mot`** — `UNIQUE` crée déjà un index implicite, donc OK. | Pas d'action. |
| F7 | 🟢 | **`fn_check_forbidden_words` LIMIT 1** — ne retourne que le premier mot trouvé. Si un message contient 3 mots interdits, l'utilisateur n'en voit qu'un et risque de re-tenter avec les 2 autres. | Acceptable — friction volontaire pour le user de bonne foi qui s'est trompé. Pour un bad actor, l'auto-suspend score abus 3 chope toute façon. |

---

## 14. Tests

### pgTAP — `tests/sql/conversations.test.sql`

Couvre :
- **A. RLS** (~12 assertions)
  - `conversations_select_participants` : acheteur/vendeur voient leur conv, tiers non
  - `conversations_insert_buyer` : acheteur OK, vendeur bloqué
  - REVOKE UPDATE conversations (mig 74) — direct UPDATE échoue
  - `messages_select_participants` : participants OK, tiers non
  - `messages_insert_participants` : self+participant+actif OK, suspendu bloqué (mig 74)
  - `messages_update_participants` column-level : `is_read` OK, `contenu` bloqué (mig 74)
  - `mots_interdits` deny-all : SELECT en authenticated échoue (mig 105)
- **B. RPCs** (~10 assertions)
  - `get_or_create_conversation` : not_authenticated / annonce_not_found / cannot_message_self / annonce_not_available / happy path / idempotent
  - `mark_messages_read` : not_authenticated / not_participant / happy path (ne marque pas ses propres msgs)
- **C. Content filter** (~6 assertions)
  - `fn_check_forbidden_words` : match exact (`'cocaine'`), case-insensitive (`'COCAINE'`), sous-chaîne (`'cocainomane'` matche `'cocaine'`), null/empty
  - `tg_messages_content_filter` : bloque `type='texte'` interdit, **bypass `type='systeme'`** (mig 35)
- **D. Triggers** (~5 assertions)
  - `tg_conversation_last_message` : dénormalise preview (100 chars max) + last_message_at
  - `set_messages_updated_at` : update touche updated_at
- **E. Admin RPCs** (~6 assertions)
  - `admin_soft_delete_message` : AUTH/ADMIN/MESSAGE_NOT_FOUND/idempotent/happy path
  - `admin_suspend_user` : CANNOT_SUSPEND_SELF/happy path → user ne peut plus INSERT message

### Vitest — `tests/integration/conversations.test.ts`

Couvre end-to-end via PostgREST :
1. `get_or_create_conversation` happy path (Alice acheteur, Bob vendeur)
2. `get_or_create_conversation` idempotent (2e call retourne même id)
3. `get_or_create_conversation` cannot_message_self (Bob sur sa propre annonce)
4. Send message + trigger `last_message_preview` propagé sur conv
5. Send message contenu interdit → bloqué par content filter
6. `mark_messages_read` happy path (Bob lit msgs Alice)
7. RLS conv SELECT : Carol (tiers) ne voit pas la conv Alice-Bob
8. RLS message SELECT : idem
9. RLS message INSERT bloqué pour Carol (non-participant)
10. RLS message UPDATE column-level : `is_read` OK, `contenu` bloqué
11. Suspendre Alice → `INSERT messages` bloqué par `is_my_account_active()`
12. `admin_soft_delete_message` → message marqué `is_deleted=true` (visible en select admin, à filtrer côté front)
13. Realtime : insert message déclenche un event postgres_changes côté abonné (smoke test — skip si Realtime instable en CI)

---

## 15. Références

- Migrations : 22, 23, 24, 29, 35, 36, 39, 40, 57, 65, 66, 71, 74, 86, 105 (voir en-tête — mig 39 mute `conversations.annonce_id` FK en ON DELETE SET NULL)
- Code front mobile : `lib/conversation.ts`, `lib/messages.ts`, `app/messages/[conversationId].tsx`, `lib/hooks/useUnreadCount.ts`
- Code front admin : `landing/src/app/admin/(admin-protected)/signalements/[id]/cascade-actions.ts`
- Tests : `tests/sql/conversations.test.sql`, `tests/integration/conversations.test.ts`
- Docs liées : `docs/backend/rdv.md` (RDV + rencontre), `docs/backend/notation.md` (avis), `docs/backend/annonces.md` (lifecycle), `docs/backend/observability.md`
