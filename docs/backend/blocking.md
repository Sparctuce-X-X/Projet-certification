# Module Blocking — Backend

> Source de vérité backend du module **Bloquer un utilisateur** (F15).
> Couvre : table `blocked_users`, RLS (3 policies), 5 RPCs (block / unblock / get_ids / am_i_blocked_in_conv / get_my_blocked_users_display), trigger BEFORE INSERT messages, Realtime publication, droit à l'oubli, et les helpers mobiles qui consomment.
>
> **Migrations concernées** : 129, 130, 131, 132.
> **Tier RGPD** : 🟡 P2 — relation N:N entre 2 users + motif texte libre 500 chars (collecté par l'app, visible admin uniquement). Couvert par la cascade DELETE droit à l'oubli (FK cascade mig 129).
> **Conformité stores** : Apple Guideline 1.2 Safety — User-Generated Content + Google Play UGC policy.

---

## 1. Vue d'ensemble

`public.blocked_users` est une relation **asymétrique** (unidirectionnelle) entre 2 users : `blocker_id` a bloqué `blocked_id`. La PK composite `(blocker_id, blocked_id)` impose l'unicité par paire ordonnée. Un blocage ne se voit que côté blocker (anti-stalking : le bloqué ne sait pas qu'il a été bloqué, best-practice industrie).

**3 garanties Apple Guideline 1.2 UGC** :
1. **"Block abusive users"** — RPC `block_user` (mig 129/131) accessible depuis n'importe quel profil/conv.
2. **"Notify the developer"** — chaque block crée un signalement implicite `target_type='utilisateur'` via `INSERT ... ON CONFLICT DO UPDATE` (mig 131). L'admin reçoit un email Resend déclenché par le trigger `tg_admin_notif_signalement` (mig 125) sur INSERT, ou par appel manuel `_notify_admin_email` sur UPDATE (détecté via `xmax = 0`).
3. **"Remove from feed instantly"** — couvert sur 2 canaux :
   - **Annonces** : filter front via `useBlockedUsers` hook + paramètre `excludeVendeurIds` dans `lib/annonces.ts` → PostgREST `.not('vendeur_id', 'in', blockedIds)`.
   - **Messages** : trigger DB `fn_messages_block_check` BEFORE INSERT raise `BLOCKED_BY_RECIPIENT` côté bloqué (mig 130).

**Contexte** : Apple a rejeté la build iOS 1.0.0 (4) le 2026-05-15 pour absence de mécanisme de blocage. La feature complète a été shipping dans la journée (mig 129-132 + UI mobile). Apple a validé 1.0.0 (5) en 24h le 2026-05-16.

---

## 2. Table `public.blocked_users`

Mig 129.

| Colonne | Type | Contraintes | Usage |
|---|---|---|---|
| `blocker_id` | `uuid` NOT NULL | FK → `public.users(id)` ON DELETE CASCADE | Owner du block — cascade droit à l'oubli |
| `blocked_id` | `uuid` NOT NULL | FK → `public.users(id)` ON DELETE CASCADE | Cible du block — cascade si compte supprimé |
| `reason` | `text` NULL | `check (reason is null or char_length(reason) <= 500)` | Motif libre facultatif (visible admin) |
| `created_at` | `timestamptz` NOT NULL | `default now()` | Horodatage + tri liste "Utilisateurs bloqués" |
| PK | — | `(blocker_id, blocked_id)` | Anti-doublon par paire ordonnée |
| CHECK | — | `blocker_id <> blocked_id` | Anti-self-block au niveau schéma |

**Index** :
- PK `(blocker_id, blocked_id)` — lookup principal (un user a-t-il bloqué telle cible).
- `idx_blocked_users_blocked (blocked_id, created_at desc)` — queries inverses pour stats admin (qui a bloqué telle cible).

