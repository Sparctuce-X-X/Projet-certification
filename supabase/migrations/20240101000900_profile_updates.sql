-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 09 — Modification du profil utilisateur (renommée de 05)
--
-- Active la modification des informations profil depuis l'app :
--   1. Bucket Storage `avatars` (public read, owner-only write)
--   2. RPC `update_my_phone(text)` — encrypte + update telephone (bytea Vault)
--   3. Trigger `on_auth_user_email_updated` — sync auth.users.email
--                                              → public.users.email après
--                                              confirmation par lien magique
--
-- Pré-requis : 01_users.sql + 02_users_phone_vault.sql joués.
-- À jouer dans Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Bucket Storage `avatars` (idempotent) ────────────────────────────────
-- Public read pour que les autres users puissent voir l'avatar (cards
-- annonces, profil vendeur). Owner-only write pour empêcher l'écrasement
-- d'avatars d'autrui.
--
-- Convention de path : `{auth.uid()}/avatar.{ext}` — la 1ère foldername
-- détermine la propriété (cf. RLS storage.objects ci-dessous).

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- ── 2. RLS storage.objects pour `avatars` ───────────────────────────────────
-- Drop-then-create pour idempotence (CREATE POLICY n'a pas de IF NOT EXISTS).

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 3. RPC update_my_phone — encrypte + update self ─────────────────────────
-- L'app pousse un téléphone en clair, la RPC l'encrypte via le helper Vault
-- (cf. migration 02) et update la colonne bytea pour auth.uid().
-- Accepte null/'' pour effacer le numéro.

create or replace function public.update_my_phone(new_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.users
     set telephone = public.encrypt_phone(nullif(new_phone, '')),
         updated_at = now()
   where id = auth.uid();
end;
$$;

revoke all on function public.update_my_phone(text) from public;
grant execute on function public.update_my_phone(text) to authenticated;

-- ── 4. Trigger sync auth.users.email → public.users.email ───────────────────
-- Quand l'user clique le lien de confirmation envoyé par supabase.auth
-- .updateUser({ email }), Supabase update auth.users.email. On propage
-- automatiquement vers public.users.email pour garder les deux en cohérence.
--
-- Le trigger est silencieux côté app : à la prochaine fetch du profil,
-- l'email sera à jour.

create or replace function public.handle_email_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.email is distinct from OLD.email then
    update public.users
       set email = NEW.email,
           updated_at = now()
     where id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  execute function public.handle_email_update();
