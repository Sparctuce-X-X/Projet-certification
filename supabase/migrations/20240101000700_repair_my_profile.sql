-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 07 — RPC public.repair_my_profile()
--
-- Fallback client-side si le trigger handle_new_user a raté au signup :
-- auth.users existe mais public.users est absent. L'AuthProvider appelle
-- cette RPC automatiquement avant de déconnecter l'user.
--
-- Reproduit exactement la logique de handle_new_user() :
--   - Lit raw_user_meta_data depuis auth.users (SECURITY DEFINER)
--   - Appelle encrypt_phone() si telephone présent dans les métadonnées
--   - INSERT ... ON CONFLICT DO NOTHING (idempotent — safe si row existe déjà)
--   - Retourne le profil (créé ou déjà existant) sous forme JSON
--
-- Pour un email signup : telephone = issu de raw_user_meta_data → has_phone true
-- Pour un OAuth : telephone absent → has_phone false → needsProfileCompletion
--   → l'user passe par /auth/complete-profile (flow normal OAuth)
--
-- À jouer dans Supabase SQL Editor APRÈS 06_complete_my_profile_rpc.sql.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Si le profil existe déjà, le retourner directement (idempotent).
  select row_to_json(u) into v_result
  from public.users u
  where u.id = v_uid;

  if v_result is not null then
    return v_result;
  end if;

  -- Lit les métadonnées depuis auth.users (inaccessible en RLS normale).
  select raw_user_meta_data into v_meta
  from auth.users
  where id = v_uid;

  v_pays := coalesce((v_meta->>'pays')::pays_code, 'CI');

  -- Reproduit handle_new_user() — encrypt_phone() retourne null si le champ
  -- est absent (cas OAuth), ce qui laisse telephone = null → has_phone false.
  insert into public.users (
    id, email,
    prenom, nom,
    telephone,
    pays, ville, quartier,
    auth_provider
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
    )
  from auth.users au
  where au.id = v_uid
  on conflict (id) do nothing;

  -- Retourne le profil nouvellement créé.
  select row_to_json(u) into v_result
  from public.users u
  where u.id = v_uid;

  return v_result;
end;
$$;

revoke all on function public.repair_my_profile() from public;
grant execute on function public.repair_my_profile() to authenticated;
