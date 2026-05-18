-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 60 — Boost annonces (F09)
--
-- Source : CDC v4.0 §5.2 — Boost 1 000 FCFA / 7j ou 3 000 FCFA / 30j.
--
-- Architecture :
--   - L'user paie via pawapay-init-deposit (mig F07, supporte déjà
--     type='boost' + target_id=annonce_id) → row paiements_niqo créée
--   - PawaPay confirme via webhook → paiements_niqo.statut = 'completed'
--   - L'app mobile poll, détecte completed, appelle apply_boost(...)
--   - apply_boost vérifie tout, set is_boosted + boost_until sur l'annonce,
--     marque le paiement consommé (anti-double-spend)
--   - Le tri Home/Search remonte les boostés en premier
--   - Cron quotidien réinitialise is_boosted=false dès que boost_until < now()
--
-- Composants :
--   1. Colonnes annonces.is_boosted + boost_until + index
--   2. Colonne paiements_niqo.consumed_at (anti-double-spend)
--   3. RPC apply_boost(p_paiement_id, p_annonce_id, p_duration_days)
--      → cumule si déjà boostée
--   4. Function purge_expired_boosts() + cron quotidien (pg_cron)
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonnes annonces ────────────────────────────────────────────────────

alter table public.annonces
  add column if not exists is_boosted  boolean      not null default false,
  add column if not exists boost_until timestamptz;

-- Index pour le tri Home/Search (boostés actifs en premier)
create index if not exists idx_annonces_boosted_active
  on public.annonces (boost_until desc nulls last, created_at desc)
  where is_boosted = true and statut = 'active';

-- ── 2. Colonne paiements_niqo.consumed_at (anti-double-spend) ───────────────
-- Sans cette colonne, un user pourrait appeler apply_boost N fois avec le
-- même paiement_id → boost gratuit cumulé. Marquer la consommation à
-- l'application = single-use.

alter table public.paiements_niqo
  add column if not exists consumed_at timestamptz;

comment on column public.paiements_niqo.consumed_at is
  'Timestamp où le paiement a été consommé par sa feature (boost, vérif). NULL = encore disponible.';

-- ── 3. RPC apply_boost ──────────────────────────────────────────────────────

create or replace function public.apply_boost(
  p_paiement_id    uuid,
  p_annonce_id     uuid,
  p_duration_days  int
)
returns timestamptz  -- nouveau boost_until (utile pour l'UI confirm)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_paiement  record;
  v_annonce   record;
  v_new_until timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if p_duration_days not in (7, 30) then
    raise exception 'INVALID_DURATION' using errcode = 'P0002';
  end if;

  -- Paiement : owner + type=boost + completed + non consommé
  select * into v_paiement
    from public.paiements_niqo
   where id = p_paiement_id
     and user_id = v_uid
     and type = 'boost'
     and statut = 'completed';

  if not found then
    raise exception 'INVALID_PAIEMENT' using errcode = 'P0003';
  end if;

  if v_paiement.consumed_at is not null then
    raise exception 'PAIEMENT_ALREADY_USED' using errcode = 'P0004';
  end if;

  -- Annonce : owner + active (on ne booste pas une vendue/expirée/suspendue)
  select * into v_annonce
    from public.annonces
   where id = p_annonce_id
     and vendeur_id = v_uid
     and statut = 'active';

  if not found then
    raise exception 'ANNONCE_INVALID' using errcode = 'P0005';
  end if;

  -- Cumul : si l'annonce est encore boostée, on prolonge depuis boost_until.
  -- Sinon on part de now(). Permet à un user de booster +7j sur un boost +7j
  -- existant → 14j au total.
  v_new_until := greatest(coalesce(v_annonce.boost_until, now()), now())
                 + (p_duration_days || ' days')::interval;

  update public.annonces
     set is_boosted  = true,
         boost_until = v_new_until,
         updated_at  = now()
   where id = p_annonce_id;

  update public.paiements_niqo
     set consumed_at = now()
   where id = p_paiement_id;

  return v_new_until;
end;
$$;

revoke all on function public.apply_boost(uuid, uuid, int) from public;
grant execute on function public.apply_boost(uuid, uuid, int) to authenticated;

-- ── 4. Cron purge_expired_boosts (quotidien 4h UTC) ─────────────────────────

create or replace function public.purge_expired_boosts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  update public.annonces
     set is_boosted = false,
         updated_at = now()
   where is_boosted = true
     and (boost_until is null or boost_until < now());
  get diagnostics v_count = row_count;
  raise notice 'purge_expired_boosts: % boosts expirés', v_count;
  return v_count;
end;
$$;

revoke all on function public.purge_expired_boosts() from public;

-- Cron quotidien (4h UTC = 5h CI/CG)
do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'purge-expired-boosts'
  ) then
    perform cron.unschedule('purge-expired-boosts');
  end if;
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — skipping cron schedule. Enable extension and re-run this migration.';
end $$;

do $$
begin
  perform cron.schedule(
    'purge-expired-boosts',
    '0 4 * * *',
    $cron$select public.purge_expired_boosts();$cron$
  );
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — boost cron NOT scheduled. Enable extension and re-run this migration.';
end $$;
