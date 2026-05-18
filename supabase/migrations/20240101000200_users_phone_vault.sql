-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 02 — Téléphone chiffré via Supabase Vault (RGPD)
--
-- Remplace `telephone_enc text` (clair) par `telephone bytea` (chiffré AES-256
-- via pgp_sym_encrypt avec une clé stockée dans le Vault Supabase).
--
-- Ajoute aussi les champs collectés au signup : ville (déjà existante mais
-- collectée pour de vrai maintenant) + quartier (nullable, mais important).
--
-- ⚠ Cette migration MODIFIE :
--   - Drop colonne `telephone_enc text` → recreate `telephone bytea`
--   - Création clé d'encryption dans vault.secrets (one-shot)
--   - Helpers public.encrypt_phone() / public.decrypt_phone()
--   - RPC public.get_my_phone() pour read auth.uid()-only
--   - Mise à jour du trigger handle_new_user() pour encrypter au signup
--
-- À jouer dans Supabase SQL Editor APRÈS 01_users.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enable Vault extension (idempotent) ──────────────────────────────────
-- Vault Supabase = pgsodium under the hood. Stocke des secrets app
-- (encryption keys) chiffrés au repos. La clé ne quitte JAMAIS Postgres.

create extension if not exists supabase_vault with schema vault;

-- ── 2. Création de la clé d'encryption (one-shot, idempotent) ───────────────
-- Génère une clé symétrique aléatoire 256-bit base64 et l'insère dans
-- vault.secrets. Si déjà présente, ne fait rien.

do $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'phone_encryption_key';
  if existing is null then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'phone_encryption_key',
      'Symmetric AES-256 key for users.telephone (RGPD CI loi 2024-30, CG loi 2023-15)'
    );
  end if;
end $$;

-- ── 3. Schema migration — telephone_enc text → telephone bytea ──────────────

alter table public.users drop column if exists telephone_enc;
alter table public.users add column if not exists telephone bytea;

-- ── 4. Helper functions encrypt / decrypt ──────────────────────────────────
-- SECURITY DEFINER pour bypass la RLS sur vault.decrypted_secrets.
-- pgp_sym_encrypt utilise AES-256 sous le hood (cf. pgcrypto docs).
-- search_path explicite pour empêcher les attaques par injection de schéma.

create or replace function public.encrypt_phone(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  key text;
begin
  if plaintext is null or plaintext = '' then return null; end if;
  select decrypted_secret into key
    from vault.decrypted_secrets
    where name = 'phone_encryption_key'
    limit 1;
  if key is null then
    raise exception 'phone_encryption_key absente du Vault — relancer la migration 02';
  end if;
  return pgp_sym_encrypt(plaintext, key);
end;
$$;

create or replace function public.decrypt_phone(ciphertext bytea)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  key text;
begin
  if ciphertext is null then return null; end if;
  select decrypted_secret into key
    from vault.decrypted_secrets
    where name = 'phone_encryption_key'
    limit 1;
  if key is null then return null; end if;
  return pgp_sym_decrypt(ciphertext, key);
end;
$$;

revoke all on function public.encrypt_phone(text) from public;
revoke all on function public.decrypt_phone(bytea) from public;
-- Ces helpers sont des primitives privées, accessibles uniquement aux autres
-- functions SECURITY DEFINER (trigger, RPC).

-- ── 5. RPC get_my_phone — read decrypted self ──────────────────────────────
-- Le seul moyen pour un user de lire SON propre téléphone décrypté.
-- La colonne `telephone` (bytea) est lisible via PostgREST mais retourne du
-- bytea — useless pour qui n'a pas la clé. Cette RPC checke auth.uid().

create or replace function public.get_my_phone()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  enc bytea;
begin
  select telephone into enc from public.users where id = auth.uid();
  return public.decrypt_phone(enc);
end;
$$;

revoke all on function public.get_my_phone() from public;
grant execute on function public.get_my_phone() to authenticated;

-- ── 6. Trigger handle_new_user updated ─────────────────────────────────────
-- Ajoute encryption phone + lecture quartier depuis metadata.
-- prenom/nom/pays/ville/auth_provider inchangés.
-- Le ville fallback capital reste comme garde-fou défensif au cas où le form
-- ne pousse pas la valeur.

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
      'email'
    )
  );
  return NEW;
end;
$$;

-- Trigger lui-même créé en 01_users.sql, pas besoin de le recréer.
