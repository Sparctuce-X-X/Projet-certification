-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 113 — `admin_kpis_revenue(p_from, p_to, p_pays)` (admin dashboard v2)
--
-- **DISRUPTIVE** : drop `get_admin_kpis(timestamptz, timestamptz)` (mig 78→80)
-- + crée `admin_kpis_revenue()` (3e et dernier panel du dashboard v2).
--
-- ## Choix disruptif assumé (plan-eng-review 2026-05-11, D3 = B)
--
-- Pas de stratégie strangler-fig / additif. Le monolithe `get_admin_kpis`
-- est remplacé en un coup par 3 RPCs (mig 111/112/113) + frontend rewrite
-- atomique. Justifié par : (a) user solo, pré-launch, 0 user externe sur
-- /admin/kpis, (b) maintenir 2 codes parallèles coûte plus que le risque
-- d'une bascule courte, (c) ne pas laisser de cruft.
--
-- ## Pourquoi un panel revenue séparé du monolithe
--
-- - V1 (mig 80) mélangeait revenue avec users/marketplace/trust. Lecture
--   business pénible.
-- - V2 doit ventiler **XOF (CI)** vs **XAF (CG)** : techniquement
--   `montant_fcfa` est la même valeur intrinsèque (parité fixe ≈ 655.957/EUR
--   sur les deux zones CFA), mais comptablement on doit reporter séparément
--   au cabinet rwandais (cf. office-hours design doc §Premise 2).
-- - PawaPay encaisse en FCFA local — la devise se déduit de `users.pays`
--   du payeur, pas d'une colonne séparée dans `paiements_niqo` (pas besoin
--   de mig de schéma).
--
-- ## KPIs retournés
--
-- ### revenue (filtré par pays si p_pays)
-- - `total_period` : sum(montant_fcfa) statut='completed' in window
-- - `total_xof_period` : sum filter (users.pays='CI')
-- - `total_xaf_period` : sum filter (users.pays='CG')
-- - `total_eur_period` : conversion canonique (655.957)
-- - Breakdown par type (KYC / Boost7j / Boost30j) avec count + total_fcfa
-- - `monthly_history` : 12 derniers mois (mêmes ventilations XOF/XAF/EUR)
--
-- ### arpu
-- - `eur_alltime` : revenu alltime / vendeurs alltime distinct (stable)
-- - `eur_period` : revenu période / vendeurs actifs période (mouvant — proxy
--   monétisation récente). "vendeurs actifs" = a publié OU envoyé un message
--   non-systeme OU touché un RDV dans la fenêtre (sémantique mig 80 fix #1).
--
-- ### alltime
-- - `total_fcfa` : sum all completed payments
-- - `total_eur`  : conversion
-- - `vendeurs_distinct` : count distinct annonces.vendeur_id (cohorte stable)
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Drop monolithe v1 (cf. décision disruptive supra) ──────────────────────
drop function if exists public.get_admin_kpis(timestamptz, timestamptz);

create or replace function public.admin_kpis_revenue(
  p_from timestamptz default null,
  p_to   timestamptz default null,
  p_pays text        default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_eur_rate constant numeric := 655.957;

  v_now            timestamptz := now();
  v_window_start   timestamptz;
  v_window_end     timestamptz;

  -- period totals
  v_total_fcfa      int;
  v_total_xof       int;
  v_total_xaf       int;
  v_verif_count     int;
  v_verif_fcfa      int;
  v_boost7_count    int;
  v_boost7_fcfa     int;
  v_boost30_count   int;
  v_boost30_fcfa    int;

  -- alltime + arpu
  v_alltime_fcfa    int;
  v_vendeurs_active int;
  v_vendeurs_all    int;

  -- monthly history
  v_history         jsonb;
begin
  if not exists (
    select 1 from public.users where id = auth.uid() and is_admin = true
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_pays is not null and p_pays not in ('CI', 'CG') then
    raise exception 'INVALID_PAYS: % (expected CI, CG or null)', p_pays;
  end if;

  v_window_start := coalesce(p_from, v_now - interval '30 days');
  v_window_end   := coalesce(p_to,   v_now);

  if v_window_end <= v_window_start then
    raise exception 'INVALID_WINDOW: p_to (%) must be > p_from (%)',
      v_window_end, v_window_start;
  end if;

  -- ── Period totals (filtré pays via users.pays du payeur) ────────────────
  select
    coalesce(sum(p.montant_fcfa), 0)::int,
    coalesce(sum(p.montant_fcfa) filter (where u.pays = 'CI'), 0)::int,
    coalesce(sum(p.montant_fcfa) filter (where u.pays = 'CG'), 0)::int
    into v_total_fcfa, v_total_xof, v_total_xaf
    from public.paiements_niqo p
    join public.users u on u.id = p.user_id
   where p.statut = 'completed'
     and p.completed_at >= v_window_start
     and p.completed_at <  v_window_end
     and (p_pays is null or u.pays = p_pays::pays_code);

  -- Breakdown par type
  select count(*)::int, coalesce(sum(p.montant_fcfa), 0)::int
    into v_verif_count, v_verif_fcfa
    from public.paiements_niqo p
    join public.users u on u.id = p.user_id
   where p.statut = 'completed' and p.type = 'verification'
     and p.completed_at >= v_window_start and p.completed_at < v_window_end
     and (p_pays is null or u.pays = p_pays::pays_code);

  select count(*)::int, coalesce(sum(p.montant_fcfa), 0)::int
    into v_boost7_count, v_boost7_fcfa
    from public.paiements_niqo p
    join public.users u on u.id = p.user_id
   where p.statut = 'completed' and p.type = 'boost' and p.montant_fcfa = 1000
     and p.completed_at >= v_window_start and p.completed_at < v_window_end
     and (p_pays is null or u.pays = p_pays::pays_code);

  select count(*)::int, coalesce(sum(p.montant_fcfa), 0)::int
    into v_boost30_count, v_boost30_fcfa
    from public.paiements_niqo p
    join public.users u on u.id = p.user_id
   where p.statut = 'completed' and p.type = 'boost' and p.montant_fcfa = 3000
     and p.completed_at >= v_window_start and p.completed_at < v_window_end
     and (p_pays is null or u.pays = p_pays::pays_code);

  -- ── Alltime + vendeurs (pour ARPU) ──────────────────────────────────────
  select coalesce(sum(p.montant_fcfa), 0)::int into v_alltime_fcfa
    from public.paiements_niqo p
    join public.users u on u.id = p.user_id
   where p.statut = 'completed'
     and (p_pays is null or u.pays = p_pays::pays_code);

  -- Vendeurs alltime distinct (filtré pays via annonces.pays)
  select count(distinct a.vendeur_id)::int into v_vendeurs_all
    from public.annonces a
   where (p_pays is null or a.pays = p_pays::pays_code);

  -- Vendeurs actifs période (UNION 3 sources d'activité, sémantique mig 80 fix #1)
  with active_sellers as (
    select a.vendeur_id as user_id
      from public.annonces a
     where a.created_at >= v_window_start and a.created_at < v_window_end
       and (p_pays is null or a.pays = p_pays::pays_code)
    union
    select m.expediteur_id as user_id
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      join public.annonces a on a.id = c.annonce_id
     where m.created_at >= v_window_start and m.created_at < v_window_end
       and m.type <> 'systeme'
       and (p_pays is null or a.pays = p_pays::pays_code)
    union
    select c.vendeur_id as user_id
      from public.conversations c
      join public.annonces a on a.id = c.annonce_id
     where (
        (c.rdv_propose_at >= v_window_start and c.rdv_propose_at < v_window_end)
       or
        (c.rdv_confirme_at >= v_window_start and c.rdv_confirme_at < v_window_end)
     )
       and (p_pays is null or a.pays = p_pays::pays_code)
  )
  select count(distinct user_id)::int into v_vendeurs_active
    from active_sellers
   where user_id is not null;

  -- ── Monthly history (12 derniers mois, ventilé XOF/XAF) ─────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
    'month',     to_char(m.month, 'YYYY-MM'),
    'total_fcfa', coalesce(sums.total, 0),
    'xof_fcfa',   coalesce(sums.xof, 0),
    'xaf_fcfa',   coalesce(sums.xaf, 0),
    'eur',        round(coalesce(sums.total, 0)::numeric / v_eur_rate, 2)
  ) order by m.month), '[]'::jsonb) into v_history
    from generate_series(
      date_trunc('month', v_now - interval '11 months'),
      date_trunc('month', v_now),
      '1 month'::interval
    ) m(month)
    left join lateral (
      select
        sum(p.montant_fcfa)::int as total,
        sum(p.montant_fcfa) filter (where u.pays = 'CI')::int as xof,
        sum(p.montant_fcfa) filter (where u.pays = 'CG')::int as xaf
        from public.paiements_niqo p
        join public.users u on u.id = p.user_id
       where p.statut = 'completed'
         and p.completed_at >= m.month
         and p.completed_at <  m.month + interval '1 month'
         and (p_pays is null or u.pays = p_pays::pays_code)
    ) sums on true;

  -- ── Compose final JSON ──────────────────────────────────────────────────
  return jsonb_build_object(
    'generated_at', v_now,
    'window_from',  v_window_start,
    'window_to',    v_window_end,
    'pays',         coalesce(p_pays, 'ALL'),

    'revenue', jsonb_build_object(
      'total_fcfa_period', v_total_fcfa,
      'total_xof_period',  v_total_xof,
      'total_xaf_period',  v_total_xaf,
      'total_eur_period',  round(v_total_fcfa::numeric / v_eur_rate, 2),

      'verifications', jsonb_build_object(
        'count',      v_verif_count,
        'total_fcfa', v_verif_fcfa,
        'total_eur',  round(v_verif_fcfa::numeric / v_eur_rate, 2)
      ),
      'boosts_7j', jsonb_build_object(
        'count',      v_boost7_count,
        'total_fcfa', v_boost7_fcfa,
        'total_eur',  round(v_boost7_fcfa::numeric / v_eur_rate, 2)
      ),
      'boosts_30j', jsonb_build_object(
        'count',      v_boost30_count,
        'total_fcfa', v_boost30_fcfa,
        'total_eur',  round(v_boost30_fcfa::numeric / v_eur_rate, 2)
      ),

      'monthly_history', v_history
    ),

    'arpu', jsonb_build_object(
      'eur_period',  round(
        (v_total_fcfa::numeric / v_eur_rate / nullif(v_vendeurs_active, 0)), 2
      ),
      'eur_alltime', round(
        (v_alltime_fcfa::numeric / v_eur_rate / nullif(v_vendeurs_all, 0)), 2
      )
    ),

    'alltime', jsonb_build_object(
      'total_fcfa',        v_alltime_fcfa,
      'total_eur',         round(v_alltime_fcfa::numeric / v_eur_rate, 2),
      'vendeurs_distinct', v_vendeurs_all
    )
  );
end;
$$;

revoke all on function public.admin_kpis_revenue(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_kpis_revenue(timestamptz, timestamptz, text) to authenticated;

comment on function public.admin_kpis_revenue(timestamptz, timestamptz, text) is
  'Panel 3/3 dashboard admin v2 : revenue avec ventilation XOF (CI) / XAF (CG), breakdown par type (KYC/Boost7/Boost30), ARPU period+alltime, history 12 mois. Filtré par pays. Gate is_admin. Mig 113 (remplace monolithe get_admin_kpis mig 78→80 — DROPPED).';
