-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 103 — Audit log admin (B5)
--
-- PROBLÈME RÉSOLU
--   Aucune trace persistante de QUI a fait QUOI sur les RPCs admin (validation
--   KYC, modération signalement, suspension annonce/user, soft-delete message,
--   revert annonce). Aujourd'hui un admin = Dominique uniquement, mais :
--     - RGPD : on doit pouvoir prouver que telle CNI/email a été décidée par
--       un admin précis à un instant T (audit trail demandé par les régulateurs
--       ARTCI / ANRTIC / NCSA).
--     - Multi-admin futur : si on délègue la modération, savoir qui a banni qui.
--     - Debug : "pourquoi cette annonce est suspendue ? quel signalement ?".
--
-- SOLUTION
--   Table `audit_log_admin` append-only + helper `_log_admin_action()` appelé
--   à la fin de chaque RPC admin (après le travail métier réussi).
--   RLS : SELECT admin uniquement, pas d'INSERT/UPDATE/DELETE via PostgREST.
--
-- DESIGN
--   - `action` text libre (convention `<target>_<verb>`, ex `kyc_verified`)
--     plutôt qu'enum → pas de mig schéma à chaque nouvelle action loggée.
--   - `target_id` nullable + admin_id `on delete set null` pour préserver
--     l'historique même si la cible/admin est purgée (droit à l'oubli).
--   - `metadata` jsonb pour porter les paramètres non-sensibles (reject_reason,
--     numero_cni). Pas de PII en clair (téléphone, email) — uniquement IDs et
--     raisons textuelles déjà visibles à l'admin.
--   - 3 indexes : par admin (qui a fait quoi), par cible (historique de cette
--     cible), chronologique (feed récent).
--
-- PATCHES DES 6 RPCs
--   1. admin_validate_verification (mig 85)         → kyc_verified | kyc_rejected
--   2. admin_treat_signalement     (mig 56)         → signalement_traite | rejete
--   3. admin_suspend_annonce       (mig 57)         → annonce_suspended
--   4. admin_suspend_user          (mig 57)         → user_suspended
--   5. admin_soft_delete_message   (mig 57)         → message_soft_deleted
--   6. admin_revert_annonce_to_active (mig 95)      → annonce_reverted_active
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + docs/backend/admin.md (à créer).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table audit_log_admin ────────────────────────────────────────────────

