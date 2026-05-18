-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 51 — get_user_public_profile : ajout is_verified au shape
--
-- Source : F07 KYC + UX badge inline coral sur profil public.
--
-- La RPC `get_user_public_profile` retourne le shape consommé par
-- `app/u/[id].tsx` (profil public d'un autre user). Pour afficher le badge
-- "Vendeur Vérifié" (style Instagram, petit cercle coral + check blanc), il
-- faut exposer `users.is_verified` qui n'était pas dans le payload.
--
-- Modif : ajout simple de la clé `is_verified` dans le jsonb_build_object.
-- Aucun risque de fuite RGPD — ce champ est public par design (badge de
-- confiance affiché dans toute l'UI).
--
-- Prérequis : migration 37 (version courante de la RPC), 45 (is_verified).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_user_public_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
begin
  select * into v_user from public.users where id = p_user_id;

  if not found or v_user.is_active = false then
    return null;
  end if;

  return jsonb_build_object(
    'id',             v_user.id,
    'prenom',         v_user.prenom,
    'nom_initial',    upper(left(v_user.nom, 1)) || '.',
    'avatar_url',     v_user.avatar_url,
    'pays',           v_user.pays,
    'ville',          v_user.ville,
    'note_vendeur',   v_user.note_vendeur,
    'nb_ventes',      v_user.nb_ventes,
    'note_acheteur',  v_user.note_acheteur,
    'nb_achats',      v_user.nb_achats,
    'is_verified',    v_user.is_verified,  -- mig 51 : badge KYC inline coral
    'created_at',     v_user.created_at,
    'recent_avis',    (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      from (
        select
          a.id,
          a.note,
          a.commentaire,
          a.role_auteur,
          a.is_auto,
          a.created_at,
          ua.id          as auteur_id,
          ua.prenom      as auteur_prenom,
          ua.avatar_url  as auteur_avatar_url
        from public.avis a
        join public.users ua on ua.id = a.auteur_id
        where a.cible_id = p_user_id
        order by a.created_at desc
        limit 10
      ) t
    )
  );
end;
$$;

revoke all on function public.get_user_public_profile(uuid) from public;
grant execute on function public.get_user_public_profile(uuid) to authenticated, anon;
