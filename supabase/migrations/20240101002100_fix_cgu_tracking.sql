-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 21 — Fix traçabilité CGU auth (signup email + OAuth)
--
-- Problèmes corrigés :
--   1. cgu_accepted_at posé avec timestamp CLIENT (falsifiable) au lieu de
--      serveur → maintenant toujours now() côté DB
--   2. OAuth : le fire-and-forget `void supabase.update` ne s'exécutait pas
--      (thenable non-consommé) → maintenant via RPC await
--   3. cgu_version hardcodé "1.0" côté client → maintenant passé en param
--      depuis LEGAL_LAST_UPDATED (lib/legal.ts)
--
-- Solution : RPC `accept_auth_cgu(p_version text)` SECURITY DEFINER qui
-- pose cgu_accepted_at = now() (serveur) + cgu_version = param.
-- Idempotent (ne re-écrase pas si déjà posé).
--
-- Backfill : les users existants avec cgu_accepted_at NULL mais is_active = true
-- ont de facto accepté les CGU (sinon ils n'auraient pas pu créer leur compte).
-- On les backfille avec la date de création du compte + version "1.0".
--
-- Prérequis : migration 08 (colonnes cgu_accepted_at, cgu_version).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. RPC pour enregistrer le consentement auth CGU
create or replace function public.accept_auth_cgu(p_version text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Idempotent : ne met à jour que si pas encore accepté
  update public.users
  set cgu_accepted_at = now(),
      cgu_version = p_version
  where id = auth.uid()
    and cgu_accepted_at is null;
end;
$$;

revoke all on function public.accept_auth_cgu(text) from public;
grant execute on function public.accept_auth_cgu(text) to authenticated;

-- 2. Fix trigger handle_new_user — cgu_accepted_at = now() serveur
--    (avant : timestamp client via raw_user_meta_data, falsifiable)
--    On garde cgu_version depuis metadata (le client envoie LEGAL_LAST_UPDATED).
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
    -- Timestamp SERVEUR (now()), pas client — preuve légale non-falsifiable
    case when NEW.raw_user_meta_data->>'cgu_accepted_at' is not null
      then now()
      else null
    end,
    NEW.raw_user_meta_data->>'cgu_version'
  );
  return NEW;
end;
$$;

-- 3. Backfill : users existants actifs sans cgu_accepted_at
-- On pose created_at comme date d'acceptation (meilleure approximation)
-- et "1.0" comme version (la seule qui existait avant ce fix).
update public.users
set cgu_accepted_at = created_at,
    cgu_version = '1.0'
where cgu_accepted_at is null
  and is_active = true;

-- 3. Backfill cgu_sell_accepted_at pour les vendeurs existants
-- Users qui ont des annonces mais pas de cgu_sell_accepted_at
update public.users u
set cgu_sell_accepted_at = (
  select min(a.created_at)
  from public.annonces a
  where a.vendeur_id = u.id
)
where u.cgu_sell_accepted_at is null
  and exists (select 1 from public.annonces a where a.vendeur_id = u.id);
