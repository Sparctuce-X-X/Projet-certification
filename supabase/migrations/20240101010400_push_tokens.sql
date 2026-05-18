-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 64 — Push notifications tokens (F10)
--
-- Source : CDC v4.0 §F10 — Notifications push (Expo).
--
-- L'app mobile demande la permission notifs au 1er signup, récupère un
-- ExpoPushToken (format `ExponentPushToken[xxx]`), et l'enregistre via la
-- RPC `register_push_token` (upsert idempotent).
--
-- Un user peut avoir plusieurs tokens (1 par device). Le token est unique
-- au monde (UNIQUE constraint), mais on conserve `user_id` pour pouvoir
-- envoyer une notif à tous les devices d'un user.
--
-- Convention :
--   - INSERT/UPDATE via RPC uniquement (pas de PostgREST direct)
--   - SELECT via RLS owner-only (l'user voit ses tokens)
--   - DELETE via RLS owner ou cascade auth.users (droit à l'oubli)
--   - L'Edge Function send-push-notification utilise la service_role pour
--     bypasser RLS et envoyer aux tokens d'autres users
--
-- last_seen_at : update à chaque register call → on garde fresh.
-- Cron pourrait purger les tokens > 90 jours sans seen (à voir Phase 2).
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enum platform ───────────────────────────────────────────────────────

do $$ begin
  create type push_platform as enum ('ios', 'android', 'web');
exception
  when duplicate_object then null;
end $$;

-- ── 2. Table push_tokens ───────────────────────────────────────────────────

create table if not exists public.push_tokens (
  id            uuid          primary key default uuid_generate_v4(),
  user_id       uuid          not null references public.users(id) on delete cascade,
  token         text          not null check (char_length(token) between 10 and 200),
  platform      push_platform not null,
  device_name   text          check (device_name is null or char_length(device_name) between 1 and 100),
  created_at    timestamptz   not null default now(),
  last_seen_at  timestamptz   not null default now(),
  constraint push_tokens_token_unique unique (token)
);

create index if not exists idx_push_tokens_user_id
  on public.push_tokens (user_id);

-- ── 3. RLS ─────────────────────────────────────────────────────────────────

alter table public.push_tokens enable row level security;

-- L'user voit ses propres tokens (utile pour debug "mes devices")
drop policy if exists push_tokens_owner_select on public.push_tokens;
create policy push_tokens_owner_select on public.push_tokens
  for select using (auth.uid() = user_id);

-- Insert/update via RPC uniquement, pas de policy directe
drop policy if exists push_tokens_owner_delete on public.push_tokens;
create policy push_tokens_owner_delete on public.push_tokens
  for delete using (auth.uid() = user_id);

-- ── 4. RPC register_push_token ─────────────────────────────────────────────
-- Upsert idempotent : si le token existe déjà, on update last_seen_at + le
-- relie au user courant (cas device partagé entre comptes — rare).
-- Si nouveau token, insert.

create or replace function public.register_push_token(
  p_token        text,
  p_platform     text,
  p_device_name  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if p_token is null or char_length(p_token) < 10 then
    raise exception 'INVALID_TOKEN' using errcode = 'P0002';
  end if;

  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'INVALID_PLATFORM' using errcode = 'P0003';
  end if;

  insert into public.push_tokens (user_id, token, platform, device_name)
  values (v_uid, p_token, p_platform::push_platform, p_device_name)
  on conflict (token) do update
    set user_id      = excluded.user_id,
        last_seen_at = now(),
        device_name  = coalesce(excluded.device_name, push_tokens.device_name)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_push_token(text, text, text) from public;
grant execute on function public.register_push_token(text, text, text) to authenticated;

-- ── 5. Helper get_push_tokens_for_users (utilisé par Edge Function) ────────
-- Permet à l'Edge Function (service_role) de récupérer tous les tokens
-- actifs pour une liste de users. Bypass RLS via SECURITY DEFINER.

create or replace function public.get_push_tokens_for_users(
  p_user_ids uuid[]
)
returns setof public.push_tokens
language sql
security definer
set search_path = public
as $$
  select * from public.push_tokens
   where user_id = any(p_user_ids);
$$;

revoke all on function public.get_push_tokens_for_users(uuid[]) from public;
grant execute on function public.get_push_tokens_for_users(uuid[]) to service_role;
