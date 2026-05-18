-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 05 — Fix auth_provider pour les comptes OAuth (Google / Apple)
--
-- BUG : le trigger handle_new_user() (migration 02) lisait UNIQUEMENT
--   raw_user_meta_data->>'auth_provider'
-- → côté email c'est explicitement poussé par app/auth/email.tsx
-- → côté OAuth c'est ABSENT (Supabase ne le copie pas dans raw_user_meta_data)
-- → tous les users Google/Apple finissaient avec auth_provider = 'email'
--   à cause du fallback COALESCE.
--
-- FIX : ajouter raw_app_meta_data->>'provider' comme deuxième source. Cette
-- clé est écrite par Supabase Auth lui-même au moment du SIGN_IN OAuth, et
-- contient exactement 'google' / 'apple' / 'email' — match direct l'enum.
--
-- Ordre de coalesce :
--   1. raw_user_meta_data->>'auth_provider'    (autoritatif — poussé par client email)
--   2. raw_app_meta_data->>'provider'          (autoritatif — écrit par Supabase OAuth)
--   3. 'email'                                  (garde-fou défensif)
--
-- ⚠ Cette migration :
--   - CREATE OR REPLACE handle_new_user() (idempotent, non destructif)
--   - BACKFILL des rows existants où le stockage diverge du vrai provider OAuth
--
-- À jouer dans Supabase SQL Editor APRÈS 04_users_purge_suspended_cron.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigger handle_new_user — version corrigée ───────────────────────────
-- Body identique à migration 02 SAUF la ligne auth_provider (3 sources au lieu
-- de 2). Le reste (encrypt_phone, fallbacks ville, etc.) est inchangé.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id, email,
    prenom, nom,
    telephone,
    pays, ville, quartier,
    auth_provider
  )
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
    public.encrypt_phone(NEW.raw_user_meta_data->>'telephone'),
    coalesce((NEW.raw_user_meta_data->>'pays')::pays_code, 'CI'),
    coalesce(
      NEW.raw_user_meta_data->>'ville',
      case (NEW.raw_user_meta_data->>'pays')::pays_code
        when 'CG' then 'Brazzaville'
        else 'Abidjan'
      end
    ),
    NEW.raw_user_meta_data->>'quartier',
    coalesce(
      (NEW.raw_user_meta_data->>'auth_provider')::auth_provider,
      (NEW.raw_app_meta_data->>'provider')::auth_provider,
      'email'
    )
  );
  return NEW;
end;
$$;

-- ── 2. Backfill des rows existants ──────────────────────────────────────────
-- Update uniquement les rows où :
--   - auth.users.raw_app_meta_data->>'provider' est défini ET valide
--   - et la valeur stockée dans public.users diverge
-- Idempotent : si déjà bon, le WHERE filtre la row hors de l'UPDATE.
--
-- Cast guard : on ne touche que les valeurs ∈ ('google','apple','email') pour
-- éviter une exception si Supabase ajoute un nouveau provider à l'avenir
-- (ex: 'azure', 'github') qu'on n'aurait pas encore ajouté à l'enum.

update public.users u
set auth_provider = (au.raw_app_meta_data->>'provider')::auth_provider,
    updated_at    = now()
from auth.users au
where au.id = u.id
  and au.raw_app_meta_data->>'provider' in ('google', 'apple', 'email')
  and (au.raw_app_meta_data->>'provider')::auth_provider <> u.auth_provider;

-- ── 3. Vérification — à exécuter manuellement après la migration ────────────
-- Confirme que public.users.auth_provider == auth.users.raw_app_meta_data->>'provider'
-- pour tous les comptes OAuth.
--
--   select u.email,
--          u.auth_provider as stored,
--          au.raw_app_meta_data->>'provider' as actual,
--          case when u.auth_provider::text = au.raw_app_meta_data->>'provider'
--               then 'OK' else 'MISMATCH' end as status
--   from public.users u
--   join auth.users au on au.id = u.id
--   order by u.created_at desc;
