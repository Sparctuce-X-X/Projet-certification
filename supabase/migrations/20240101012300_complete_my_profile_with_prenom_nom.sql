-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 83 — `complete_my_profile` accepte aussi `p_prenom` et `p_nom`
--
-- Suite mig 82 : on étend la RPC pour permettre à l'user de compléter (ou
-- corriger) son prénom + nom au moment du complete-profile post-OAuth.
--
-- Pourquoi nécessaire :
--   - **Apple Sign In** : Apple ne renvoie le nom qu'au PREMIER auth, et
--     l'user peut choisir de masquer son nom (option "Hide My Email").
--     Conséquence : trigger handle_new_user fallback sur 'Utilisateur' / '—'.
--   - **Google OAuth** : normalement `given_name` / `family_name` arrivent
--     dans raw_user_meta_data, mais peuvent être absents si scope mal
--     configuré côté Google Cloud Console.
--   - Dans tous les cas, l'écran complete-profile.tsx affiche désormais
--     les 2 champs éditables (préremplis depuis profile, validables ou
--     corrigeables — UX cohérente quel que soit le provider).
--
-- Signature backward-compatible :
--   p_prenom / p_nom nullables → si absents, valeurs existantes inchangées
--   Validation : si présents, doivent être non-vides après trim (idem
--   update_my_profile mig 12)
--
-- ⚠ CREATE OR REPLACE FUNCTION ne permet pas de changer la signature
-- (ajout de params) → DROP préalable obligatoire.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + docs/backend/auth.md §5.2.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.complete_my_profile(text, text, text, pays_code);

create function public.complete_my_profile(
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

  -- Validation prenom / nom : si présents, doivent être non-vides après trim
  -- (cohérent avec update_my_profile mig 12)
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

  update public.users
  set ville      = trim(p_ville),
      quartier   = nullif(trim(coalesce(p_quartier, '')), ''),
      telephone  = public.encrypt_phone(trim(p_telephone)),
      pays       = case when p_pays   is not null then p_pays   else pays   end,
      prenom     = case when v_prenom is not null then v_prenom else prenom end,
      nom        = case when v_nom    is not null then v_nom    else nom    end,
      updated_at = now()
  where id = uid;
end;
$$;

revoke all on function public.complete_my_profile(text, text, text, pays_code, text, text) from public;
grant execute on function public.complete_my_profile(text, text, text, pays_code, text, text) to authenticated;
