-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 84 — UNIQUE telephone (anti-fraude multi-comptes)
--
-- Pourquoi :
--   `users.telephone` est `bytea` chiffré via pgp_sym_encrypt (mig 02). Le
--   chiffrement est NON déterministe → on ne peut pas mettre un UNIQUE direct
--   sur la colonne (chaque encrypt même plaintext donne un ciphertext différent).
--
--   Sans contrainte d'unicité, un même numéro peut être enregistré sur N
--   comptes — vecteur de fraude (création de faux comptes pour:
--   contourner suspension, gonfler nb_signalements, accumuler boosts/avis).
--
-- Stratégie :
--   1. Colonne `telephone_hash bytea` = HMAC-SHA256(plaintext, clé Vault
--      existante). Déterministe → indexable, non-réversible (même attaque
--      brute-force est limitée par le HMAC keyed).
--   2. UNIQUE INDEX partiel `WHERE telephone_hash IS NOT NULL` (les comptes
--      OAuth sans téléphone restent autorisés à coexister).
--   3. Helper `public.hash_phone(text) returns bytea` SECURITY DEFINER.
--   4. Trigger handle_new_user + RPCs (complete_my_profile, update_my_phone,
--      update_my_profile) posent le hash en même temps que le ciphertext.
--   5. Backfill idempotent : pour chaque user où telephone NOT NULL et
--      telephone_hash IS NULL → set hash via hmac(decrypt_phone(telephone), key).
--   6. Mapping erreur : les RPCs catch unique_violation et raise
--      'PHONE_ALREADY_USED' (errcode P0020) pour un mapping client propre.
--      Le trigger handle_new_user laisse remonter l'erreur native — le client
--      mappe sur le pattern "users_telephone_hash_unique" dans le message.
--
-- ⚠ Si la base contient déjà 2 users avec le même téléphone (improbable
-- avant lancement MVP), la création de l'INDEX échouera avec :
--   ERROR: could not create unique index "users_telephone_hash_unique"
--   DETAIL: Key (telephone_hash)=(\\x...) is duplicated.
-- → résoudre manuellement (fusion ou suppression d'un des comptes), puis
-- rerun la mig.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + docs/backend/auth.md §2.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonne telephone_hash ───────────────────────────────────────────────

alter table public.users
  add column if not exists telephone_hash bytea;

comment on column public.users.telephone_hash is
  'HMAC-SHA256(plaintext_phone, vault.phone_encryption_key). Déterministe → permet UNIQUE sans casser le chiffrement non-déterministe de telephone.';

-- ── 2. Helper hash_phone() ──────────────────────────────────────────────────
-- Utilise la clé Vault existante (créée mig 02) pour HMAC-SHA256.
-- Le keyed hash empêche le brute-force par dictionnaire (10^9 numéros possibles
-- sont reconstructibles en quelques heures sans clé). Avec HMAC keyed, un
-- attaquant qui aurait un dump de telephone_hash ne peut rien en faire sans
-- la clé Vault.

create or replace function public.hash_phone(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
begin
  if plaintext is null or length(trim(plaintext)) = 0 then return null; end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'phone_encryption_key'
    limit 1;
  if v_key is null then
    raise exception 'phone_encryption_key absente du Vault — relancer la migration 02';
  end if;
  return extensions.hmac(trim(plaintext), v_key, 'sha256');
end;
$$;

revoke all on function public.hash_phone(text) from public;
-- Privé (consommé seulement par les autres SECURITY DEFINER : trigger + RPCs).

-- ── 3. Backfill idempotent (avant la création de l'INDEX UNIQUE) ────────────
-- Pour chaque user qui a un telephone bytea mais pas de telephone_hash, on
-- déchiffre + hash. Idempotent : skip les rows déjà à jour.
-- ⚠ Si décryptage échoue (ciphertext corrompu), on laisse hash NULL.

do $$
declare
  r record;
  v_plain text;
begin
  for r in
    select id, telephone
      from public.users
     where telephone is not null
       and telephone_hash is null
  loop
    begin
      v_plain := public.decrypt_phone(r.telephone);
      if v_plain is not null and length(trim(v_plain)) > 0 then
        update public.users
           set telephone_hash = public.hash_phone(v_plain)
         where id = r.id;
      end if;
    exception when others then
      raise notice 'Backfill skip user %: %', r.id, SQLERRM;
    end;
  end loop;
end $$;

-- ── 4. UNIQUE INDEX partiel ─────────────────────────────────────────────────
-- WHERE telephone_hash IS NOT NULL : les comptes OAuth sans téléphone
-- (post-signup avant complete-profile) restent autorisés à coexister.

create unique index if not exists users_telephone_hash_unique
  on public.users (telephone_hash)
  where telephone_hash is not null;

-- ── 5. Trigger handle_new_user — set hash en même temps que ciphertext ──────
-- Reprend la version mig 81 (telephone + quartier + OAuth fallback +
-- cgu_accepted_at/version) + ajoute telephone_hash.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := NEW.raw_user_meta_data->>'telephone';
begin
  insert into public.users (
    id, email,
    prenom, nom,
    telephone, telephone_hash,
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
    public.encrypt_phone(v_phone),
    public.hash_phone(v_phone),
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
    case when NEW.raw_user_meta_data->>'cgu_accepted_at' is not null
      then now()
      else null
    end,
    NEW.raw_user_meta_data->>'cgu_version'
  );
  return NEW;
end;
$$;

-- ── 6. RPC update_my_phone — set hash atomique + map unique_violation ───────

create or replace function public.update_my_phone(new_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_clean text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  v_clean := nullif(trim(coalesce(new_phone, '')), '');
  begin
    update public.users
       set telephone      = public.encrypt_phone(v_clean),
           telephone_hash = public.hash_phone(v_clean),
           updated_at     = now()
     where id = uid;
  exception when unique_violation then
    if SQLERRM like '%users_telephone_hash_unique%' then
      raise exception 'PHONE_ALREADY_USED' using errcode = 'P0020';
    else
      raise;
    end if;
  end;
end;
$$;

revoke all on function public.update_my_phone(text) from public;
grant execute on function public.update_my_phone(text) to authenticated;

-- ── 7. RPC complete_my_profile — set hash + map unique_violation ────────────
-- Reprend signature mig 83 (6 params) + ajoute telephone_hash.

create or replace function public.complete_my_profile(
  p_ville     text,
  p_quartier  text,
  p_telephone text,
  p_pays      pays_code default null,
  p_prenom    text      default null,
  p_nom       text      default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  v_prenom text;
  v_nom    text;
  v_phone  text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_ville is null or length(trim(p_ville)) = 0 then
    raise exception 'ville requise';
  end if;
  if p_telephone is null or length(trim(p_telephone)) = 0 then
    raise exception 'telephone requis';
  end if;

  if p_prenom is not null then
    v_prenom := nullif(trim(p_prenom), '');
    if v_prenom is null then
      raise exception 'prenom cannot be empty';
    end if;
  end if;
  if p_nom is not null then
    v_nom := nullif(trim(p_nom), '');
    if v_nom is null then
      raise exception 'nom cannot be empty';
    end if;
  end if;

  v_phone := trim(p_telephone);

  begin
    update public.users
    set ville          = trim(p_ville),
        quartier       = nullif(trim(coalesce(p_quartier, '')), ''),
        telephone      = public.encrypt_phone(v_phone),
        telephone_hash = public.hash_phone(v_phone),
        pays           = case when p_pays   is not null then p_pays   else pays   end,
        prenom         = case when v_prenom is not null then v_prenom else prenom end,
        nom            = case when v_nom    is not null then v_nom    else nom    end,
        updated_at     = now()
    where id = uid;
  exception when unique_violation then
    if SQLERRM like '%users_telephone_hash_unique%' then
      raise exception 'PHONE_ALREADY_USED' using errcode = 'P0020';
    else
      raise;
    end if;
  end;
end;
$$;

revoke all on function public.complete_my_profile(text, text, text, pays_code, text, text) from public;
grant execute on function public.complete_my_profile(text, text, text, pays_code, text, text) to authenticated;

-- ── 8. RPC update_my_profile — set hash + map unique_violation ──────────────
-- Reprend signature mig 12 (jsonb patch) + ajoute telephone_hash.

drop function if exists public.update_my_profile(jsonb);

create function public.update_my_profile(patch jsonb)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_prenom text;
  v_nom text;
  v_ville text;
  v_phone text;
  result public.users;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception 'Patch must be a jsonb object';
  end if;

  if patch ? 'prenom' then
    v_prenom := nullif(trim(patch->>'prenom'), '');
    if v_prenom is null then
      raise exception 'prenom cannot be empty';
    end if;
  end if;
  if patch ? 'nom' then
    v_nom := nullif(trim(patch->>'nom'), '');
    if v_nom is null then
      raise exception 'nom cannot be empty';
    end if;
  end if;
  if patch ? 'ville' then
    v_ville := nullif(trim(patch->>'ville'), '');
    if v_ville is null then
      raise exception 'ville cannot be empty';
    end if;
  end if;
  if patch ? 'telephone' then
    v_phone := nullif(trim(coalesce(patch->>'telephone', '')), '');
  end if;

  begin
    update public.users
      set prenom    = case when patch ? 'prenom' then v_prenom else prenom end,
          nom       = case when patch ? 'nom' then v_nom else nom end,
          ville     = case when patch ? 'ville' then v_ville else ville end,
          quartier  = case
                        when patch ? 'quartier'
                        then nullif(trim(patch->>'quartier'), '')
                        else quartier
                      end,
          pays      = case
                        when patch ? 'pays'
                        then (patch->>'pays')::pays_code
                        else pays
                      end,
          telephone = case
                        when patch ? 'telephone'
                        then public.encrypt_phone(v_phone)
                        else telephone
                      end,
          telephone_hash = case
                        when patch ? 'telephone'
                        then public.hash_phone(v_phone)
                        else telephone_hash
                      end
      where id = uid
      returning * into result;
  exception when unique_violation then
    if SQLERRM like '%users_telephone_hash_unique%' then
      raise exception 'PHONE_ALREADY_USED' using errcode = 'P0020';
    else
      raise;
    end if;
  end;

  return result;
end;
$$;

revoke all on function public.update_my_profile(jsonb) from public;
grant execute on function public.update_my_profile(jsonb) to authenticated;
