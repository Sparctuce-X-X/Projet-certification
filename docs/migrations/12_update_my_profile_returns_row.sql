-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 12 — update_my_profile retourne la row mise à jour (renommée de 08)
--
-- Issu de l'audit profil §🟢#9 : updateMyProfile retournait void et le client
-- enchaînait avec refreshProfile() = SELECT supplémentaire. En faisant
-- retourner la row par la RPC (UPDATE … RETURNING *), on économise un
-- round-trip réseau par save (sensible sur 4G CI/CG).
--
-- Pré-requis : 10_users_atomic_update.sql joué.
--
-- ⚠ CREATE OR REPLACE FUNCTION ne permet pas de changer le type de retour
-- (void → public.users) → DROP préalable obligatoire.
--
-- À jouer dans Supabase SQL Editor APRÈS migration 10 (ou 11 si déjà jouée).
-- ─────────────────────────────────────────────────────────────────────────────

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
    where id = uid
    returning * into result;

  return result;
end;
$$;

revoke all on function public.update_my_profile(jsonb) from public;
grant execute on function public.update_my_profile(jsonb) to authenticated;
