-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 56 — Modération admin des signalements (F08)
--
-- Objectif : permettre à l'admin (back-office /admin/signalements) de :
--   1. Lister tous les signalements (RLS admin SELECT)
--   2. Voir le contenu de la cible signalée — annonce dans n'importe quel
--      statut (suspendue, expirée), ou message dans n'importe quelle
--      conversation où il n'est pas participant
--   3. Marquer un signalement 'traite' ou 'rejete' via RPC SECURITY DEFINER
--
-- Le trigger fn_signalement_check_threshold (mig 25) gère déjà :
--   - Incrément score_abus + nb_signalements quand statut → 'traite'
--   - Auto-suspend (is_active = false) si score_abus ≥ 3 dans les 30j
-- → Cette migration n'a pas à le toucher.
--
-- Pattern aligné sur mig 52 (admin users SELECT via is_current_user_admin).
--
-- Prérequis : migrations 25 (signalements + RPCs), 28 (auto-suspend),
-- 52 (helper is_current_user_admin).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Policy SELECT admin sur signalements ──────────────────────────────────
-- Mig 25 ne définit que `signalements_select_own` (signaleur uniquement).
-- L'admin ne peut donc pas lister la file de modération sans cette policy.

drop policy if exists signalements_admin_select on public.signalements;
create policy signalements_admin_select on public.signalements
  for select using (public.is_current_user_admin());

-- ── 2. Policy SELECT admin sur annonces (tous statuts) ───────────────────────
-- Mig 15 limite la lecture aux annonces 'active' (sauf owner). L'admin doit
-- pouvoir consulter une annonce suspendue ou expirée pour la modérer.

drop policy if exists annonces_admin_select on public.annonces;
create policy annonces_admin_select on public.annonces
  for select using (public.is_current_user_admin());

-- ── 3. Policy SELECT admin sur messages (toute conversation) ─────────────────
-- Mig 22 limite la lecture aux participants. L'admin doit pouvoir lire un
-- message signalé pour juger du motif (harcèlement, arnaque, etc.).

drop policy if exists messages_admin_select on public.messages;
create policy messages_admin_select on public.messages
  for select using (public.is_current_user_admin());

-- Idem conversations (pour afficher le contexte du message dans le détail
-- signalement : annonce concernée, autre participant)
drop policy if exists conversations_admin_select on public.conversations;
create policy conversations_admin_select on public.conversations
  for select using (public.is_current_user_admin());

-- ── 4. RPC admin_treat_signalement ──────────────────────────────────────────
-- Action admin = 'traite' (signalement confirmé, déclenche le trigger
-- fn_signalement_check_threshold mig 25 qui incrémente score_abus et
-- auto-suspend si ≥ 3 en 30j) ou 'rejete' (faux positif, pas d'effet).
--
-- Le check `statut = 'en_attente'` empêche les double-traitements (race ou
-- back-button admin). En cas de re-traitement, lever une erreur explicite.

create or replace function public.admin_treat_signalement(
  p_signalement_id uuid,
  p_action         text  -- 'traite' | 'rejete'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0002';
  end if;

  if p_action not in ('traite', 'rejete') then
    raise exception 'INVALID_ACTION' using errcode = 'P0003';
  end if;

  -- Cast explicite vers l'enum (cf. gotcha mig 50 — enum cast required)
  update public.signalements
     set statut = p_action::statut_signalement,
         updated_at = now()
   where id = p_signalement_id
     and statut = 'en_attente';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'SIGNALEMENT_NOT_PENDING' using errcode = 'P0004';
  end if;
end;
$$;

revoke all on function public.admin_treat_signalement(uuid, text) from public;
grant execute on function public.admin_treat_signalement(uuid, text) to authenticated;

-- ── 5. Helper view (optionnel) — file d'attente avec compteur ───────────────
-- Permet à l'admin web de récupérer le count en_attente sans full scan
-- côté client. Pas de RLS sur les views, mais le SELECT sous-jacent est
-- gaté par signalements_admin_select.

create or replace view public.v_signalements_queue_stats as
select
  count(*) filter (where statut = 'en_attente')::int as en_attente,
  count(*) filter (where statut = 'traite')::int     as traite,
  count(*) filter (where statut = 'rejete')::int     as rejete,
  count(*)::int                                       as total
from public.signalements;

grant select on public.v_signalements_queue_stats to authenticated;
