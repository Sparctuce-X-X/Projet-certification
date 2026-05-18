-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 25 — Signalements (modération communautaire)
--
-- Source : CDC v4.0 §2.6 Pilier 3 + niqo_schema_v1.6.sql §signalements
--
-- 3 cibles : annonce, utilisateur, message
-- 3 signalements confirmés en 30 jours = suspension auto (is_active = false)
-- Score abus incrémenté à chaque signalement confirmé
-- Anti-doublon : un user ne peut signaler la même cible qu'une seule fois
--
-- Composants :
--   1. Enums statut_signalement + cible_signalement
--   2. Table signalements + indexes + RLS
--   3. Trigger anti-doublon
--   4. Trigger auto-suspension (score_abus ≥ 3 en 30j)
--   5. Colonnes nb_signalements + score_abus sur users (si absentes)
--   6. RPC submit_report (création sécurisée)
--
-- Prérequis : migration 01 (users), 15 (annonces), 22 (messages).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enums ────────────────────────────────────────────────────────────────

do $$ begin
  create type statut_signalement as enum ('en_attente', 'traite', 'rejete');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type cible_signalement as enum ('annonce', 'utilisateur', 'message');
exception
  when duplicate_object then null;
end $$;

-- ── 2. Table signalements ──────────────────────────────────────────────────

create table if not exists public.signalements (
  id            uuid               primary key default uuid_generate_v4(),
  target_type   cible_signalement  not null,
  target_id     uuid               not null,
  signaleur_id  uuid               not null references public.users(id) on delete cascade,
  motif         text               not null check (char_length(motif) between 1 and 100),
  description   text               check (description is null or char_length(description) <= 1000),
  statut        statut_signalement not null default 'en_attente',
  created_at    timestamptz        not null default now(),
  updated_at    timestamptz        not null default now()
);

-- Anti-doublon : un user ne peut signaler la même cible qu'une seule fois
alter table public.signalements
  drop constraint if exists signalements_unique_per_user;
alter table public.signalements
  add constraint signalements_unique_per_user
  unique (target_type, target_id, signaleur_id);

-- Indexes
create index if not exists idx_signalements_target
  on public.signalements (target_type, target_id, statut)
  where statut = 'en_attente';

create index if not exists idx_signalements_signaleur
  on public.signalements (signaleur_id);

-- Trigger updated_at
drop trigger if exists tg_signalements_updated_at on public.signalements;
create trigger tg_signalements_updated_at
  before update on public.signalements
  for each row
  execute function public.set_updated_at();

-- RLS
alter table public.signalements enable row level security;

-- Lecture : signaleur voit ses propres signalements
drop policy if exists signalements_select_own on public.signalements;
create policy signalements_select_own on public.signalements
  for select using (auth.uid() = signaleur_id);

-- Insertion : user authentifié, signaleur = soi-même
drop policy if exists signalements_insert_own on public.signalements;
create policy signalements_insert_own on public.signalements
  for insert with check (auth.uid() = signaleur_id);

-- Pas de update/delete pour les users — seul l'admin modifie le statut
-- via le Dashboard Supabase (service_role).

-- ── 3. Colonnes users (si absentes) ────────────────────────────────────────

alter table public.users
  add column if not exists nb_signalements int not null default 0;

alter table public.users
  add column if not exists score_abus int not null default 0;

-- ── 4. RPC submit_report ───────────────────────────────────────────────────
-- Création sécurisée d'un signalement. Vérifie :
--   - L'user est authentifié
--   - L'user ne se signale pas lui-même (pour cible_signalement = 'utilisateur')
--   - La cible existe
--   - Pas de doublon

create or replace function public.submit_report(
  p_target_type cible_signalement,
  p_target_id uuid,
  p_motif text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exists boolean;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Anti-auto-signalement (cible utilisateur)
  if p_target_type = 'utilisateur' and p_target_id = v_uid then
    return jsonb_build_object('success', false, 'error', 'cannot_report_self');
  end if;

  -- Vérifier que la cible existe
  if p_target_type = 'annonce' then
    select exists(select 1 from public.annonces where id = p_target_id) into v_exists;
  elsif p_target_type = 'utilisateur' then
    select exists(select 1 from public.users where id = p_target_id) into v_exists;
  elsif p_target_type = 'message' then
    select exists(select 1 from public.messages where id = p_target_id) into v_exists;
  end if;

  if not v_exists then
    return jsonb_build_object('success', false, 'error', 'target_not_found');
  end if;

  -- Insert (le UNIQUE constraint gère le doublon)
  begin
    insert into public.signalements (target_type, target_id, signaleur_id, motif, description)
    values (p_target_type, p_target_id, v_uid, p_motif, p_description);
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'error', 'already_reported');
  end;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.submit_report(cible_signalement, uuid, text, text) from public;
grant execute on function public.submit_report(cible_signalement, uuid, text, text) to authenticated;

-- ── 5. Trigger auto-suspension ─────────────────────────────────────────────
-- Quand un signalement passe à 'traite' (par l'admin via Dashboard),
-- incrémente score_abus sur le user ciblé. Si ≥ 3 en 30 jours → suspension.
--
-- Note : ce trigger fire quand l'admin UPDATE le statut du signalement.
-- Il ne fire PAS à la création (statut = 'en_attente' par défaut).

create or replace function public.fn_signalement_check_threshold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user_id uuid;
  v_count_30d int;
begin
  -- Ne fire que quand le statut passe à 'traite'
  if NEW.statut != 'traite' or OLD.statut = 'traite' then
    return NEW;
  end if;

  -- Déterminer le user ciblé
  if NEW.target_type = 'utilisateur' then
    v_target_user_id := NEW.target_id;
  elsif NEW.target_type = 'annonce' then
    select vendeur_id into v_target_user_id
    from public.annonces where id = NEW.target_id;
  elsif NEW.target_type = 'message' then
    select expediteur_id into v_target_user_id
    from public.messages where id = NEW.target_id;
  end if;

  if v_target_user_id is null then
    return NEW;
  end if;

  -- Incrémenter score_abus + nb_signalements
  update public.users
  set score_abus = score_abus + 1,
      nb_signalements = nb_signalements + 1
  where id = v_target_user_id;

  -- Compter les signalements confirmés sur ce user dans les 30 derniers jours
  select count(*) into v_count_30d
  from public.signalements s
  where s.statut = 'traite'
    and s.updated_at > now() - interval '30 days'
    and (
      (s.target_type = 'utilisateur' and s.target_id = v_target_user_id)
      or (s.target_type = 'annonce' and s.target_id in (
        select id from public.annonces where vendeur_id = v_target_user_id
      ))
      or (s.target_type = 'message' and s.target_id in (
        select id from public.messages where expediteur_id = v_target_user_id
      ))
    );

  -- Auto-suspension si ≥ 3 signalements confirmés en 30j
  if v_count_30d >= 3 then
    update public.users
    set is_active = false
    where id = v_target_user_id
      and is_active = true;
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_signalement_check_threshold on public.signalements;
create trigger tg_signalement_check_threshold
  after update on public.signalements
  for each row
  execute function public.fn_signalement_check_threshold();
