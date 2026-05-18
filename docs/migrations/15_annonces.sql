-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 15 — public.annonces + enums + RLS + indexes + triggers
--
-- Source : docs/niqo_schema_v1.6.sql §2 (enums), §3 (table), §4 (indexes),
--          §6 (RLS). Aménagements MVP cf. docs/annonces-todo.md :
--          - Cap prix server-side : 1 500 000 FCFA (CI), 1 000 000 XAF (CG)
--          - RLS : 5 policies (read public + 4 owner-scoped)
--          - Triggers : set_updated_at (réutilise lib commune migration 10),
--            set_expires_at (60j), inherit_pays_from_user
--
-- Prérequis joués : 13 (categories), 14 (storage). public.users existe (01).
--
-- Pourquoi maintenant : annonces est la table-pivot du MVP. Search,
-- messagerie, paiements, avis, litiges en dépendent (FK entrantes à venir).
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enums ─────────────────────────────────────────────────────────────────

do $$ begin
  create type etat_objet as enum ('neuf', 'tres_bon', 'bon', 'moyen');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type statut_annonce as enum (
    'active',     -- visible aux acheteurs, default
    'en_cours',   -- transaction en cours (set par module transactions)
    'vendue',     -- transaction completed (set par module transactions)
    'suspendue',  -- admin only
    'expiree'     -- 60j sans transaction (set par cron expire-annonces, cf. mig 16)
  );
exception
  when duplicate_object then null;
end $$;

