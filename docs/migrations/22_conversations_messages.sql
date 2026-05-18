-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 22 — Conversations + Messages (messagerie acheteur ↔ vendeur)
--
-- Source : docs/niqo_schema_v1.6.sql §conversations (lignes 186-197)
--          + §messages (lignes 206-217)
--
-- 1 conversation = 1 annonce × 1 acheteur. Le vendeur est déduit de l'annonce.
-- Messages texte uniquement pour le MVP (type='texte'). Images/offres en Phase 2.
--
-- Composants :
--   1. Enums statut_conv + type_message
--   2. Table conversations + indexes + RLS
--   3. Table messages + indexes + RLS
--   4. Trigger update_conversation_last_message (dénormalisation preview)
--   5. RPC get_or_create_conversation (idempotent, anti-race-condition)
--   6. RPC mark_messages_read (batch update is_read)
--
-- Prérequis : migrations 01 (users), 15 (annonces).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enums ────────────────────────────────────────────────────────────────

do $$ begin
  create type statut_conv as enum ('ouverte', 'en_transaction', 'fermee');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type type_message as enum ('texte', 'offre_prix', 'systeme', 'image');
exception
  when duplicate_object then null;
end $$;

-- ── 2. Table conversations ─────────────────────────────────────────────────

create table if not exists public.conversations (
  id                    uuid         primary key default uuid_generate_v4(),
  annonce_id            uuid         not null references public.annonces(id) on delete cascade,
  acheteur_id           uuid         not null references public.users(id),
  vendeur_id            uuid         not null references public.users(id),
  statut                statut_conv  not null default 'ouverte',
  last_message_preview  text,
  last_message_at       timestamptz,
  created_at            timestamptz  not null default now(),

  constraint conversations_unique unique (annonce_id, acheteur_id)
);

-- Indexes
create index if not exists idx_conversations_acheteur
  on public.conversations (acheteur_id, last_message_at desc nulls last);

create index if not exists idx_conversations_vendeur
  on public.conversations (vendeur_id, last_message_at desc nulls last);

create index if not exists idx_conversations_annonce
  on public.conversations (annonce_id);

-- RLS
alter table public.conversations enable row level security;

-- Lecture : seuls les participants voient leurs conversations
drop policy if exists conversations_select_participants on public.conversations;
create policy conversations_select_participants on public.conversations
  for select using (auth.uid() = acheteur_id or auth.uid() = vendeur_id);

-- Insertion : seul l'acheteur crée une conversation (via RPC, mais policy
-- nécessaire pour le fallback PostgREST)
drop policy if exists conversations_insert_buyer on public.conversations;
create policy conversations_insert_buyer on public.conversations
  for insert with check (auth.uid() = acheteur_id);

-- Update : participants (pour le trigger last_message + futur changement statut)
drop policy if exists conversations_update_participants on public.conversations;
create policy conversations_update_participants on public.conversations
  for update using (auth.uid() = acheteur_id or auth.uid() = vendeur_id);

-- ── 3. Table messages ───────────────────────────────────────────────────────

create table if not exists public.messages (
  id               uuid          primary key default uuid_generate_v4(),
  conversation_id  uuid          not null references public.conversations(id) on delete cascade,
  expediteur_id    uuid          not null references public.users(id),
  contenu          text          not null check (char_length(contenu) > 0),
  type             type_message  not null default 'texte',
  offre_montant    numeric(12,0) check (offre_montant > 0),
  is_read          boolean       not null default false,
  is_deleted       boolean       not null default false,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

-- Check : contenu max 2000 chars (anti-spam, cohérent avec description annonce)
alter table public.messages
  drop constraint if exists messages_contenu_max;
alter table public.messages
  add constraint messages_contenu_max
  check (char_length(contenu) <= 2000);

-- Indexes
create index if not exists idx_messages_conversation
  on public.messages (conversation_id, created_at desc);

create index if not exists idx_messages_unread
  on public.messages (conversation_id, expediteur_id)
  where is_read = false;

-- Trigger set_updated_at (réutilise la fonction commune migration 10)
drop trigger if exists set_messages_updated_at on public.messages;
create trigger set_messages_updated_at
  before update on public.messages
  for each row
  execute function public.set_updated_at();

-- RLS
alter table public.messages enable row level security;

-- Lecture : seuls les participants de la conversation voient les messages
drop policy if exists messages_select_participants on public.messages;
create policy messages_select_participants on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.acheteur_id or auth.uid() = c.vendeur_id)
    )
  );

