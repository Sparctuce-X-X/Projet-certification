-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 92 — Photos post-RDV (anti-fraude visuel)
--
-- PROBLÈME RÉSOLU
--   Mig 91 ajoute le signalement contextualisé post-RDV. Mais l'admin n'a
--   que la description textuelle pour juger. Pour les motifs critiques
--   (produit_different, produit_defectueux, tentative_fraude), une preuve
--   photo est très utile (ex : montrer la fausse monnaie, le produit défectueux,
--   la facture).
--
-- SOLUTION
--   Permettre aux participants d'une conversation avec RDV passé d'ajouter
--   des photos in-app (capture obligatoire via expo-camera, pas d'import
--   galerie pour anti-spoof). Photos visibles uniquement par :
--     - L'auteur (l'autre partie ne les voit PAS, anti-revanche)
--     - L'admin (pour modération de signalement)
--
-- COMPOSANTS
--   1. Table `rencontre_photos` (id, conversation_id, auteur_id, role_auteur,
--      storage_path, created_at)
--   2. Bucket Storage `rencontre-photos` privé (public=false)
--   3. Path pattern : {conversation_id}/{auteur_id}/{photo_id}.jpg
--   4. RLS table : auteur SELECT own + admin SELECT all + INSERT via RPC
--   5. RLS storage.objects : owner INSERT/SELECT (sa folder UID) + admin SELECT all
--   6. RPC `add_rencontre_photo(p_conv_id, p_storage_path)` avec gates :
--      participant + RDV passé + quota max 5 photos par auteur par conv
--   7. Index pour query admin (conv_id, created_at desc)
--
-- ⚠ Configurer dans Supabase Dashboard → Storage → rencontre-photos → Settings :
--    - Public : OFF (DOIT rester privé)
--    - File size limit : 5 MB (max 3MB côté client, marge upload)
--    - Allowed MIME types : image/jpeg, image/webp
--
-- Conformité RGPD :
--   - Photos jamais exposées en URL publique
--   - SELECT auteur seulement (autre partie pas d'accès)
--   - DELETE cascade depuis user.delete_my_account (FK on delete cascade)
--   - DELETE cascade depuis conversation supprimée
--   - Bucket purge automatique via cron à étudier (Phase 2 — purge si
--     conv suppr depuis > 90j)
--
-- Prérequis : mig 22 (conversations), 25-28 (signalements), 44 (users.is_admin),
--             86 (rencontre), 91 (signalement post-RDV).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table rencontre_photos ─────────────────────────────────────────────

create table if not exists public.rencontre_photos (
  id              uuid        primary key default uuid_generate_v4(),
  conversation_id uuid        not null references public.conversations(id) on delete cascade,
  auteur_id       uuid        not null references public.users(id) on delete cascade,
  role_auteur     text        not null check (role_auteur in ('acheteur', 'vendeur')),
  storage_path    text        not null,
  created_at      timestamptz not null default now()
);

comment on table public.rencontre_photos is
  'Photos post-RDV uploadées par les participants comme preuves anti-fraude (mig 92). Visibles uniquement par l''auteur et l''admin (anti-revanche).';

-- Indexes
create index if not exists idx_rencontre_photos_conv
  on public.rencontre_photos (conversation_id, created_at desc);

create index if not exists idx_rencontre_photos_auteur
  on public.rencontre_photos (auteur_id, created_at desc);

-- ── 2. RLS sur la table ───────────────────────────────────────────────────

alter table public.rencontre_photos enable row level security;

-- SELECT : auteur voit ses propres photos
drop policy if exists rencontre_photos_select_own on public.rencontre_photos;
create policy rencontre_photos_select_own on public.rencontre_photos
  for select using (auth.uid() = auteur_id);

-- SELECT : admin voit toutes
drop policy if exists rencontre_photos_select_admin on public.rencontre_photos;
create policy rencontre_photos_select_admin on public.rencontre_photos
  for select using (
    exists (select 1 from public.users where id = auth.uid() and is_admin = true)
  );

-- INSERT : via RPC SECURITY DEFINER uniquement (gates : participant + RDV passé + quota)
-- Pas de policy INSERT directe — la RPC bypass RLS via SECURITY DEFINER.

-- Pas de UPDATE/DELETE pour les users — photos immutables côté user.
-- (Admin peut DELETE via service_role / Dashboard si nécessaire.)

-- ── 3. Bucket Storage `rencontre-photos` ──────────────────────────────────

insert into storage.buckets (id, name, public)
values ('rencontre-photos', 'rencontre-photos', false)
on conflict (id) do update set public = false;  -- force private

-- ── 4. RLS storage.objects pour `rencontre-photos` ────────────────────────

-- Path pattern : {conv_id}/{uid}/{photo_id}.jpg
--   foldername[1] = conv_id
--   foldername[2] = uid (l'auteur)

-- INSERT : user authentifié, sa propre folder (uid = 2ème foldername)
-- + caller doit être participant de la conversation
drop policy if exists "rencontre_photos_owner_insert" on storage.objects;
create policy "rencontre_photos_owner_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'rencontre-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.conversations c
      where c.id = ((storage.foldername(name))[1])::uuid
        and (c.acheteur_id = auth.uid() or c.vendeur_id = auth.uid())
    )
  );

