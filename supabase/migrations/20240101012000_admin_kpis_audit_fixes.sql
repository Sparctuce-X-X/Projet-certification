-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 80 — `get_admin_kpis(p_from, p_to)` : audit fixes + filtre flexible
--
-- Refactor de mig 79. **CRITIQUE pour le business** — la mig 79 contenait
-- 4 bugs qui faussaient les chiffres. Ce fichier corrige + assouplit le
-- filtre période.
--
-- ## Changements
--
--   1. **Signature : `p_from`/`p_to` timestamptz nullable**
--      Au lieu de `p_period text`, on prend des dates explicites. Plus
--      flexible : front peut envoyer "1er mai 2026 → 1er juin 2026" pour
--      "Mai 2026", ou "1er jan 2026 → 1er jan 2027" pour "Année 2026".
--      Defaults : `p_from = now() - 30 days`, `p_to = now()`.
--
--   2. **Fix #1 — vendeurs_actifs**
--      Avant : `where statut = 'active' OR created_at > window` → trop
--      large (un vendeur avec 1 annonce active vieille de 6 mois était
--      compté en "actif sur 30j").
--      Après : UNION de 3 sources d'activité dans la fenêtre :
--        a) a publié une annonce (annonces.created_at)
--        b) a envoyé un message non-systeme (messages.created_at)
--        c) a touché un RDV (conversations.rdv_propose_at OU rdv_confirme_at)
--      Le DISTINCT garantit qu'un vendeur n'est compté qu'une fois.
--
--   3. **Fix #2 — RDV funnel = vraie cohorte**
--      Avant : 4 compteurs filtrés indépendamment → ratio incohérents
--      (un mois pouvait afficher 120% de "completed").
--      Après : cohorte = RDV proposed dans la fenêtre. Le funnel suit
--      cette même cohorte :
--        - confirmed = de cette cohorte, combien ont rdv_confirme_at
--        - completed = de cette cohorte, combien rdv_date passé + non annulé
--        - avis      = de cette cohorte, combien ont produit ≥ 1 avis
--      Les ratios deviennent strictement bornés à 100%.
--
--   4. **Fix #3 — complete_to_avis cohérent**
--      Conséquence du fix #2 : avis comptés sur la cohorte des proposed
--      du window.
--
--   5. **Fix #4 — ARPU = alltime / vendeurs_alltime**
--      Avant : `total_revenue_alltime / vendeurs_actifs_period` → divise
--      revenu alltime par compte filtré → KPI absurde.
--      Après : `total_revenue_alltime / count_distinct_vendeurs_alltime`.
--      Vraie ARPU stable (ne change pas selon le filtre période).
--
--   6. **Top catégories** : label clarifié (front affiche "Nouvelles
--      annonces (période)" — la sémantique reste filtrer par création).
--
-- Drop l'ancienne signature `(text)` + nouveau `(timestamptz, timestamptz)`.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop versions précédentes (mig 78 et 79)
drop function if exists public.get_admin_kpis();
drop function if exists public.get_admin_kpis(text);

create or replace function public.get_admin_kpis(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_eur_rate constant numeric := 655.957;

  v_now             timestamptz := now();
  v_window_start    timestamptz;
  v_window_end      timestamptz;
  v_window_seconds  bigint;
  v_prev_start      timestamptz;
  v_prev_end        timestamptz;

  -- overview
  v_vendeurs_actifs       int;
  v_vendeurs_alltime      int;
  v_revenus_fcfa_period   int;
  v_annonces_actives      int;
  v_dau                   int;
  v_mau                   int;

  -- users
  v_total_users          int;
  v_by_ci                int;
  v_by_cg                int;
  v_new_period           int;
  v_new_prev             int;
  v_active_period        int;
  v_verified             int;
  v_suspended_auto       int;
  v_suspended_manual     int;

  -- marketplace
  v_annonces_status      jsonb;
  v_categories           jsonb;
  v_conv_period          int;

  -- RDV cohorte (sur la fenêtre)
  v_cohort_proposed      int;
  v_cohort_confirmed     int;
  v_cohort_completed     int;
  v_cohort_with_avis     int;

  -- RDV global volumes (juste pour info, indépendant du funnel)
  v_rdv_cancelled_period int;

  -- trust
  v_note_vendeur_avg     numeric;
  v_note_acheteur_avg    numeric;
  v_note_distribution    jsonb;
  v_avis_period          int;
  v_bad_reviews          int;
  v_signalements_status  jsonb;
  v_top_motifs           jsonb;

  -- revenue
  v_verif_count          int;
  v_verif_fcfa           int;
  v_boost7_count         int;
  v_boost7_fcfa          int;
  v_boost30_count        int;
  v_boost30_fcfa         int;
  v_revenue_history      jsonb;
  v_total_revenue_alltime int;

  -- alerts
  v_alert_signalements   int;
  v_alert_kyc            int;
  v_alert_suspended_30d  int;
  v_alert_boosts_stuck   int;
begin
  if not exists (
    select 1 from public.users where id = auth.uid() and is_admin = true
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  -- ── Resolve fenêtre ──────────────────────────────────────────────────────
  v_window_start := coalesce(p_from, v_now - interval '30 days');
  v_window_end   := coalesce(p_to,   v_now);

  if v_window_end <= v_window_start then
    raise exception 'INVALID_WINDOW: p_to (%) must be > p_from (%)',
      v_window_end, v_window_start;
  end if;

  -- Fenêtre précédente (de même longueur, juste avant)
  v_window_seconds := extract(epoch from (v_window_end - v_window_start))::bigint;
  v_prev_end       := v_window_start;
  v_prev_start     := v_window_start - make_interval(secs => v_window_seconds);

  -- ── Overview ─────────────────────────────────────────────────────────────

  -- FIX #1 — vendeurs_actifs : UNION distinct des sources d'activité
  -- (publication, message non-systeme, action RDV)
  with active_sellers as (
    select vendeur_id as user_id
      from public.annonces
     where created_at >= v_window_start and created_at < v_window_end
    union
    select expediteur_id as user_id
      from public.messages
     where created_at >= v_window_start
       and created_at < v_window_end
       and type <> 'systeme'
    union
    select c.vendeur_id as user_id
      from public.conversations c
     where (c.rdv_propose_at >= v_window_start and c.rdv_propose_at < v_window_end)
        or (c.rdv_confirme_at >= v_window_start and c.rdv_confirme_at < v_window_end)
  )
  select count(distinct user_id)::int into v_vendeurs_actifs
    from active_sellers
   where user_id is not null;

  -- Vendeurs alltime distinct (pour ARPU stable)
  select count(distinct vendeur_id)::int into v_vendeurs_alltime
    from public.annonces;

  select coalesce(sum(montant_fcfa), 0)::int into v_revenus_fcfa_period
    from public.paiements_niqo
   where statut = 'completed'
     and completed_at >= v_window_start
     and completed_at <  v_window_end;

  select count(*)::int into v_annonces_actives
    from public.annonces where statut = 'active';

  -- DAU/MAU sémantique propre — non filtrés par window
  select count(distinct user_id)::int into v_dau
    from public.push_tokens where last_seen_at > v_now - interval '24 hours';
  select count(distinct user_id)::int into v_mau
    from public.push_tokens where last_seen_at > v_now - interval '30 days';

  -- ── Users ────────────────────────────────────────────────────────────────
  select count(*)::int,
         count(*) filter (where pays = 'CI')::int,
         count(*) filter (where pays = 'CG')::int,
         count(*) filter (where created_at >= v_window_start and created_at < v_window_end)::int,
         count(*) filter (where is_verified = true)::int,
         count(*) filter (where is_active = false and score_abus >= 3)::int,
         count(*) filter (where is_active = false and score_abus < 3)::int
    into v_total_users, v_by_ci, v_by_cg, v_new_period,
         v_verified, v_suspended_auto, v_suspended_manual
    from public.users;

  select count(*)::int into v_new_prev
    from public.users
   where created_at >= v_prev_start and created_at < v_prev_end;

  select count(distinct expediteur_id)::int into v_active_period
    from public.messages
   where created_at >= v_window_start and created_at < v_window_end
     and type <> 'systeme';

  -- ── Marketplace ──────────────────────────────────────────────────────────
  select jsonb_build_object(
    'active',    count(*) filter (where statut = 'active'),
    'en_cours',  count(*) filter (where statut = 'en_cours'),
    'vendue',    count(*) filter (where statut = 'vendue'),
    'expiree',   count(*) filter (where statut = 'expiree'),
    'suspendue', count(*) filter (where statut = 'suspendue')
  ) into v_annonces_status
    from public.annonces;

  -- Catégories : nouvelles annonces dans la période (label clarifié front)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',    c.id,
    'nom',   c.nom,
    'icone', c.icone,
    'count', sub.cnt
  ) order by sub.cnt desc), '[]'::jsonb) into v_categories
    from public.categories c
    left join lateral (
      select count(*)::int as cnt
        from public.annonces a
       where a.categorie_id = c.id
         and a.created_at >= v_window_start
         and a.created_at <  v_window_end
    ) sub on true;

  select count(*)::int into v_conv_period
    from public.conversations
   where created_at >= v_window_start and created_at < v_window_end;

  -- FIX #2 — RDV funnel = COHORTE des proposés dans la fenêtre
  -- On suit cette cohorte sur tous les états aval, peu importe quand
  -- l'événement est arrivé (tant que c'est avant v_window_end).
  --
  -- Le RDV est dans la cohorte ssi rdv_propose_at est dans [start, end[.
  -- - confirmed_in_cohort = ce sous-ensemble + rdv_confirme_at not null
  --   (peu importe quand confirmé, tant que c'est arrivé)
  -- - completed_in_cohort = ce sous-ensemble + rdv_date passé + non annulé
  -- - with_avis_in_cohort = ce sous-ensemble + ≥ 1 avis sur la conversation
  with cohort as (
    select c.id, c.rdv_confirme_at, c.rdv_annule_at, c.rdv_date
      from public.conversations c
     where c.rdv_propose_at >= v_window_start
       and c.rdv_propose_at <  v_window_end
  )
  select
    count(*)::int,
    count(*) filter (where rdv_confirme_at is not null)::int,
    count(*) filter (where rdv_confirme_at is not null
                       and rdv_annule_at is null
                       and rdv_date is not null
                       and rdv_date < v_now)::int,
    count(*) filter (
      where exists (select 1 from public.avis a where a.conversation_id = cohort.id)
    )::int
    into v_cohort_proposed, v_cohort_confirmed, v_cohort_completed, v_cohort_with_avis
    from cohort;

  -- Annulations dans la fenêtre (info séparée — ne fait pas partie du funnel
  -- cohorte stricto sensu car un RDV peut être annulé après proposition d'une
  -- autre fenêtre)
  select count(*)::int into v_rdv_cancelled_period
    from public.conversations
   where rdv_annule_at >= v_window_start
     and rdv_annule_at <  v_window_end;

  -- ── Trust ────────────────────────────────────────────────────────────────
  select round(avg(note_vendeur)::numeric, 2)
    into v_note_vendeur_avg
    from public.users where note_vendeur > 0;

  select round(avg(note_acheteur)::numeric, 2)
    into v_note_acheteur_avg
    from public.users where note_acheteur > 0;

  select count(*)::int,
         count(*) filter (where note <= 2)::int
    into v_avis_period, v_bad_reviews
    from public.avis
   where created_at >= v_window_start and created_at < v_window_end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'note',  n,
    'count', coalesce((select count(*) from public.avis where note = n), 0)
  ) order by n), '[]'::jsonb) into v_note_distribution
    from generate_series(1, 5) n;

  select jsonb_build_object(
    'pending', count(*) filter (where statut = 'en_attente'),
    'traite',  count(*) filter (where statut = 'traite'),
    'rejete',  count(*) filter (where statut = 'rejete')
  ) into v_signalements_status
    from public.signalements
   where created_at >= v_window_start and created_at < v_window_end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'motif', motif,
    'count', cnt
  ) order by cnt desc), '[]'::jsonb) into v_top_motifs
    from (
      select motif, count(*)::int as cnt
        from public.signalements
       where created_at >= v_window_start and created_at < v_window_end
       group by motif
       order by cnt desc
       limit 5
    ) t;

  -- ── Revenue ──────────────────────────────────────────────────────────────
  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_verif_count, v_verif_fcfa
    from public.paiements_niqo
   where statut = 'completed' and type = 'verification'
     and completed_at >= v_window_start and completed_at < v_window_end;

  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_boost7_count, v_boost7_fcfa
    from public.paiements_niqo
   where statut = 'completed' and type = 'boost' and montant_fcfa = 1000
     and completed_at >= v_window_start and completed_at < v_window_end;

  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_boost30_count, v_boost30_fcfa
    from public.paiements_niqo
   where statut = 'completed' and type = 'boost' and montant_fcfa = 3000
     and completed_at >= v_window_start and completed_at < v_window_end;

  -- monthly_history : 12 derniers mois (étendu vs mig 79 — picker mois
  -- ouvre jusqu'à 12 mois, autant montrer la même profondeur côté chart)
  select coalesce(jsonb_agg(jsonb_build_object(
    'month',   to_char(m.month, 'YYYY-MM'),
    'net_eur', round(coalesce(sum_fcfa, 0)::numeric / v_eur_rate, 2)
  ) order by m.month), '[]'::jsonb) into v_revenue_history
    from generate_series(
      date_trunc('month', v_now - interval '11 months'),
      date_trunc('month', v_now),
      '1 month'::interval
    ) m(month)
    left join lateral (
      select sum(montant_fcfa)::int as sum_fcfa
        from public.paiements_niqo
       where statut = 'completed'
         and completed_at >= m.month
         and completed_at <  m.month + interval '1 month'
    ) p on true;

  select coalesce(sum(montant_fcfa), 0)::int into v_total_revenue_alltime
    from public.paiements_niqo where statut = 'completed';

  -- ── Moderation alerts (état présent, pas filtré) ─────────────────────────
  select count(*)::int into v_alert_signalements
    from public.signalements
   where statut = 'en_attente' and created_at < v_now - interval '24 hours';

  select count(*)::int into v_alert_kyc
    from public.verifications_identite
   where statut = 'pending' and created_at < v_now - interval '48 hours';

  select count(*)::int into v_alert_suspended_30d
    from public.users
   where is_active = false and updated_at > v_now - interval '30 days';

  select count(*)::int into v_alert_boosts_stuck
    from public.paiements_niqo
   where type = 'boost' and statut = 'pending'
     and created_at < v_now - interval '1 hour';

  -- ── Compose final JSON ──────────────────────────────────────────────────
  return jsonb_build_object(
    'generated_at',  v_now,
    'window_from',   v_window_start,
    'window_to',     v_window_end,

    'overview', jsonb_build_object(
      'vendeurs_actifs_period',  v_vendeurs_actifs,
      'revenus_fcfa_period',     v_revenus_fcfa_period,
      'revenus_eur_period',      round(v_revenus_fcfa_period::numeric / v_eur_rate, 2),
      'annonces_actives_total',  v_annonces_actives,
      'dau', v_dau,
      'mau', v_mau
    ),

    'users', jsonb_build_object(
      'total',                v_total_users,
      'by_country',           jsonb_build_object('CI', v_by_ci, 'CG', v_by_cg),
      'new_period',           v_new_period,
      'new_period_delta_pct', case
        when v_new_prev = 0 and v_new_period = 0 then 0
        when v_new_prev = 0 then 100
        else round(((v_new_period - v_new_prev)::numeric / v_new_prev * 100)::numeric, 0)
      end,
      'active_period',        v_active_period,
      'verified',             v_verified,
      'verified_pct',         case when v_total_users = 0 then 0
                                   else round((v_verified::numeric / v_total_users * 100)::numeric, 1)
                              end,
      'suspended', jsonb_build_object(
        'auto_score',   v_suspended_auto,
        'admin_manual', v_suspended_manual
      )
    ),

    'marketplace', jsonb_build_object(
      'annonces_by_status',   v_annonces_status,
      'annonces_by_category', v_categories,
      'conversations_period', v_conv_period,
      'rdv', jsonb_build_object(
        'proposed_in_cohort',  v_cohort_proposed,
        'confirmed_in_cohort', v_cohort_confirmed,
        'completed_in_cohort', v_cohort_completed,
        'with_avis_in_cohort', v_cohort_with_avis,
        'cancelled_in_period', v_rdv_cancelled_period
      ),
      -- Funnel : cohorte des RDV proposés dans la fenêtre. Tous les
      -- ratios sont strictement bornés à 100% (numérateur ⊆ dénominateur).
      'funnel', jsonb_build_object(
        'conv_to_proposed_pct', case when v_conv_period = 0 then 0
                                     else round((v_cohort_proposed::numeric / v_conv_period * 100)::numeric, 1)
                                end,
        'proposed_to_confirmed_pct', case when v_cohort_proposed = 0 then 0
                                          else round((v_cohort_confirmed::numeric / v_cohort_proposed * 100)::numeric, 1)
                                     end,
        'confirmed_to_completed_pct', case when v_cohort_confirmed = 0 then 0
                                           else round((v_cohort_completed::numeric / v_cohort_confirmed * 100)::numeric, 1)
                                      end,
        'completed_to_avis_pct',     case when v_cohort_completed = 0 then 0
                                          else round((v_cohort_with_avis::numeric / v_cohort_completed * 100)::numeric, 1)
                                     end
      )
    ),

    'trust', jsonb_build_object(
      'note_vendeur_avg',    coalesce(v_note_vendeur_avg, 0),
      'note_acheteur_avg',   coalesce(v_note_acheteur_avg, 0),
      'note_distribution',   v_note_distribution,
      'avis_period',         v_avis_period,
      'bad_reviews_pct',     case when v_avis_period = 0 then 0
                                  else round((v_bad_reviews::numeric / v_avis_period * 100)::numeric, 1)
                             end,
      'signalements_period', v_signalements_status,
      'top_motifs_period',   v_top_motifs
    ),

    'revenue', jsonb_build_object(
      'verifications', jsonb_build_object(
        'count',     v_verif_count,
        'total_fcfa', v_verif_fcfa,
        'total_eur',  round(v_verif_fcfa::numeric / v_eur_rate, 2)
      ),
      'boosts_7j', jsonb_build_object(
        'count',     v_boost7_count,
        'total_fcfa', v_boost7_fcfa,
        'total_eur',  round(v_boost7_fcfa::numeric / v_eur_rate, 2)
      ),
      'boosts_30j', jsonb_build_object(
        'count',     v_boost30_count,
        'total_fcfa', v_boost30_fcfa,
        'total_eur',  round(v_boost30_fcfa::numeric / v_eur_rate, 2)
      ),
      'monthly_history',    v_revenue_history,
      'total_alltime_eur',  round(v_total_revenue_alltime::numeric / v_eur_rate, 2),
      -- FIX #4 — ARPU = revenu alltime / vendeurs alltime (KPI stable,
      -- ne change pas selon la période sélectionnée)
      'arpu_eur_alltime',   case when v_vendeurs_alltime = 0 then 0
                                 else round(
                                   (v_total_revenue_alltime::numeric / v_eur_rate / v_vendeurs_alltime)::numeric, 2
                                 )
                            end,
      -- ARPU période (revenu période / vendeurs actifs période) —
      -- complément utile pour mesurer la monétisation récente
      'arpu_eur_period',    case when v_vendeurs_actifs = 0 then 0
                                 else round(
                                   (v_revenus_fcfa_period::numeric / v_eur_rate / v_vendeurs_actifs)::numeric, 2
                                 )
                            end
    ),

    'moderation_alerts', jsonb_build_object(
      'signalements_pending_24h_plus', v_alert_signalements,
      'kyc_pending_48h_plus',          v_alert_kyc,
      'suspended_accounts_30d',        v_alert_suspended_30d,
      'boosts_stuck_pending',          v_alert_boosts_stuck,
      'total',                         v_alert_signalements
                                       + v_alert_kyc
                                       + v_alert_suspended_30d
                                       + v_alert_boosts_stuck
    )
  );
end;
$$;

revoke all on function public.get_admin_kpis(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_admin_kpis(timestamptz, timestamptz) to authenticated;

comment on function public.get_admin_kpis(timestamptz, timestamptz) is
  'Dashboard KPIs back-office /admin/kpis avec fenêtre temporelle [p_from, p_to[. Defaults = 30 derniers jours. Gate is_admin. Fix bugs review #1 vs mig 78/79 : vendeurs_actifs UNION 3 sources, RDV funnel = cohorte stricte, ARPU alltime stable.';
