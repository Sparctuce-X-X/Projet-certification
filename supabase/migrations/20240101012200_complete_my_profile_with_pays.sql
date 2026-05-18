-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 82 — `complete_my_profile` accepte aussi `p_pays` (fix bug OAuth)
--
-- Bug : Supabase signInWithOAuth NE propage PAS les `queryParams` custom
-- vers `raw_user_meta_data` — c'est une limitation Supabase, pas Niqo. Au
-- retour OAuth, le trigger handle_new_user lit `raw_user_meta_data->>'pays'`
-- → null → fallback `coalesce(..., 'CI')`. Conséquence : tout user OAuth
-- qui a choisi 🇨🇬 CG dans CountryPicker se retrouve avec `pays = 'CI'` en
-- DB, indicatif téléphone +225 et ville "Abidjan" sur l'écran complete-profile.
--
-- Fix : permet au client de poser le bon pays atomiquement avec ville/quartier
-- /telephone via la même RPC. Le client lit AsyncStorage('niqo_country')
-- (qui persiste avant/après le browser OAuth) au mount du complete-profile
-- et le pousse dans cet appel.
--
-- Signature backward-compatible :
--   p_pays nullable → si absent, le pays existant n'est pas écrasé
--   (idem rétrocompat avec d'anciens clients qui n'envoient pas le param)
--
-- ⚠ CREATE OR REPLACE FUNCTION ne permet pas de changer la signature
-- (ajout de param) → DROP préalable obligatoire.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + docs/backend/auth.md §5.2.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.complete_my_profile(text, text, text);

create function public.complete_my_profile(
  p_ville     text,
  p_quartier  text,
  p_telephone text,
  p_pays      pays_code default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Validation minimale serveur (garde-fou bypass REST)
  if p_ville is null or length(trim(p_ville)) = 0 then
    raise exception 'ville requise';
  end if;
  if p_telephone is null or length(trim(p_telephone)) = 0 then
    raise exception 'telephone requis';
  end if;

  update public.users
  set ville      = trim(p_ville),
      quartier   = nullif(trim(coalesce(p_quartier, '')), ''),
      telephone  = public.encrypt_phone(trim(p_telephone)),
      pays       = case when p_pays is not null then p_pays else pays end,
      updated_at = now()
  where id = uid;
end;
$$;

revoke all on function public.complete_my_profile(text, text, text, pays_code) from public;
grant execute on function public.complete_my_profile(text, text, text, pays_code) to authenticated;