**Pas d'`updated_at`** : le motif est figé au moment du block. Pour modifier, l'utilisateur doit unblock + re-block (intentionnel — préserve l'horodatage initial pour audit).

---

## 3. RLS

Mig 129. Owner-scoped strict — un user ne voit / insère / supprime que ses propres blocks.

| Policy | For | Using / With Check | Note |
|---|---|---|---|
| `blocked_users_own_select` | SELECT | `auth.uid() = blocker_id` | Un user ne voit que la liste des users qu'IL a bloqués. Anon : résultat vide. **La cible ne sait pas qu'elle est bloquée** (best-practice industrie). |
| `blocked_users_own_insert` | INSERT | `auth.uid() = blocker_id` | Un user ne peut bloquer que pour son propre compte. Le RPC `block_user` SECURITY DEFINER bypass cette policy mais ajoute ses propres checks (anti-self, anti-system, target existe). |
| `blocked_users_own_delete` | DELETE | `auth.uid() = blocker_id` | Déblocage idempotent. Pas de guard `is_active` (un user suspendu peut quand même unblock — cohérent : retrait toujours permis). |

**Pas de policy UPDATE** : le motif est immuable post-INSERT.

**Bypass RLS volontaire** :
- `block_user`, `unblock_user`, `get_my_blocked_user_ids`, `am_i_blocked_in_conv`, `get_my_blocked_users_display` sont toutes `SECURITY DEFINER` avec check `auth.uid()` explicite.
- Le trigger `fn_messages_block_check` lit `blocked_users` en SECURITY DEFINER (bypass RLS) pour appliquer le block en BEFORE INSERT messages — sans ça, l'expéditeur (bloqué) ne pourrait pas voir sa propre ligne dans `blocked_users` car la policy SELECT filtre sur `blocker_id = auth.uid()`.

---

## 4. RPCs

5 RPCs au total. Toutes `SECURITY DEFINER set search_path = public`, `revoke all from public` + `grant execute to authenticated` (ou jamais grant pour les helpers internes).

### 4.1 `block_user(p_target_id uuid, p_reason text default null) returns jsonb`

Mig 129 → patchée mig 131 (fix email admin sur `unique_violation`).

**Gates** :
- `auth.uid() is null` → `{success:false, error:'not_authenticated'}`.
- `auth.uid() = p_target_id` → `{success:false, error:'cannot_block_self'}`.
- `p_target_id = '00000000-0000-0000-0000-000000000001'` (user système Niqo Auto-Modération mig 119) → `{success:false, error:'cannot_block_system'}`.
- Target n'existe pas dans `public.users` → `{success:false, error:'target_not_found'}`.
- Déjà bloqué (`exists` sur PK) → `{success:false, error:'already_blocked'}`. Le PK constraint protège également contre la race condition (`unique_violation` → même `error`).

**Effets** :
1. `INSERT INTO blocked_users` (peut catch `unique_violation` race → already_blocked).
2. **"Notify the developer" Apple Guideline 1.2** : `INSERT INTO signalements ('utilisateur', target, blocker, motif, description) ON CONFLICT ON CONSTRAINT signalements_unique_per_user DO UPDATE SET motif, description, statut='en_attente' (remet en attente si déjà traité/rejeté — le block est une nouvelle alerte plus forte), updated_at=now() RETURNING id, (xmax = 0) INTO v_id, v_was_inserted`.
   - Si **INSERT** : trigger `tg_admin_notif_signalement` (mig 125) AFTER INSERT fire → email admin auto.
   - Si **UPDATE** : trigger AFTER INSERT ne fire pas → appel manuel `_notify_admin_email('signalement', v_id)`.
3. Le bloc signalement est wrappé dans `begin ... exception when others then raise notice` — un fail signalement ne doit pas annuler le block (Apple peut le voir comme un échec feature).

**Motif** : `coalesce('Bloqué : ' || left(p_reason, 90), 'Bloqué par utilisateur')`.
**Description** : `coalesce(p_reason, 'Blocage déclenché par l''utilisateur depuis l''app (sans motif détaillé fourni).')`.

### 4.2 `unblock_user(p_target_id uuid) returns jsonb`

Mig 129.

**Effet** : `DELETE FROM blocked_users WHERE blocker_id = auth.uid() AND blocked_id = p_target_id`. Idempotent : returns `{success:true, was_blocked:false}` si rien à supprimer (l'user peut spam le bouton sans erreur).

**Note** : ne nettoie PAS le signalement implicite associé. Le signalement reste dans la queue admin (cohérent : l'admin a déjà été notifié, l'historique du signalement reste audit-trace même si l'user débloque ensuite).

### 4.3 `get_my_blocked_user_ids() returns setof uuid`

Mig 129. `SECURITY DEFINER STABLE`.

**Effet** : `SELECT blocked_id FROM blocked_users WHERE blocker_id = auth.uid()`. Bulk fetch utilisé par le hook `useBlockedUsers` pour filter en O(1) côté front (`Set<string>`).

### 4.4 `am_i_blocked_in_conv(p_conversation_id uuid) returns boolean`

Mig 130. `SECURITY DEFINER STABLE`.

**Effet** : résout l'autre participant de la conv via `conversations.acheteur_id/vendeur_id`, puis check `exists(blocked_users WHERE blocker_id=other AND blocked_id=auth.uid())`. Returns `false` si non-auth, conv inexistante, ou caller n'est pas participant.

**Volontairement NE PAS exposer la liste de QUI a bloqué l'user** (best-practice industrie). Le boolean isolé empêche la cible de découvrir qu'elle est bloquée — utilisé uniquement pour désactiver le composer chat (UX gracieuse vs erreur silencieuse à l'envoi).

Fail-open côté client (`lib/blocking.ts::amIBlockedInConv`) : si la RPC échoue, autorise l'envoi — le trigger DB rattrapera via `BLOCKED_BY_RECIPIENT` au moment de l'INSERT.

### 4.5 `get_my_blocked_users_display() returns table(id, prenom, avatar_url, reason, blocked_at)`

Mig 132. `SECURITY DEFINER STABLE`.

**Pourquoi** : la page `app/profile/blocked-users.tsx` affichait "Utilisateur supprimé" pour chaque ligne. Cause : `SELECT ... FROM users WHERE id IN (...)` direct depuis le client est refusé par la RLS strict sur `public.users` (mig 01 + 23 + 52) pour les IDs qui ne sont pas (self / participant de conv partagée / admin). Pour un user bloqué sans conv partagée → 0 row → fallback "Utilisateur supprimé".

**Effet** : join `blocked_users + users` filtré `WHERE b.blocker_id = auth.uid()` order by `b.created_at desc`. Returns `(id, prenom, avatar_url, reason, blocked_at)`. Scope strictement limité aux users que TU as bloqués → pas de leak.

---

## 5. Triggers

### 5.1 `tg_messages_block_check` BEFORE INSERT ON `messages`

Mig 130. Fonction `fn_messages_block_check()` SECURITY DEFINER.

**Skips** :
- `NEW.type = 'systeme'` → return NEW (cohérent avec mig 35 content filter bypass — Niqo Auto-Modération messages doivent passer).
- Conv inexistante (`v_acheteur_id is null`) → return NEW (FK guard par autre trigger).
- Expéditeur non-participant (`v_destinataire_id is null`) → return NEW (RLS guard par mig 22).

**Check principal** : résout destinataire via `conversations.acheteur_id/vendeur_id`, puis `exists(blocked_users WHERE blocker_id=destinataire AND blocked_id=expediteur)`. Si oui → `raise exception 'BLOCKED_BY_RECIPIENT' using errcode = 'restrict_violation', hint = 'The recipient has blocked you...'`.

**Côté client** : helper `isBlockedByRecipientError(error)` dans `lib/blocking.ts` détecte le code → affiche message neutre non-révélateur. L'expéditeur ne sait pas qu'il a été bloqué.

**Ordre de fire** (alphabétique entre BEFORE INSERT sur `messages`) :
1. `tg_messages_block_check` (mig 130) ← s'exécute en premier
2. `tg_messages_content_filter` (mig 29 + mots interdits, mig 105 RLS sur table)
3. Trigger `tg_moderate_message_async` AFTER INSERT (mig 120) → non affecté

Économie : si bloqué, on n'évalue même pas le content filter.

---

## 6. Realtime

Mig 129. `alter publication supabase_realtime add table public.blocked_users` (idempotent via `do $$ ... exception when duplicate_object then null end $$`).

**Consommateur** : `lib/blocking.ts::subscribeToBlockedUsers(userId, onChange)` ouvre un channel `blocked_users:{userId}:{ts}` filtré `blocker_id=eq.{userId}` (event `*`). Le hook `useBlockedUsers` refresh sur INSERT / DELETE — sync UI immédiat sans polling.

**Cas concret** : user bloque depuis profil → INSERT INSTANT → channel fire → `refresh()` → filter front re-fetch → annonces du bloqué disparaissent du Home/Search.

---

## 7. Pas de crons

Aucun cron sur `blocked_users`. Pas de purge automatique : les blocks restent tant que les 2 users existent (cascade delete fait le ménage si l'un disparaît).

---

## 8. Droit à l'oubli (RGPD)

FK `blocker_id` et `blocked_id` toutes deux `ON DELETE CASCADE` → suppression compte (`delete_my_account()` → `DELETE auth.users`) cascade automatiquement :
- Les blocks que l'user a posés (en tant que blocker).
- Les blocks qui visent l'user (en tant que blocked).

Aucune action explicite nécessaire côté `delete_my_account`. Idempotent.

**Note** : le signalement implicite créé par `block_user` reste indépendamment dans `signalements` (audit-trace modération anti-fraude légitime). FK `signaleur_id` cascade selon mig 70 pattern (à confirmer sur les signalements humains).

---

## 9. Code client qui consomme

### 9.1 `lib/blocking.ts`

| Helper | Description |
|---|---|
| `blockUser(targetId, reason?)` | RPC `block_user` avec timeout `AUTH_TIMEOUT_MS`. Map les codes erreur SQL en messages FR user-friendly (`not_authenticated`, `cannot_block_self`, `cannot_block_system`, `target_not_found`, `already_blocked`). |
| `unblockUser(targetId)` | RPC `unblock_user`. Returns `{success, was_blocked}`. |
| `fetchMyBlockedUserIds()` | RPC `get_my_blocked_user_ids`. Returns `string[]`. |
| `fetchMyBlockedUsers()` | SELECT direct depuis `blocked_users` (RLS filtre owner). Returns `BlockedUserRow[]` (sans détails profil). |
| `fetchMyBlockedUsersWithProfiles()` | RPC `get_my_blocked_users_display` (mig 132). Returns `BlockedUserDisplay[]` avec `prenom + avatar_url`. **Utilisé par `app/profile/blocked-users.tsx`** — bypass RLS users pour afficher les prénoms réels. |
| `amIBlockedInConv(convId)` | RPC `am_i_blocked_in_conv`. Fail-open (false sur erreur). |
| `subscribeToBlockedUsers(userId, onChange)` | Realtime channel — returns unsubscribe. |
| `isBlockedByRecipientError(error)` | Helper détection erreur trigger (`BLOCKED_BY_RECIPIENT`). |

### 9.2 `lib/hooks/useBlockedUsers.ts`

Hook global : refresh au focus de l'écran (`useFocusEffect`) + Realtime subscribe sur INSERT/DELETE. Returns `{blockedIds: Set<string>, isLoaded: boolean, refresh}`. Fail-soft sur erreur réseau (garde l'état précédent pour ne pas afficher du contenu bloqué).

### 9.3 `lib/annonces.ts`

Param `excludeVendeurIds?: string[]` dans `FetchAnnoncesArgs`. Si non vide, ajoute `query.not("vendeur_id", "in", \`(${ids.join(",")})\`)`. Consumers : `app/home.tsx` + `app/search.tsx` calculent `blockedKey = Array.from(blockedIds).sort().join(",")` pour stabiliser le useEffect dep (évite refetch infini sur set re-référencé).

### 9.4 Écrans mobiles

- **`components/blocking/BlockUserSheet.tsx`** : Modal bottom sheet (KeyboardAvoidingView iOS + reset state on visibility change) — titre, 3 bullets explication, textarea optionnel motif (500 chars max), CTA Bloquer (coral) / Annuler.
- **`app/profile/blocked-users.tsx`** : FlatList + RefreshControl + ItemSeparator. Empty state `ShieldOff` icon. Error state + retry. Unblock optimiste avec rollback. `useFocusEffect` pour refresh.
- **`app/u/[id].tsx`** (profil public) : bouton "Bloquer/Débloquer cet utilisateur" (border-niqo-danger + font-display) sous le bouton Signaler. Alert.alert confirmation pour Unblock.
- **`app/messages/[conversationId].tsx`** : kebab menu header (ActionSheetIOS iOS / Alert Android) entrée "Bloquer cet utilisateur". Handle `BLOCKED_BY_RECIPIENT` au send avec message neutre.
- **`app/profile.tsx`** : MenuRow "Utilisateurs bloqués" dans section Compte (icône `ShieldOff`).

### 9.5 Auth gate

`blockUser` nécessite session. UI déclenche `requireAuth("block")` (à ajouter si besoin) ou expose le sheet uniquement aux users authentifiés (déjà le cas : pas de bouton Bloquer sur profil public en mode anon).

---

## 10. Findings

| # | Sévérité | Détail |
|---|---|---|
| F1 | ✅ résolu mig 131 | **`unique_violation` silencieux annulait l'email admin** : la mig 129 `block_user` catch `unique_violation` sur l'INSERT signalements → trigger AFTER INSERT ne fire pas → pas d'email. Or le passage du signalement au block est un signal plus fort qui mérite notification. Fix : `INSERT ON CONFLICT DO UPDATE` + appel manuel `_notify_admin_email` détecté via `xmax = 0`. |
| F2 | ✅ résolu mig 132 | **Page liste affichait "Utilisateur supprimé"** : RLS strict sur `users` bloquait le SELECT direct depuis le client pour les bloqués hors conv partagée. Fix : RPC SECURITY DEFINER `get_my_blocked_users_display` qui bypass RLS avec scope strict (`blocker_id = auth.uid()`). |
| F3 | 🟢 | **Pas de compteur `nb_blocked_by` sur users** : impossible côté client de voir "X users m'ont bloqué" (volontaire — anti-stalking). Côté admin, query directe `SELECT count(*) FROM blocked_users WHERE blocked_id = ?` via Dashboard SQL. Pas exposé dans le back-office Phase 1. |
| F4 | 🟢 | **Pas d'auto-suspension sur `nb_blocked_by` seuil** : actuellement seul le `score_abus` (mig 25, basé sur signalements traités) déclenche la suspension. Cumulé avec le signalement implicite mig 131, un user qui se fait bloquer massivement génère N signalements `motif='Bloqué par utilisateur'` → l'admin peut décider de valider en cascade. Pas d'automatisation pour éviter les faux positifs (campagnes coordonnées de block). |
| F5 | 🟢 | **Cron purge orphelins absent** : pas de purge auto des `blocked_users` orphelins. Inutile vu le cascade FK — la suppression d'un compte cascade tout. À ré-évaluer si on ajoute des FK `set null` à terme. |

---

## 11. Tests

🚧 **Pas encore couvert** au 2026-05-16. Module shipping sous deadline Apple le 2026-05-15. À backfill avant la prochaine itération (cf. `docs/backend/PROCESS.md` état du backfill — Block fait partie de la liste P1).

**À écrire** :
- **Tests pgTAP** : `tests/sql/blocked_users.test.sql` — couvrir schema (PK + check blocker≠blocked + CHECK reason ≤500), 3 RLS policies isolation, 5 RPCs (auth check, anti-self, anti-system, target_not_found, already_blocked, unique_violation upsert signalement → admin notif manuel, RPC display bypass RLS), trigger `fn_messages_block_check` (skip systeme, raise BLOCKED_BY_RECIPIENT, ordre de fire), realtime publication, cascade delete user.
- **Tests Vitest** : `tests/integration/blocked-users.test.ts` — flow E2E via PostgREST (block → vérifier feed annonces filtré + composer messages désactivé via `am_i_blocked_in_conv` + INSERT message bloqué via trigger), Realtime sync (subscribe → block depuis 2nd device → on_change fire), unblock idempotent, cascade delete user → cascade blocks.

---

## 12. Conformité stores

| Store | Policy | Niqo couverture |
|---|---|---|
| **Apple App Store** | Guideline 1.2 Safety — UGC : *"A mechanism for users to block abusive users. Blocking should also notify the developer of the inappropriate content and should remove it from the user's feed instantly."* | ✅ RPC `block_user` + signalement implicite (notify developer) + filter front annonces + trigger DB messages (remove from feed instantly). Validé Apple build 1.0.0 (5) le 2026-05-16. |
| **Google Play** | UGC policy : *"Apps with UGC must provide a system for blocking other users."* | 🚧 À valider — feature en place, build prod Android à monter (cf. `CLAUDE.md §Reste avant lancement`). |

**Précédent rejet Apple** : build 1.0.0 (4) le 2026-05-15. Resolution Center reply 2026-05-16 avec screencast 10 s + lien `docs/backend/blocking.md`. Apple re-validation 24h.
