-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 74 — Hardening RLS UPDATE + guard `is_active` sur INSERT
--
-- 2 trous critiques identifiés à la review #2 :
--
--   A. RLS UPDATE permissive sur `conversations` et `messages`
--      ────────────────────────────────────────────────────────
--      `messages_update_participants` (mig 22) et la policy update
--      conversations (mig 22) utilisent `for update using (...)` SANS
--      `with check` — un participant peut modifier n'importe quelle
--      colonne via PostgREST direct (ex : forcer rdv_confirme_at,
--      réécrire contenu d'un message, etc.).
--      Les RPCs propose_rdv/confirm_rdv/cancel_rdv (mig 35) deviennent
--      contournables.
--
--      Fix : revoke UPDATE column-level pour ne laisser que les colonnes
--      légitimes accessibles directement (is_read sur messages, RIEN sur
--      conversations — tout doit passer par triggers/RPCs SECURITY DEFINER).
--
--   B. is_active=false n'est pas enforcé en RLS
--      ───────────────────────────────────────
--      Quand un user est suspendu (cron auto score abus 3 ou admin manuel),
--      `users.is_active = false` mais aucune RLS ne bloque ses INSERT
--      (annonces, messages, signalements, favoris). Le user peut continuer
--      à publier jusqu'à la purge J+30 (mig 04).
--
--      Fix : helper `is_my_account_active()` SECURITY DEFINER stable, et
--      ajout de ce check dans les policies INSERT critiques.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A. Hardening UPDATE conversations ───────────────────────────────────────
-- Aucune colonne de conversations n'a vocation à être updatée directement
-- par un user authentifié :
--   - acheteur_id, vendeur_id, annonce_id : immutables après INSERT
--   - rdv_* : gérées par RPCs SECURITY DEFINER (propose_rdv, confirm_rdv,
--     cancel_rdv mig 35)
--   - last_message_preview, last_message_at : gérées par trigger AFTER
--     INSERT messages (mig 22)
-- Donc on revoke complètement UPDATE.

revoke update on public.conversations from authenticated;
revoke update on public.conversations from anon;

-- La policy `conversations_update_participants` (mig 22) reste mais ne sera
-- jamais évaluée car le grant a été révoqué. On la drop pour clarté.
drop policy if exists conversations_update_participants on public.conversations;

-- ── A bis. Hardening UPDATE messages ────────────────────────────────────────
-- Une seule colonne est légitimement updatable par un user :
--   - is_read : pour mark-as-read sur les messages reçus
-- Tout le reste (contenu, expediteur_id, type, conversation_id, is_deleted)
-- est immutable depuis le client (le soft-delete passe par la RPC admin
-- `admin_soft_delete_message` mig 57).

revoke update on public.messages from authenticated;
revoke update on public.messages from anon;
grant update (is_read) on public.messages to authenticated;

-- Refondre la policy update : permettre update is_read uniquement aux
-- participants de la conversation. Le with check est ici redondant car le
-- grant column-level ne laisse passer que is_read, mais c'est de la
-- defense en profondeur.
drop policy if exists messages_update_participants on public.messages;
create policy messages_update_participants on public.messages
  for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.acheteur_id or auth.uid() = c.vendeur_id)
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.acheteur_id or auth.uid() = c.vendeur_id)
    )
  );

-- ── B. Helper is_my_account_active() ────────────────────────────────────────
-- SECURITY DEFINER + STABLE : permet à Postgres de cacher le résultat
-- dans la même transaction. Évite la query répétée si plusieurs RLS
-- l'appellent.

create or replace function public.is_my_account_active()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_active from public.users where id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_my_account_active() from public;
grant execute on function public.is_my_account_active() to authenticated;

-- ── B bis. Guard is_active sur INSERT critiques ─────────────────────────────
-- annonces, messages, signalements, favoris : un user suspendu ne peut plus
-- créer de contenu. Les autres opérations (lecture, suppression de son
-- propre contenu) restent OK pour qu'il puisse encore consulter / supprimer
-- son compte.

-- annonces (mig 15)
drop policy if exists annonces_owner_insert on public.annonces;
create policy annonces_owner_insert on public.annonces
  for insert
  with check (
    auth.uid() = vendeur_id
    and public.is_my_account_active()
  );

-- messages (mig 22)
drop policy if exists messages_insert_participants on public.messages;
create policy messages_insert_participants on public.messages
  for insert
  with check (
    auth.uid() = expediteur_id
    and public.is_my_account_active()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.acheteur_id or auth.uid() = c.vendeur_id)
    )
  );

-- signalements (mig 25) — attention : signalements_insert_own peut
-- exister sous différentes formes selon les versions de mig 25
drop policy if exists signalements_insert_own on public.signalements;
create policy signalements_insert_own on public.signalements
  for insert
  with check (
    auth.uid() = signaleur_id
    and public.is_my_account_active()
  );

-- favoris (mig 19)
drop policy if exists favoris_owner_insert on public.favoris;
create policy favoris_owner_insert on public.favoris
  for insert
  with check (
    auth.uid() = user_id
    and public.is_my_account_active()
  );
