-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 01 — public.users + dépendances minimum pour l'auth
--
-- Source : extrait de docs/niqo_schema_v1.6.sql §2 (enums), §3 (table users),
--          §6 (RLS users_own_profile). Trigger handle_new_user = NOUVEAU.
--
-- À jouer dans Supabase SQL Editor APRÈS création du projet.
-- Convention : migrations numérotées NN_feature.sql, créées au fur et à
-- mesure que les features arrivent. Ne PAS jouer niqo_schema_v1.6.sql en bloc.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enums ────────────────────────────────────────────────────────────────────
-- Postgres ne supporte pas CREATE TYPE IF NOT EXISTS avant v14. On wrap dans
-- un DO block qui catch duplicate_object → idempotent en dev (drop → re-run OK).

do $$ begin
  create type pays_code as enum ('CI', 'CG');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type auth_provider as enum ('google', 'apple', 'email');
exception
  when duplicate_object then null;
end $$;

-- ── Table public.users ───────────────────────────────────────────────────────
-- Étend auth.users (built-in Supabase) avec les données app-specific.
-- FK avec ON DELETE CASCADE : si l'auth user est supprimé, le profil aussi.

create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  prenom          text not null,
  nom             text not null,
  telephone_enc   text,                                                     -- chiffré via Supabase Vault (RGPD)
  pays            pays_code not null,
  ville           text not null,
  quartier        text,
  auth_provider   auth_provider not null default 'email',
  note_vendeur    numeric(3,2) default 0 check (note_vendeur between 0 and 5),
  note_acheteur   numeric(3,2) default 0 check (note_acheteur between 0 and 5),
  nb_ventes       int default 0,
  nb_achats       int default 0,
  score_abus      int default 0,                                            -- auto-suspend à >=3 (trigger ajouté en migration 07)
  avatar_url      text,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── RLS — chaque user voit / modifie uniquement son propre profil ────────────
-- Les vues publiques (vendeur sur card annonce) passeront par une RPC
-- restreinte ajoutée plus tard avec la migration annonces.

alter table public.users enable row level security;

drop policy if exists users_own_profile on public.users;
create policy users_own_profile on public.users
  for all using (auth.uid() = id);

-- ── Trigger handle_new_user — auto-création du profil au signup ──────────────
-- Atomic avec l'INSERT auth.users. SECURITY DEFINER pour bypass la policy
-- (chicken-and-egg : le user n'a pas encore de row à laquelle se référer
-- via auth.uid()).
--
-- Source des données :
--   - email / id : depuis NEW (auth.users)
--   - prenom / nom : depuis raw_user_meta_data
--       → email signup : on push 'prenom', 'nom' dans options.data
--       → Google : claims 'given_name', 'family_name'
--       → Apple : 'name' (1ère auth seulement, sinon fallback)
--   - pays : 'pays' qu'on pousse dans options.data depuis AsyncStorage
--   - ville : prefill capital pays (Abidjan / Brazzaville), à raffiner /profile
--   - auth_provider : 'auth_provider' qu'on pousse OU défaut 'email'

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, prenom, nom, pays, ville, auth_provider)
  values (
    NEW.id,
    NEW.email,
    coalesce(
      NEW.raw_user_meta_data->>'prenom',
      NEW.raw_user_meta_data->>'given_name',
      'Utilisateur'
    ),
    coalesce(
      NEW.raw_user_meta_data->>'nom',
      NEW.raw_user_meta_data->>'family_name',
      '—'
    ),
    coalesce(
      (NEW.raw_user_meta_data->>'pays')::pays_code,
      'CI'
    ),
    coalesce(
      NEW.raw_user_meta_data->>'ville',
      case (NEW.raw_user_meta_data->>'pays')::pays_code
        when 'CG' then 'Brazzaville'
        else 'Abidjan'
      end
    ),
    coalesce(
      (NEW.raw_user_meta_data->>'auth_provider')::auth_provider,
      'email'
    )
  );
  return NEW;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
