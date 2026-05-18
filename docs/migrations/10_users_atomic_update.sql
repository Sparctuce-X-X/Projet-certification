-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 10 — Atomicité des updates profil + bump updated_at (renommée de 06)
--
-- Issu de l'audit profil 2026-04-28 (cf. CLAUDE.md §audit) :
--   - 🔴 #2 : `users.updated_at` n'était pas bumpé sur les UPDATE REST
--             (le DEFAULT now() ne s'applique qu'à l'INSERT) → trigger BEFORE
--             UPDATE pour systématiser le bump, peu importe l'origine.
--   - 🔴 #3 : les writes profil (champs texte + téléphone encrypté) étaient
--             répartis sur 2 calls (REST update + RPC update_my_phone) → si
--             le 2ᵉ échouait, atomicité brisée. Nouvelle RPC unifiée
--             `update_my_profile(patch jsonb)` qui fait tout en transaction.
--
-- Pré-requis : 01_users.sql + 02_users_phone_vault.sql + 09_profile_updates.sql
-- À jouer dans Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigger BEFORE UPDATE → updated_at = now() ───────────────────────────
-- Bumpe updated_at à chaque write, peu importe d'où il vient (REST, RPC,
-- dashboard, autre trigger). Source de vérité unique.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();

-- ── 2. RPC unifiée update_my_profile — write atomique ───────────────────────
-- Patch partiel JSON : seules les clés présentes sont updatées. Permet au
-- client de ne pousser que les fields dirty.
--
-- Convention :
--   - prenom / nom / ville / pays : si présents, doivent être non-vides
--   - quartier : si présent, "" → null (clear)
--   - telephone : si présent, "" → null (clear), sinon encrypté via Vault
--
-- SECURITY DEFINER pour pouvoir appeler encrypt_phone (privé). search_path
-- explicite anti-injection.
--
-- L'ancien `update_my_phone` (migration 05) reste fonctionnel — il sert de
-- helper bas niveau, mais le client préfère désormais cette RPC unifiée.

create or replace function public.update_my_profile(patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_prenom text;
  v_nom text;
  v_ville text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception 'Patch must be a jsonb object';
  end if;

  -- Validation des champs requis : si présents, ils ne peuvent être vides.
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
                      then public.encrypt_phone(nullif(patch->>'telephone', ''))
                      else telephone
                    end
    where id = uid;
end;
$$;

revoke all on function public.update_my_profile(jsonb) from public;
grant execute on function public.update_my_profile(jsonb) to authenticated;
