-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 57 — Actions admin cascade sur les cibles signalées (F08)
--
-- Objectif : permettre à l'admin de suspendre/supprimer la cible d'un
-- signalement directement depuis le back-office, indépendamment de la
-- décision sur le signalement lui-même.
--
-- Cas d'usage : un signalement "Article frauduleux" sur un produit dangereux.
-- Marquer le signalement traité (mig 25 → +1 score abus du vendeur) ne suffit
-- pas — il faut RETIRER l'annonce de la circulation. Sinon elle reste visible
-- sur Home/Search.
--
-- 3 RPCs SECURITY DEFINER, une par type de cible :
--
--   1. admin_suspend_annonce(p_annonce_id)
--      → annonces.statut = 'suspendue' (enum existant, "admin only" cf. mig 15)
--      → annonces_admin_select (mig 56) garantit la lecture admin post-suspend
--
--   2. admin_suspend_user(p_user_id)
--      → users.is_active = false (déclenche aussi le trigger fn_check_score_abus
--        mig 28, qui re-applique is_active=false si score >= 3 — idempotent)
--      → différent du score_abus : c'est une suspension manuelle pré-seuil
--
--   3. admin_soft_delete_message(p_message_id)
--      → messages.is_deleted = true (colonne existante, mig 22 ligne 90)
--      → soft delete : préserve l'historique audit + le contenu pour modération
--      → la query mobile filtre déjà sur is_deleted=false (cf. fetchMessages
--        dans lib/messages.ts)
--
-- Ces actions sont DISTINCTES de admin_treat_signalement (mig 56) :
--   - treat → décision sur le signalement (traité=valide, rejete=faux positif)
--   - suspend/delete → action sur la cible (impact direct utilisateur)
-- L'admin peut faire l'un sans l'autre. Pour un cas grave : suspendre puis
-- traiter. Pour un faux positif : juste rejeter.
--
-- Toutes les RPCs vérifient is_admin() en début (helper mig 52). Aucune
-- policy admin UPDATE sur les tables — l'accès passe uniquement par RPC.
--
-- Prérequis : migrations 15, 22, 28, 52, 56.
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. admin_suspend_annonce ────────────────────────────────────────────────

create or replace function public.admin_suspend_annonce(
  p_annonce_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0002';
  end if;

  update public.annonces
     set statut = 'suspendue'::statut_annonce,
         updated_at = now()
   where id = p_annonce_id
     and statut <> 'suspendue';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    -- 0 row : soit déjà suspendue (idempotent OK), soit annonce inexistante.
    -- On distingue les deux pour ne pas masquer un bug.
    if not exists (select 1 from public.annonces where id = p_annonce_id) then
      raise exception 'ANNONCE_NOT_FOUND' using errcode = 'P0003';
    end if;
  end if;
end;
$$;

revoke all on function public.admin_suspend_annonce(uuid) from public;
grant execute on function public.admin_suspend_annonce(uuid) to authenticated;

-- ── 2. admin_suspend_user ───────────────────────────────────────────────────

create or replace function public.admin_suspend_user(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0002';
  end if;

  if p_user_id = v_uid then
    raise exception 'CANNOT_SUSPEND_SELF' using errcode = 'P0004';
  end if;

  update public.users
     set is_active = false,
         updated_at = now()
   where id = p_user_id
     and is_active = true;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    if not exists (select 1 from public.users where id = p_user_id) then
      raise exception 'USER_NOT_FOUND' using errcode = 'P0003';
    end if;
    -- déjà suspendu : idempotent OK, pas d'exception
  end if;
end;
$$;

revoke all on function public.admin_suspend_user(uuid) from public;
grant execute on function public.admin_suspend_user(uuid) to authenticated;

-- ── 3. admin_soft_delete_message ────────────────────────────────────────────

create or replace function public.admin_soft_delete_message(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not public.is_current_user_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0002';
  end if;

  update public.messages
     set is_deleted = true
   where id = p_message_id
     and is_deleted = false;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    if not exists (select 1 from public.messages where id = p_message_id) then
      raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0003';
    end if;
  end if;
end;
$$;

revoke all on function public.admin_soft_delete_message(uuid) from public;
grant execute on function public.admin_soft_delete_message(uuid) to authenticated;
