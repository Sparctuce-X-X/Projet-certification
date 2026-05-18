-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 115 — Table `admin_compta_reports` + helper `create_compta_report`
--
-- Stocke l'historique des PDFs comptables générés à la demande par l'admin.
-- Le PDF lui-même vit dans Storage (`bucket compta-reports`), cette table
-- n'enregistre que la metadata (période, totaux, qui a généré, quand).
--
-- ## Choix conscient — pas de cron, génération manuelle (V1)
--
-- Plan-eng-review 2026-05-11 (D4) : user solo, pas de cabinet comptable
-- attaché en MVP. La V1 = bouton "Generate PDF now" dans /admin/kpis qui
-- invoque une Edge Function (mig 116 — supabase/functions/generate-compta-pdf).
-- Si Phase 2 le user veut un cron mensuel + email automatique : ajouter
-- pg_cron + Resend (mig future, non bloquant MVP).
--
-- ## Pourquoi une table dédiée plutôt qu'une simple query Storage
--
-- - Permet d'afficher la liste historique avec les totaux **sans télécharger
--   les PDFs** (page admin reste rapide).
-- - Permet l'audit log (qui a généré quoi quand).
-- - Permet la pagination si on génère beaucoup (peu probable solo, mais
--   no-cost de prévoir).
--
-- ## Schéma
--
-- - `id` : UUID PK
-- - `periode_debut` / `periode_fin` : timestamptz [from, to[
-- - `pays` : 'CI' | 'CG' | 'ALL' (ce qui a été demandé à la génération)
-- - `storage_path` : 'compta-reports/<id>.pdf' — clé Storage
-- - `total_fcfa` / `total_xof` / `total_xaf` : montants compilés (cohérence
--   avec ce qui est dans le PDF)
-- - `nb_paiements` : count des paiements completed inclus dans le PDF
-- - `generated_by` : admin qui a lancé (FK users on delete set null)
-- - `generated_at` : timestamptz default now()
-- - `bytes` : taille du PDF (pour stats)
--
-- ## Storage bucket
--
-- Ce bucket est créé séparément côté dashboard Supabase (les buckets ne
-- peuvent pas être créés dans une mig sans extension storage). Bucket privé,
-- accès via URL signée server-side, RLS Storage admin only.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table ────────────────────────────────────────────────────────────────

create table if not exists public.admin_compta_reports (
  id              uuid        primary key default gen_random_uuid(),
  periode_debut   timestamptz not null,
  periode_fin     timestamptz not null check (periode_fin > periode_debut),
  pays            text        not null check (pays in ('CI', 'CG', 'ALL')),
  storage_path    text        not null unique,
  total_fcfa      int         not null default 0,
  total_xof       int         not null default 0,
  total_xaf       int         not null default 0,
  nb_paiements    int         not null default 0,
  generated_by    uuid                 references public.users(id) on delete set null,
  generated_at    timestamptz not null default now(),
  bytes           int         not null default 0
);

comment on table public.admin_compta_reports is
  'Historique des PDF comptables générés manuellement (V1) depuis /admin/kpis. PDF stocké dans bucket `compta-reports`. Cf. mig 115.';

-- Indexes : tri chronologique inverse + filtre période/pays
create index if not exists idx_compta_reports_generated_at
  on public.admin_compta_reports (generated_at desc);

create index if not exists idx_compta_reports_periode
  on public.admin_compta_reports (periode_debut, periode_fin);

-- ── 2. RLS — admin only ─────────────────────────────────────────────────────

alter table public.admin_compta_reports enable row level security;

drop policy if exists compta_reports_select_admin on public.admin_compta_reports;
create policy compta_reports_select_admin on public.admin_compta_reports
  for select using (public.is_current_user_admin());

-- INSERT/UPDATE/DELETE bloqués via PostgREST. Seule l'Edge Function (avec
-- service_role) ou la RPC SECURITY DEFINER ci-dessous peut écrire.
revoke insert, update, delete on public.admin_compta_reports from public, anon, authenticated;

-- ── 3. RPC create_compta_report (appelée par l'Edge Function) ──────────────
-- Bypass RLS via SECURITY DEFINER, gate is_admin via auth.uid().

create or replace function public.create_compta_report(
  p_periode_debut timestamptz,
  p_periode_fin   timestamptz,
  p_pays          text,
  p_storage_path  text,
  p_total_fcfa    int,
  p_total_xof     int,
  p_total_xaf     int,
  p_nb_paiements  int,
  p_bytes         int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id  uuid := auth.uid();
  v_report_id uuid;
begin
  if not exists (
    select 1 from public.users where id = v_admin_id and is_admin = true
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_pays not in ('CI', 'CG', 'ALL') then
    raise exception 'INVALID_PAYS: % (expected CI, CG or ALL)', p_pays;
  end if;

  if p_periode_fin <= p_periode_debut then
    raise exception 'INVALID_WINDOW: periode_fin must be > periode_debut';
  end if;

  insert into public.admin_compta_reports (
    periode_debut, periode_fin, pays, storage_path,
    total_fcfa, total_xof, total_xaf, nb_paiements,
    generated_by, bytes
  )
  values (
    p_periode_debut, p_periode_fin, p_pays, p_storage_path,
    p_total_fcfa, p_total_xof, p_total_xaf, p_nb_paiements,
    v_admin_id, p_bytes
  )
  returning id into v_report_id;

  -- Audit log via _log_admin_action (mig 103).
  -- Action `compta_pdf_generated`, target_type=`compta_report`, target_id=report_id.
  begin
    perform public._log_admin_action(
      'compta_pdf_generated'::text,
      'compta_report'::text,
      v_report_id,
      jsonb_build_object(
        'periode_debut', p_periode_debut,
        'periode_fin',   p_periode_fin,
        'pays',          p_pays,
        'total_fcfa',    p_total_fcfa,
        'nb_paiements',  p_nb_paiements,
        'bytes',         p_bytes
      )
    );
  exception when undefined_function then
    null;
  end;

  return v_report_id;
end;
$$;

revoke all on function public.create_compta_report(timestamptz, timestamptz, text, text, int, int, int, int, int) from public, anon;
grant execute on function public.create_compta_report(timestamptz, timestamptz, text, text, int, int, int, int, int) to authenticated;

comment on function public.create_compta_report(timestamptz, timestamptz, text, text, int, int, int, int, int) is
  'Insert d''un rapport comptable (appelé par Edge Function generate-compta-pdf après upload Storage). Gate is_admin. Audit log auto. Mig 115.';