-- ── 2. Table public.annonces ─────────────────────────────────────────────────
-- Notes :
--   - prix_negocie : nullable, géré par le module transactions plus tard
--     (prix final accepté par l'acheteur après négociation messagerie)
--   - photos : array de paths Supabase Storage (bucket annonces-photos).
--     Min 1, max 5 enforced par check constraint (cohérent avec
--     MAX_PHOTOS_PER_ANNONCE côté client)
--   - pays : hérité de users.pays par trigger (immuable, segmentation CI/CG)
--   - expires_at : peuplé par trigger set_annonces_expires_at (created_at + 60j)

create table if not exists public.annonces (
  id            uuid           primary key default uuid_generate_v4(),
  vendeur_id    uuid           not null references public.users(id) on delete cascade,
  categorie_id  uuid           not null references public.categories(id),
  titre         text           not null check (char_length(titre) between 3 and 50),
  description   text           not null check (char_length(description) between 10 and 2000),
  prix          numeric(12, 0) not null check (prix > 0),
  prix_negocie  numeric(12, 0) check (prix_negocie > 0),
  photos        text[]         not null default '{}' check (array_length(photos, 1) between 1 and 5),
  etat          etat_objet     not null,
  statut        statut_annonce not null default 'active',
  pays          pays_code      not null,
  ville         text           not null check (char_length(ville) between 2 and 50),
  quartier      text           check (quartier is null or char_length(quartier) between 2 and 50),
  nb_vues       int            not null default 0,
  expires_at    timestamptz    not null,
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now()
);

-- Cap prix server-side par pays (cf. décision produit #1 — plafonds Mobile
-- Money). Empêche un client malveillant de bypass la validation côté wizard.
-- Ajouté en alter pour idempotence (le check ne peut pas être inline avec
-- if-not-exists — on le drop+create au cas où).
alter table public.annonces
  drop constraint if exists annonces_prix_cap_par_pays;

alter table public.annonces
  add constraint annonces_prix_cap_par_pays
  check (
    (pays = 'CI' and prix <= 1500000) or
    (pays = 'CG' and prix <= 1000000)
  );

comment on column public.annonces.expires_at   is 'Calculé à l''INSERT par trigger : created_at + 60 days. Modèle Leboncoin (CDC F03).';
comment on column public.annonces.prix_negocie is 'Prix final après négociation. Null si pas de négociation. Géré par module transactions.';
comment on column public.annonces.pays         is 'Hérité de users.pays par trigger inherit_pays_from_user. Immuable (segmentation CI/CG).';
comment on column public.annonces.ville        is 'Saisi par vendeur, peut différer de users.ville (déménagement, vente d''un objet ailleurs).';
comment on constraint annonces_prix_cap_par_pays on public.annonces is
  'Cap MVP : 1.5M FCFA (CI) / 1M XAF (CG). Sous le plus petit plafond Mobile Money observé. À ajuster Phase 2 selon confirmation PawaPay.';

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
-- Source : spec lignes 366-382 + idx_annonces_vendeur ajouté pour
-- /profile/announces (fetch des annonces d'un vendeur, toutes statuts).

create index if not exists idx_annonces_pays_statut
  on public.annonces (pays)
  where statut = 'active';

create index if not exists idx_annonces_expires_at
  on public.annonces (expires_at)
  where statut = 'active';

create index if not exists idx_annonces_categorie_pays
  on public.annonces (categorie_id, pays, statut);

create index if not exists idx_annonces_localisation
  on public.annonces (pays, ville, quartier, statut);

create index if not exists idx_annonces_vendeur
  on public.annonces (vendeur_id, statut, created_at desc);

-- Index pour le cron purge-expired-annonces (mig 16) : trouve rapidement les
-- annonces expirees au-delà de 28j.
create index if not exists idx_annonces_purge_candidates
  on public.annonces (expires_at)
  where statut = 'expiree';

-- ── 4. Triggers ──────────────────────────────────────────────────────────────

-- 4a. set_updated_at — réutilise la fonction commune (migration 10)
drop trigger if exists set_annonces_updated_at on public.annonces;
create trigger set_annonces_updated_at
  before update on public.annonces
  for each row
  execute function public.set_updated_at();

-- 4b. set_expires_at — calcule expires_at à l'INSERT (60j Leboncoin model)
create or replace function public.set_annonces_expires_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.expires_at is null then
    NEW.expires_at := NEW.created_at + interval '60 days';
  end if;
  return NEW;
end;
$$;

drop trigger if exists set_annonces_expires_at_trigger on public.annonces;
create trigger set_annonces_expires_at_trigger
  before insert on public.annonces
  for each row
  execute function public.set_annonces_expires_at();

-- 4c. inherit_pays_from_user — pays toujours = users.pays, jamais saisi par client
-- Empêche un user CI de poster sur le marché CG ou inversement, même si l'app
-- pousse une valeur incorrecte.
create or replace function public.inherit_annonces_pays_from_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select pays into NEW.pays from public.users where id = NEW.vendeur_id;
  if NEW.pays is null then
    raise exception 'Vendeur introuvable ou pays manquant'
      using hint = 'Le profil vendeur doit exister et avoir un pays défini';
  end if;
  return NEW;
end;
$$;

drop trigger if exists inherit_annonces_pays on public.annonces;
create trigger inherit_annonces_pays
  before insert on public.annonces
  for each row
  execute function public.inherit_annonces_pays_from_user();

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
-- Browse-first : les annonces actives sont visibles aux anonymes. Le vendeur
-- voit aussi ses propres annonces non-actives (expirees, suspendues, vendues)
-- pour les gérer dans /profile/announces.

alter table public.annonces enable row level security;

-- Lecture publique des annonces actives (anon + authenticated)
drop policy if exists annonces_read_active on public.annonces;
create policy annonces_read_active on public.annonces
  for select
  using (statut = 'active');

-- Le vendeur voit ses propres annonces, tous statuts confondus
drop policy if exists annonces_owner_select_own on public.annonces;
create policy annonces_owner_select_own on public.annonces
  for select
  using (auth.uid() = vendeur_id);

-- Insert : authentifié uniquement, et vendeur_id = auth.uid()
drop policy if exists annonces_owner_insert on public.annonces;
create policy annonces_owner_insert on public.annonces
  for insert
  with check (auth.uid() = vendeur_id);

-- Update : owner uniquement, et seulement si statut = 'active' (pas d'edit
-- pendant transaction ou après vente). Le statut lui-même ne peut PAS être
-- modifié via cette policy (les transitions sont gérées par le module
-- transactions et le cron expire-annonces via SECURITY DEFINER functions).
drop policy if exists annonces_owner_update on public.annonces;
create policy annonces_owner_update on public.annonces
  for update
  using (auth.uid() = vendeur_id and statut = 'active')
  with check (auth.uid() = vendeur_id and statut = 'active');

-- Delete : owner uniquement, et statut not in ('en_cours', 'vendue').
-- Empêche la suppression d'une annonce avec une transaction en cours
-- (préserve l'intégrité quand FK transactions arrive).
drop policy if exists annonces_owner_delete on public.annonces;
create policy annonces_owner_delete on public.annonces
  for delete
  using (
    auth.uid() = vendeur_id
    and statut in ('active', 'expiree', 'suspendue')
  );