create table if not exists public.audit_log_admin (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.users(id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.audit_log_admin is
  'Audit append-only des actions admin (KYC, signalement, suspension, revert). RLS SELECT admin only. Aucune PII en clair dans metadata.';

-- ── 2. Indexes ──────────────────────────────────────────────────────────────

create index if not exists idx_audit_log_admin_admin_at
  on public.audit_log_admin (admin_id, created_at desc);

create index if not exists idx_audit_log_admin_target
  on public.audit_log_admin (target_type, target_id, created_at desc);

create index if not exists idx_audit_log_admin_created
  on public.audit_log_admin (created_at desc);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

alter table public.audit_log_admin enable row level security;

drop policy if exists audit_log_admin_select on public.audit_log_admin;
create policy audit_log_admin_select on public.audit_log_admin
  for select using (public.is_current_user_admin());

-- INSERT/UPDATE/DELETE : aucune policy → bloqué pour tout le monde via
-- PostgREST. Seul le helper SECURITY DEFINER ci-dessous peut insérer.
revoke insert, update, delete on public.audit_log_admin from public, anon, authenticated;

-- ── 4. Helper _log_admin_action ─────────────────────────────────────────────

create or replace function public._log_admin_action(
  p_action      text,
  p_target_type text,
  p_target_id   uuid    default null,
  p_metadata    jsonb   default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
begin
  -- Pas d'écriture si pas de session (caller est censé avoir gate AUTH déjà).
  -- Best-effort : on ne raise pas pour ne pas casser la RPC métier en cas d'edge.
  if v_admin_id is null then
    return;
  end if;

  insert into public.audit_log_admin (admin_id, action, target_type, target_id, metadata)
  values (v_admin_id, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Helper interne : pas d'exécution depuis PostgREST direct.
-- Reste appelable depuis les RPCs SECURITY DEFINER qui sont elles-mêmes
-- exposées à `authenticated` (le grant authenticated traverse le SECURITY
-- DEFINER chain).
revoke all on function public._log_admin_action(text, text, uuid, jsonb) from public, anon, authenticated;

-- ── 5. PATCH admin_validate_verification (mig 85 + log) ─────────────────────
-- Préserve strictement la signature et le comportement mig 85.
-- Log à la fin si update OK : action = kyc_verified ou kyc_rejected.

create or replace function public.admin_validate_verification(
  p_verification_id  uuid,
  p_approved         boolean,
  p_reject_reason    text default null,
  p_numero_cni       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id   uuid;
  v_numero_cni text;
begin
  v_admin_id := auth.uid();
  if v_admin_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.users where id = v_admin_id and is_admin = true) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0010';
  end if;

  if not p_approved and (p_reject_reason is null or char_length(p_reject_reason) < 5) then
    raise exception 'REJECT_REASON_REQUIRED' using errcode = 'P0011';
  end if;

  if p_approved then
    v_numero_cni := upper(nullif(trim(coalesce(p_numero_cni, '')), ''));
    if v_numero_cni is null then
      raise exception 'NUMERO_CNI_REQUIRED' using errcode = 'P0014';
    end if;
    if v_numero_cni !~ '^[A-Z0-9 \-]{4,20}$' then
      raise exception 'NUMERO_CNI_INVALID' using errcode = 'P0015';
    end if;
  end if;

  begin
    update public.verifications_identite
       set statut        = (case when p_approved then 'verified' else 'rejected' end)::statut_verification,
           reviewed_by   = v_admin_id,
           reviewed_at   = now(),
           reject_reason = case when p_approved then null else p_reject_reason end,
           numero_cni    = case when p_approved then v_numero_cni else numero_cni end
     where id = p_verification_id
       and statut = 'pending'::statut_verification;
  exception when unique_violation then
    if SQLERRM like '%verifications_numero_cni_verified_unique%' then
      raise exception 'CNI_ALREADY_USED' using errcode = 'P0013';
    else
      raise;
    end if;
  end;

  if not found then
    raise exception 'VERIFICATION_NOT_PENDING' using errcode = 'P0012';
  end if;

  -- ── AUDIT (mig 103) ─────────────────────────────────────────────────────
  perform public._log_admin_action(
    case when p_approved then 'kyc_verified' else 'kyc_rejected' end,
    'verification',
    p_verification_id,
    case
      when p_approved then jsonb_build_object('numero_cni', v_numero_cni)
      else jsonb_build_object('reject_reason', p_reject_reason)
    end
  );
end;
$$;

revoke all on function public.admin_validate_verification(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_validate_verification(uuid, boolean, text, text) to authenticated;

-- ── 6. PATCH admin_treat_signalement (mig 56 + log) ─────────────────────────

create or replace function public.admin_treat_signalement(
  p_signalement_id uuid,
  p_action         text
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

  update public.signalements
     set statut = p_action::statut_signalement,
         updated_at = now()
   where id = p_signalement_id
     and statut = 'en_attente';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'SIGNALEMENT_NOT_PENDING' using errcode = 'P0004';
  end if;

  -- ── AUDIT (mig 103) ─────────────────────────────────────────────────────
  perform public._log_admin_action(
    'signalement_' || p_action,
    'signalement',
    p_signalement_id,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.admin_treat_signalement(uuid, text) from public, anon;
grant execute on function public.admin_treat_signalement(uuid, text) to authenticated;

-- ── 7. PATCH admin_suspend_annonce (mig 57 + log) ───────────────────────────

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
    if not exists (select 1 from public.annonces where id = p_annonce_id) then
      raise exception 'ANNONCE_NOT_FOUND' using errcode = 'P0003';
    end if;
    -- déjà suspendue : pas de log (idempotent no-op)
    return;
  end if;

  -- ── AUDIT (mig 103) ─────────────────────────────────────────────────────
  perform public._log_admin_action(
    'annonce_suspended',
    'annonce',
    p_annonce_id,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.admin_suspend_annonce(uuid) from public, anon;
grant execute on function public.admin_suspend_annonce(uuid) to authenticated;

-- ── 8. PATCH admin_suspend_user (mig 57 + log) ──────────────────────────────

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
    -- déjà suspendu : pas de log (idempotent no-op)
    return;
  end if;

  -- ── AUDIT (mig 103) ─────────────────────────────────────────────────────
  perform public._log_admin_action(
    'user_suspended',
    'user',
    p_user_id,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.admin_suspend_user(uuid) from public, anon;
grant execute on function public.admin_suspend_user(uuid) to authenticated;

-- ── 9. PATCH admin_soft_delete_message (mig 57 + log) ───────────────────────

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
    -- déjà supprimé : pas de log (idempotent no-op)
    return;
  end if;

  -- ── AUDIT (mig 103) ─────────────────────────────────────────────────────
  perform public._log_admin_action(
    'message_soft_deleted',
    'message',
    p_message_id,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.admin_soft_delete_message(uuid) from public, anon;
grant execute on function public.admin_soft_delete_message(uuid) to authenticated;

-- ── 10. PATCH admin_revert_annonce_to_active (mig 95 + log) ─────────────────
-- Cette RPC retourne jsonb (success/error) au lieu de raise. Log uniquement
-- sur success=true.

create or replace function public.admin_revert_annonce_to_active(p_annonce_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_admin   boolean;
  v_annonce public.annonces%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  select is_admin into v_admin from public.users where id = v_uid;
  if not coalesce(v_admin, false) then
    return jsonb_build_object('success', false, 'error', 'ADMIN_REQUIRED');
  end if;

  select * into v_annonce
  from public.annonces
  where id = p_annonce_id
  for update;

  if v_annonce.id is null then
    return jsonb_build_object('success', false, 'error', 'ANNONCE_NOT_FOUND');
  end if;

  if v_annonce.statut <> 'en_cours' then
    return jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATE',
      'current_statut', v_annonce.statut::text
    );
  end if;

  update public.annonces
  set statut     = 'active',
      updated_at = now()
  where id = p_annonce_id;

  begin
    perform public._notify_push(
      array[v_annonce.vendeur_id],
      'Annonce remise en vente',
      'Ton annonce « ' || v_annonce.titre || ' » est de nouveau visible.',
      jsonb_build_object('url', '/announce/' || p_annonce_id::text)
    );
  exception when others then
    null;
  end;

  -- ── AUDIT (mig 103) ─────────────────────────────────────────────────────
  perform public._log_admin_action(
    'annonce_reverted_active',
    'annonce',
    p_annonce_id,
    jsonb_build_object('previous_statut', v_annonce.statut::text)
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_revert_annonce_to_active(uuid) from public, anon;
grant execute on function public.admin_revert_annonce_to_active(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fin mig 103
-- ─────────────────────────────────────────────────────────────────────────────