-- Insertion : participant + expediteur = soi-même
drop policy if exists messages_insert_participants on public.messages;
create policy messages_insert_participants on public.messages
  for insert with check (
    auth.uid() = expediteur_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.acheteur_id or auth.uid() = c.vendeur_id)
    )
  );

-- Update : participant (pour mark_as_read)
drop policy if exists messages_update_participants on public.messages;
create policy messages_update_participants on public.messages
  for update using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (auth.uid() = c.acheteur_id or auth.uid() = c.vendeur_id)
    )
  );

-- ── 4. Trigger : dénormaliser last_message sur conversations ────────────────

create or replace function public.fn_update_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_preview = left(NEW.contenu, 100),
      last_message_at = NEW.created_at
  where id = NEW.conversation_id;

  return NEW;
end;
$$;

drop trigger if exists tg_conversation_last_message on public.messages;
create trigger tg_conversation_last_message
  after insert on public.messages
  for each row
  execute function public.fn_update_conversation_last_message();

-- ── 5. RPC get_or_create_conversation ───────────────────────────────────────
-- Idempotent : retourne la conversation existante ou en crée une nouvelle.
-- Le vendeur_id est déduit de l'annonce (pas en paramètre — anti-triche).
-- Empêche un vendeur de se messager lui-même.

create or replace function public.get_or_create_conversation(p_annonce_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_vendeur_id uuid;
  v_statut     statut_annonce;
  v_conv       public.conversations%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Récupère le vendeur et le statut de l'annonce
  select vendeur_id, statut into v_vendeur_id, v_statut
  from public.annonces
  where id = p_annonce_id;

  if v_vendeur_id is null then
    return jsonb_build_object('success', false, 'error', 'annonce_not_found');
  end if;

  if v_uid = v_vendeur_id then
    return jsonb_build_object('success', false, 'error', 'cannot_message_self');
  end if;

  if v_statut not in ('active', 'en_cours') then
    return jsonb_build_object('success', false, 'error', 'annonce_not_available');
  end if;

  -- Get or create (idempotent)
  insert into public.conversations (annonce_id, acheteur_id, vendeur_id)
  values (p_annonce_id, v_uid, v_vendeur_id)
  on conflict (annonce_id, acheteur_id) do nothing;

  select * into v_conv
  from public.conversations
  where annonce_id = p_annonce_id
    and acheteur_id = v_uid;

  return jsonb_build_object(
    'success', true,
    'conversation', jsonb_build_object(
      'id', v_conv.id,
      'annonce_id', v_conv.annonce_id,
      'acheteur_id', v_conv.acheteur_id,
      'vendeur_id', v_conv.vendeur_id,
      'statut', v_conv.statut,
      'created_at', v_conv.created_at
    )
  );
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- ── 6. RPC mark_messages_read ───────────────────────────────────────────────
-- Marque tous les messages non-lus d'une conversation comme lus, sauf ceux
-- envoyés par l'user lui-même (on ne marque pas ses propres messages).

create or replace function public.mark_messages_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Vérifie que l'user est participant
  if not exists (
    select 1 from public.conversations
    where id = p_conversation_id
      and (auth.uid() = acheteur_id or auth.uid() = vendeur_id)
  ) then
    raise exception 'not_participant';
  end if;

  update public.messages
  set is_read = true,
      updated_at = now()
  where conversation_id = p_conversation_id
    and expediteur_id != auth.uid()
    and is_read = false;
end;
$$;

revoke all on function public.mark_messages_read(uuid) from public;
grant execute on function public.mark_messages_read(uuid) to authenticated;

-- ── 7. Enable Realtime on messages ──────────────────────────────────────────
-- Supabase Realtime doit être activé sur la table messages pour que les
-- abonnements client fonctionnent. Les RLS policies filtrent automatiquement
-- les events par participant.

alter publication supabase_realtime add table public.messages;
