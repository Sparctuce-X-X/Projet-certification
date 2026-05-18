-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 81 — Fix régression `handle_new_user` (telephone + quartier + OAuth fallback)
--
-- 2 bugs détectés par les tests pgTAP module Auth (mai 2026, cf.
-- docs/backend/auth.md §Tests + tests/sql/auth.test.sql) :
--
--   A. `telephone` et `quartier` perdus depuis mig 08
--      ─────────────────────────────────────────────
--      La mig 02 avait ajouté `telephone` (chiffré Vault) + `quartier` au
--      INSERT du trigger. La mig 08 (CGU consent) a refondu le trigger SANS
--      réintégrer ces deux colonnes. La mig 21 (fix CGU server timestamp) a
--      figé cette régression.
--
--      Conséquence : tout signup email pousse `telephone` dans
--      raw_user_meta_data → le trigger l'ignore → `public.users.telephone`
--      reste null → l'app affiche `has_phone = false` → user forcé sur
--      /auth/complete-profile pour resaisir un téléphone déjà saisi.
--
--   B. Fallback OAuth `raw_app_meta_data->>'provider'` perdu depuis mig 08
--      ──────────────────────────────────────────────────────────────────
--      La mig 05 avait ajouté ce coalesce comme deuxième source pour
--      auth_provider (Supabase écrit `provider` dans raw_app_meta_data au
--      SIGN_IN OAuth, pas dans raw_user_meta_data). La mig 08+21 ont perdu
--      cette ligne.
--
--      Conséquence : tous les users OAuth (Google/Apple) signed up depuis
--      mig 08 ont `auth_provider = 'email'` dans public.users alors que
--      auth.users.raw_app_meta_data->>'provider' dit 'google' ou 'apple'.
--      Bug silencieux UX (le client ne lit pas la colonne) mais pollue les
--      KPIs admin (signup mix par provider) et l'audit RGPD.
--
-- Fix :
--   1. Refonte handle_new_user avec les 2 colonnes + le coalesce OAuth
--      (= mig 02 + mig 05 + mig 08 + mig 21 réconciliés)
--   2. Backfill telephone : chiffre depuis raw_user_meta_data pour rows null
--   3. Backfill auth_provider : update depuis raw_app_meta_data->>'provider'
--      pour les rows divergentes (idem mig 05 mais re-rejouable)
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + §Backend ownership.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Refonte handle_new_user — version réconciliée ────────────────────────

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
    auth_provider,
    cgu_accepted_at, cgu_version
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
    -- Vault encrypt — null-safe (encrypt_phone retourne null si input vide)
    public.encrypt_phone(NEW.raw_user_meta_data->>'telephone'),
    coalesce((NEW.raw_user_meta_data->>'pays')::pays_code, 'CI'),
    coalesce(
      NEW.raw_user_meta_data->>'ville',
      case (NEW.raw_user_meta_data->>'pays')::pays_code
        when 'CG' then 'Brazzaville'
        else 'Abidjan'
      end
    ),
    nullif(trim(coalesce(NEW.raw_user_meta_data->>'quartier', '')), ''),
    coalesce(
      (NEW.raw_user_meta_data->>'auth_provider')::auth_provider,
      (NEW.raw_app_meta_data->>'provider')::auth_provider,
      'email'
    ),
    -- Timestamp SERVEUR (mig 21) si meta présente, sinon null pour OAuth
    -- (sera posé par AuthProvider.handleSession via accept_auth_cgu)
    case when NEW.raw_user_meta_data->>'cgu_accepted_at' is not null
      then now()
      else null
    end,
    NEW.raw_user_meta_data->>'cgu_version'
  );
  return NEW;
end;
$$;

-- ── 2. Backfill telephone — pour les users email signupés sans encryption ───
-- Update uniquement les rows où :
--   - public.users.telephone IS NULL
--   - auth.users.raw_user_meta_data->>'telephone' IS NOT NULL
-- → chiffre via encrypt_phone() et persiste
-- Idempotent : à la 2e exécution, telephone n'est plus null donc filtré

update public.users u
   set telephone  = public.encrypt_phone(au.raw_user_meta_data->>'telephone'),
       updated_at = now()
  from auth.users au
 where au.id = u.id
   and u.telephone is null
   and au.raw_user_meta_data->>'telephone' is not null
   and length(trim(au.raw_user_meta_data->>'telephone')) > 0;

-- ── 3. Backfill quartier — pareil pour les rows null avec meta présente ─────

update public.users u
   set quartier   = nullif(trim(au.raw_user_meta_data->>'quartier'), ''),
       updated_at = now()
  from auth.users au
 where au.id = u.id
   and u.quartier is null
   and nullif(trim(coalesce(au.raw_user_meta_data->>'quartier', '')), '') is not null;

-- ── 4. Backfill auth_provider — same as mig 05 (re-rejouable) ───────────────
-- Pour les users où public.users.auth_provider diverge de
-- auth.users.raw_app_meta_data->>'provider' (cas OAuth depuis mig 08).
-- Cast guard : seulement valeurs ∈ enum (google/apple/email).

update public.users u
   set auth_provider = (au.raw_app_meta_data->>'provider')::auth_provider,
       updated_at    = now()
  from auth.users au
 where au.id = u.id
   and au.raw_app_meta_data->>'provider' in ('google', 'apple', 'email')
   and (au.raw_app_meta_data->>'provider')::auth_provider <> u.auth_provider;
