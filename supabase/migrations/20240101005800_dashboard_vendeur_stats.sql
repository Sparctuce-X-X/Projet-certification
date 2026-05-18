-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 58 — RPC get_my_dashboard_stats() pour le dashboard vendeur (F12)
--
-- Source : CDC v4.0 §F12 — "Stats vues/contacts/RDV"
--
-- Une seule RPC qui agrège toutes les stats du vendeur connecté en 1 round-trip
-- → l'app mobile fait 1 seul appel, parse le JSON, et affiche les bento cards.
--
-- Stats retournées (JSONB) :
--   - annonces : breakdown par statut (active, en_cours, vendue, expiree, suspendue)
--   - vues_total : sum(nb_vues) sur toutes ses annonces (perfs ses annonces)
--   - conversations : total + nb avec messages non lus (= demandes en attente)
--   - rdv : proposed (en attente confirmation), confirmed (à venir), past (passés)
--   - profile : nb_ventes/nb_achats/note_vendeur/note_acheteur/signalements/score
--   - flags : is_verified, is_active (état du compte)
--
-- Pas d'authent admin requis — l'user voit ses PROPRES stats. SECURITY DEFINER
-- pour bypass les RLS users sur d'autres rows (besoin de note_vendeur etc.) sans
-- ouvrir une policy plus large.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_my_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_user   public.users;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_user from public.users where id = v_uid;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  with my_annonces as (
    select * from public.annonces where vendeur_id = v_uid
  ),
  my_convs as (
    select * from public.conversations where vendeur_id = v_uid
  )
  select jsonb_build_object(
    'annonces', jsonb_build_object(
      'total',     (select count(*) from my_annonces),
      'active',    (select count(*) from my_annonces where statut = 'active'),
      'en_cours',  (select count(*) from my_annonces where statut = 'en_cours'),
      'vendue',    (select count(*) from my_annonces where statut = 'vendue'),
      'expiree',   (select count(*) from my_annonces where statut = 'expiree'),
      'suspendue', (select count(*) from my_annonces where statut = 'suspendue')
    ),
    'vues_total', (select coalesce(sum(nb_vues), 0)::int from my_annonces),
    'conversations', jsonb_build_object(
      'total', (select count(*) from my_convs),
      'unread', (
        select count(distinct c.id)
          from my_convs c
          join public.messages m on m.conversation_id = c.id
         where m.expediteur_id <> v_uid
           and m.is_read = false
           and coalesce(m.is_deleted, false) = false
      )
    ),
    'rdv', jsonb_build_object(
      'proposed',  (
        select count(*) from my_convs
         where rdv_propose_at is not null
           and rdv_confirme_at is null
           and rdv_annule_at is null
      ),
      'confirmed_upcoming', (
        select count(*) from my_convs
         where rdv_confirme_at is not null
           and rdv_annule_at is null
           and rdv_date >= now()
      ),
      'past', (
        select count(*) from my_convs
         where rdv_confirme_at is not null
           and rdv_annule_at is null
           and rdv_date < now()
      )
    ),
    'profile', jsonb_build_object(
      'nb_ventes',       v_user.nb_ventes,
      'nb_achats',       v_user.nb_achats,
      'note_vendeur',    v_user.note_vendeur,
      'note_acheteur',   v_user.note_acheteur,
      'nb_signalements', v_user.nb_signalements,
      'score_abus',      v_user.score_abus,
      'is_verified',     coalesce(v_user.is_verified, false),
      'is_active',       v_user.is_active
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_my_dashboard_stats() from public;
grant execute on function public.get_my_dashboard_stats() to authenticated;