-- SELECT : auteur voit sa propre folder (anti-revanche : autre partie pas d'accès)
drop policy if exists "rencontre_photos_owner_select" on storage.objects;
create policy "rencontre_photos_owner_select" on storage.objects
  for select
  using (
    bucket_id = 'rencontre-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- SELECT : admin voit tout (modération signalement)
drop policy if exists "rencontre_photos_admin_select" on storage.objects;
create policy "rencontre_photos_admin_select" on storage.objects
  for select
  using (
    bucket_id = 'rencontre-photos'
    and exists (
      select 1 from public.users
       where id = auth.uid() and is_admin = true
    )
  );

-- DELETE : admin uniquement (purge sur abus, ou erreur de l'auteur via support)
drop policy if exists "rencontre_photos_admin_delete" on storage.objects;
create policy "rencontre_photos_admin_delete" on storage.objects
  for delete
  using (
    bucket_id = 'rencontre-photos'
    and exists (
      select 1 from public.users
       where id = auth.uid() and is_admin = true
    )
  );

-- Pas d'UPDATE (immutables).

-- ── 5. RPC add_rencontre_photo ────────────────────────────────────────────
-- Gates :
--   - Auth + participant de la conv
--   - RDV doit avoir été confirmé ET la date passée (cohérent avec contexte
--     "preuves post-rencontre")
--   - Quota : max 5 photos par auteur par conv
--   - storage_path doit matcher le path pattern (sécurité défense en profondeur)

create or replace function public.add_rencontre_photo(
  p_conversation_id uuid,
  p_storage_path    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_conv      public.conversations%rowtype;
  v_role      text;
  v_count     int;
  v_path_uid  text;
  v_path_conv text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if p_storage_path is null or trim(p_storage_path) = '' then
    return jsonb_build_object('success', false, 'error', 'path_required');
  end if;

  -- Validation path : doit commencer par {conv_id}/{uid}/
  v_path_conv := split_part(p_storage_path, '/', 1);
  v_path_uid  := split_part(p_storage_path, '/', 2);
  if v_path_conv != p_conversation_id::text or v_path_uid != v_uid::text then
    return jsonb_build_object('success', false, 'error', 'invalid_path');
  end if;

  -- Conv existe + caller participant
  select * into v_conv
  from public.conversations
  where id = p_conversation_id;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  if v_uid != v_conv.acheteur_id and v_uid != v_conv.vendeur_id then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  -- RDV doit avoir été confirmé ET la date doit être passée
  if v_conv.rdv_confirme_at is null then
    return jsonb_build_object('success', false, 'error', 'no_confirmed_rdv');
  end if;

  if v_conv.rdv_date is null or v_conv.rdv_date >= now() then
    return jsonb_build_object('success', false, 'error', 'rdv_not_past');
  end if;

  -- Role auteur
  v_role := case
    when v_uid = v_conv.acheteur_id then 'acheteur'
    else 'vendeur'
  end;

  -- Quota max 5 photos par auteur par conv
  select count(*) into v_count
  from public.rencontre_photos
  where conversation_id = p_conversation_id
    and auteur_id = v_uid;

  if v_count >= 5 then
    return jsonb_build_object('success', false, 'error', 'quota_exceeded');
  end if;

  -- Insert
  insert into public.rencontre_photos (
    conversation_id, auteur_id, role_auteur, storage_path
  ) values (
    p_conversation_id, v_uid, v_role, p_storage_path
  );

  return jsonb_build_object('success', true, 'count_after', v_count + 1);
end;
$$;

revoke all on function public.add_rencontre_photo(uuid, text) from public;
grant execute on function public.add_rencontre_photo(uuid, text) to authenticated;
