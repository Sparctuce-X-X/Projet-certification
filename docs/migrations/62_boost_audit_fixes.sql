-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 62 — Fixes audit algo boost (F09)
--
-- 2 trous identifiés post-merge mig 60 :
--
-- A. Cron `purge_expired_boosts` tournait 1x/jour (4h UTC) → entre
--    l'expiration réelle (`boost_until < now()`) et le passage du cron, le
--    flag `is_boosted=true` reste, et le tri Home/Search remonte l'annonce
--    en haut SANS badge "Sponsorisé" (le badge filtre `boost_until > now()`
--    côté client). Conséquence : faux positif jusqu'à 24h.
--    Fix : passer le cron à toutes les 15 min → drift max 15 min.
--
-- B. RPC `apply_boost` vérifiait que le paiement appartient à l'user
--    (statut='completed', non consommé) MAIS pas que `paiement.target_id`
--    matche l'annonce qu'on booste. Conséquence : un user pouvait payer
--    pour annonce X et appliquer le boost sur annonce Y (les deux lui
--    appartiennent → pas de fraude monétaire, mais incohérence comptable
--    et confusion côté PawaPay metadata).
--    Fix : check supplémentaire dans la RPC.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A. Cron toutes les 15 min ───────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'purge-expired-boosts'
  ) then
    perform cron.unschedule('purge-expired-boosts');
  end if;
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — skip unschedule';
end $$;

do $$
begin
  perform cron.schedule(
    'purge-expired-boosts',
    '*/15 * * * *',
    $cron$select public.purge_expired_boosts();$cron$
  );
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — boost cron NOT scheduled';
end $$;

-- ── B. RPC apply_boost — check target_id cohérence ──────────────────────────

create or replace function public.apply_boost(
  p_paiement_id    uuid,
  p_annonce_id     uuid,
  p_duration_days  int
)
returns timestamptz
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

  -- Cohérence target_id : si le paiement a été initié pour une annonce
  -- spécifique (target_id non null), on refuse l'application sur une autre.
  if v_paiement.target_id is not null
     and v_paiement.target_id <> p_annonce_id then
    raise exception 'PAIEMENT_TARGET_MISMATCH' using errcode = 'P0006';
  end if;

  select * into v_annonce
    from public.annonces
   where id = p_annonce_id
     and vendeur_id = v_uid
     and statut = 'active';

  if not found then
    raise exception 'ANNONCE_INVALID' using errcode = 'P0005';
  end if;

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

-- grant déjà fait en mig 60 ; on ne le re-exécute pas (idempotent OK car
-- create or replace function préserve les grants).
