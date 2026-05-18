-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 08 — Consentement CGU / politique de confidentialité
--
-- Ajoute cgu_accepted_at + cgu_version à public.users pour traçabilité RGPD
-- (CI Loi 2024-30, CG Loi 2023-15, RW Loi 2021-058).
--
-- Email signup : cgu_accepted_at est poussé dans raw_user_meta_data côté
--   client (app/auth/email.tsx) → handle_new_user le copie au INSERT.
-- OAuth (Google/Apple) : le trigger ne peut pas le lire (Supabase l'écrase
--   avec les claims provider). L'AuthProvider met à jour la colonne après
--   handleSession si cgu_accepted_at IS NULL (premier login OAuth).
--
-- À jouer dans Supabase SQL Editor APRÈS 07_repair_my_profile.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Colonnes ─────────────────────────────────────────────────────────────────

alter table public.users
  add column if not exists cgu_accepted_at timestamptz,
  add column if not exists cgu_version     text;

-- ── Trigger handle_new_user — met à jour pour copier le consentement ─────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, prenom, nom, pays, ville, auth_provider, cgu_accepted_at, cgu_version)
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
    ),
    (NEW.raw_user_meta_data->>'cgu_accepted_at')::timestamptz,
    NEW.raw_user_meta_data->>'cgu_version'
  );
  return NEW;
end;
$$;

-- ── repair_my_profile — même mise à jour pour le fallback trigger raté ────────

create or replace function public.repair_my_profile()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_meta jsonb;
  v_pays pays_code;
  v_result json;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select row_to_json(u) into v_result
  from public.users u
  where u.id = v_uid;

  if v_result is not null then
    return v_result;
  end if;

  select raw_user_meta_data into v_meta
  from auth.users
  where id = v_uid;

  v_pays := coalesce((v_meta->>'pays')::pays_code, 'CI');

  insert into public.users (
    id, email,
    prenom, nom,
    telephone,
    pays, ville, quartier,
    auth_provider,
    cgu_accepted_at, cgu_version
  )
  select
    au.id,
    au.email,
    coalesce(v_meta->>'prenom', v_meta->>'given_name', 'Utilisateur'),
    coalesce(v_meta->>'nom',    v_meta->>'family_name', '—'),
    public.encrypt_phone(v_meta->>'telephone'),
    v_pays,
    coalesce(
      v_meta->>'ville',
      case v_pays when 'CG' then 'Brazzaville' else 'Abidjan' end
    ),
    nullif(trim(coalesce(v_meta->>'quartier', '')), ''),
    coalesce(
      (v_meta->>'auth_provider')::auth_provider,
      (au.raw_app_meta_data->>'provider')::auth_provider,
      'email'
    ),
    (v_meta->>'cgu_accepted_at')::timestamptz,
    v_meta->>'cgu_version'
  from auth.users au
  where au.id = v_uid
  on conflict (id) do nothing;

  select row_to_json(u) into v_result
  from public.users u
  where u.id = v_uid;

  return v_result;
end;
$$;

revoke all on function public.repair_my_profile() from public;
grant execute on function public.repair_my_profile() to authenticated;
