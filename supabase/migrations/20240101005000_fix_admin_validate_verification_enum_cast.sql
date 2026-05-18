-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 50 — Fix RPC admin_validate_verification (cast enum)
--
-- Bug constaté lors du test E4 admin web : la RPC plante avec
--   "column 'statut' is of type statut_verification but expression is of type text"
--
-- Cause : le CASE WHEN retournait du text brut ('verified' / 'rejected'),
-- Postgres ne cast pas automatiquement vers l'enum statut_verification.
-- Fix : cast explicite via ::statut_verification.
--
-- Prérequis : migrations 45 (RPC originale), 47 (signature update).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_validate_verification(
  p_verification_id  uuid,
  p_approved         boolean,
  p_reject_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  v_admin_id := auth.uid();
  if v_admin_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- Vérifier admin
  if not exists (select 1 from public.users where id = v_admin_id and is_admin = true) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0010';
  end if;

  -- Refus : raison obligatoire entre 5 et 500 chars
  if not p_approved and (p_reject_reason is null or char_length(p_reject_reason) < 5) then
    raise exception 'REJECT_REASON_REQUIRED' using errcode = 'P0011';
  end if;

  update public.verifications_identite
     set statut       = (case when p_approved then 'verified' else 'rejected' end)::statut_verification,
         reviewed_by  = v_admin_id,
         reviewed_at  = now(),
         reject_reason = case when p_approved then null else p_reject_reason end
   where id = p_verification_id
     and statut = 'pending'::statut_verification;

  if not found then
    raise exception 'VERIFICATION_NOT_PENDING' using errcode = 'P0012';
  end if;
end;
$$;

grant execute on function public.admin_validate_verification(uuid, boolean, text) to authenticated;
