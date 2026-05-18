-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 19 — Table favoris (annonces sauvegardées par les utilisateurs)
--
-- Relation N:N users ↔ annonces. Un user peut sauvegarder une annonce,
-- la retirer, et la re-sauvegarder. Pas de doublon (UNIQUE constraint).
--
-- Prérequis : migration 01 (users), migration 15 (annonces).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.favoris (
  id          uuid        primary key default uuid_generate_v4(),
  user_id     uuid        not null references public.users(id) on delete cascade,
  annonce_id  uuid        not null references public.annonces(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, annonce_id)
);

-- Index pour lister les favoris d'un user (profil → mes favoris)
create index if not exists idx_favoris_user
  on public.favoris (user_id, created_at desc);

-- Index pour compter les favoris d'une annonce (stats vendeur, tri futur)
create index if not exists idx_favoris_annonce
  on public.favoris (annonce_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.favoris enable row level security;

-- Lecture : un user ne voit que ses propres favoris
drop policy if exists favoris_select_own on public.favoris;
create policy favoris_select_own on public.favoris
  for select using (auth.uid() = user_id);

-- Insertion : un user ne peut ajouter que pour lui-même
drop policy if exists favoris_insert_own on public.favoris;
create policy favoris_insert_own on public.favoris
  for insert with check (auth.uid() = user_id);

-- Suppression : un user ne peut retirer que ses propres favoris
drop policy if exists favoris_delete_own on public.favoris;
create policy favoris_delete_own on public.favoris
  for delete using (auth.uid() = user_id);
