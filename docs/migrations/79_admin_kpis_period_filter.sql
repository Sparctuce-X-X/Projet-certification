-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 79 — `get_admin_kpis(p_period)` : filtre période + drop targets
--
-- 2 changements vs mig 78 :
--
--   1. **Param `p_period text`** : '30d' (default) | '90d' | '12m' | 'all'.
--      Définit la fenêtre temporelle pour les agrégations "période-dépendantes"
--      (revenus, nouveaux users, signalements, RDV, conversations, paiements).
--      Les agrégations "état présent" (annonces actives, total users, scores,
--      vérifiés, modération alerts) ne sont PAS affectées — la période n'a
--      pas de sens pour elles.
--
--   2. **Drop section `targets`** : les cibles M6/M12 du CDC §6 ont été
--      jugées peu pertinentes par le fondateur. Le dashboard se concentre
--      sur les chiffres réels, pas sur la progression vs cibles théoriques.
--
-- Renommages JSON :
--   - overview.revenus_fcfa_mois  → overview.revenus_fcfa_period
--   - overview.revenus_eur_mois   → overview.revenus_eur_period
--   - overview.vendeurs_actifs_mois → overview.vendeurs_actifs_period
--   - users.new_7d / new_30d      → users.new_period (+ delta vs périod précédente)
--   - users.active_30d            → users.active_period
--   - trust.avis_total            → trust.avis_period
--   - trust.signalements          → trust.signalements_period
--   - trust.top_motifs            → trust.top_motifs_period
--   - revenue.verifications/boosts_*  → versions period
--   - revenue.monthly_history reste 6 mois fixes (indépendant de p_period)
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_admin_kpis(
  p_period text default '30d'
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  -- ── Constantes
  v_eur_rate         constant numeric := 655.957;

  -- ── Buffers
  v_now              timestamptz := now();
  v_period_label     text;
  v_window_start     timestamptz;  -- début de la fenêtre courante
  v_prev_start       timestamptz;  -- début de la fenêtre précédente (pour delta)
  v_prev_end         timestamptz;  -- fin de la fenêtre précédente (= v_window_start)

  -- overview
  v_vendeurs_actifs      int;
  v_revenus_fcfa_period  int;
  v_annonces_actives     int;
  v_dau                  int;
  v_mau                  int;

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
  v_rdv_proposed         int;
  v_rdv_confirmed        int;
  v_rdv_cancelled        int;
  v_rdv_completed        int;
  v_avis_in_period       int;

  -- trust
  v_note_vendeur_avg     numeric;
  v_note_acheteur_avg    numeric;
  v_note_distribution    jsonb;
  v_avis_count           int;
  v_avis_distinct_rdv    int;
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
  -- ── Gate admin ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.users where id = auth.uid() and is_admin = true
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  -- ── Resolve période ─────────────────────────────────────────────────────
  case lower(coalesce(p_period, '30d'))
    when '30d' then
      v_window_start := v_now - interval '30 days';
      v_prev_start   := v_now - interval '60 days';
      v_period_label := '30d';
    when '90d' then
      v_window_start := v_now - interval '90 days';
      v_prev_start   := v_now - interval '180 days';
      v_period_label := '90d';
    when '12m' then
      v_window_start := v_now - interval '12 months';
      v_prev_start   := v_now - interval '24 months';
      v_period_label := '12m';
    when 'all' then
      v_window_start := 'epoch'::timestamptz;
      v_prev_start   := 'epoch'::timestamptz;  -- delta n'a pas de sens en alltime
      v_period_label := 'all';
    else
      raise exception 'INVALID_PERIOD: %, expected 30d|90d|12m|all', p_period;
  end case;
  v_prev_end := v_window_start;

  -- ── Overview ────────────────────────────────────────────────────────────
  -- Vendeurs actifs sur la période = distinct vendeur_id qui a une annonce
  -- active OU a créé une annonce dans la fenêtre.
  select count(distinct vendeur_id) into v_vendeurs_actifs
    from public.annonces
   where statut = 'active'
      or created_at > v_window_start;

  select coalesce(sum(montant_fcfa), 0)::int into v_revenus_fcfa_period
    from public.paiements_niqo
   where statut = 'completed'
     and completed_at >= v_window_start;

  select count(*)::int into v_annonces_actives
    from public.annonces
   where statut = 'active';

  -- DAU/MAU = sémantique propre (24h / 30j) — pas affecté par p_period
  select count(distinct user_id)::int into v_dau
    from public.push_tokens
   where last_seen_at > v_now - interval '24 hours';

  select count(distinct user_id)::int into v_mau
    from public.push_tokens
   where last_seen_at > v_now - interval '30 days';

  -- ── Users ───────────────────────────────────────────────────────────────
  select count(*)::int,
         count(*) filter (where pays = 'CI')::int,
         count(*) filter (where pays = 'CG')::int,
         count(*) filter (where created_at > v_window_start)::int,
         count(*) filter (where is_verified = true)::int,
         count(*) filter (where is_active = false and score_abus >= 3)::int,
         count(*) filter (where is_active = false and score_abus < 3)::int
    into v_total_users, v_by_ci, v_by_cg, v_new_period,
         v_verified, v_suspended_auto, v_suspended_manual
    from public.users;

  -- New période précédente (pour delta %)
  select count(*)::int into v_new_prev
    from public.users
   where created_at > v_prev_start
     and created_at <= v_prev_end;

  select count(distinct expediteur_id)::int into v_active_period
    from public.messages
   where created_at > v_window_start
     and type <> 'systeme';

  -- ── Marketplace ─────────────────────────────────────────────────────────
  select jsonb_build_object(
    'active',    count(*) filter (where statut = 'active'),
    'en_cours',  count(*) filter (where statut = 'en_cours'),
    'vendue',    count(*) filter (where statut = 'vendue'),
    'expiree',   count(*) filter (where statut = 'expiree'),
    'suspendue', count(*) filter (where statut = 'suspendue')
  ) into v_annonces_status
    from public.annonces;

  -- Catégories : on filtre les annonces dans la période (sauf si 'all')
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
         and a.created_at > v_window_start
    ) sub on true;

  select count(*)::int into v_conv_period
    from public.conversations
   where created_at > v_window_start;

  -- RDV : on regarde les conversations dont le RDV a été touché dans la
  -- période (proposé/confirmé/annulé). Pour completed : date passée + non
  -- annulé + dans la fenêtre.
  select
    count(*) filter (where rdv_propose_at > v_window_start)::int,
    count(*) filter (where rdv_confirme_at > v_window_start)::int,
    count(*) filter (where rdv_annule_at > v_window_start)::int,
    count(*) filter (where rdv_confirme_at is not null
                       and rdv_annule_at is null
                       and rdv_date is not null
                       and rdv_date < v_now
                       and rdv_date > v_window_start)::int
    into v_rdv_proposed, v_rdv_confirmed, v_rdv_cancelled, v_rdv_completed
    from public.conversations;

  select count(*)::int,
         count(distinct conversation_id)::int
    into v_avis_count, v_avis_distinct_rdv
    from public.avis
   where created_at > v_window_start;

  v_avis_in_period := v_avis_distinct_rdv;

  -- ── Trust ───────────────────────────────────────────────────────────────
  -- Notes moyennes : alltime (un user a sa note actuelle, pas une note "dans
  -- la période")
  select round(avg(note_vendeur)::numeric, 2)
    into v_note_vendeur_avg
    from public.users where note_vendeur > 0;

  select round(avg(note_acheteur)::numeric, 2)
    into v_note_acheteur_avg
    from public.users where note_acheteur > 0;

  -- bad_reviews_pct calculé sur les avis de la période
  select count(*) filter (where note <= 2)::int
    into v_bad_reviews
    from public.avis where created_at > v_window_start;

  -- Distribution notes : on garde alltime (sinon période courte = vide)
  select coalesce(jsonb_agg(jsonb_build_object(
    'note',  n,
    'count', coalesce((select count(*) from public.avis where note = n), 0)
  ) order by n), '[]'::jsonb) into v_note_distribution
    from generate_series(1, 5) n;

  -- Signalements : filtrés par période
  select jsonb_build_object(
    'pending', count(*) filter (where statut = 'en_attente'),
    'traite',  count(*) filter (where statut = 'traite'),
    'rejete',  count(*) filter (where statut = 'rejete')
  ) into v_signalements_status
    from public.signalements
   where created_at > v_window_start;

  -- Top motifs : filtrés par période
  select coalesce(jsonb_agg(jsonb_build_object(
    'motif', motif,
    'count', cnt
  ) order by cnt desc), '[]'::jsonb) into v_top_motifs
    from (
      select motif, count(*)::int as cnt
        from public.signalements
       where created_at > v_window_start
       group by motif
       order by cnt desc
       limit 5
    ) t;

  -- ── Revenue ─────────────────────────────────────────────────────────────
  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_verif_count, v_verif_fcfa
    from public.paiements_niqo
   where statut = 'completed'
     and type = 'verification'
     and completed_at >= v_window_start;

  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_boost7_count, v_boost7_fcfa
    from public.paiements_niqo
   where statut = 'completed'
     and type = 'boost'
     and montant_fcfa = 1000
     and completed_at >= v_window_start;

  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_boost30_count, v_boost30_fcfa
    from public.paiements_niqo
   where statut = 'completed'
     and type = 'boost'
     and montant_fcfa = 3000
     and completed_at >= v_window_start;

  -- monthly_history : toujours 6 mois fixes (vue temporelle indépendante du
  -- filtre période — sinon l'admin ne voit jamais l'historique)
  select coalesce(jsonb_agg(jsonb_build_object(
    'month',   to_char(m.month, 'YYYY-MM'),
    'net_eur', round(coalesce(sum_fcfa, 0)::numeric / v_eur_rate, 2)
  ) order by m.month), '[]'::jsonb) into v_revenue_history
    from generate_series(
      date_trunc('month', v_now - interval '5 months'),
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

  -- ── Moderation alerts (toujours "à traiter maintenant" — pas filtrés) ──
  select count(*)::int into v_alert_signalements
    from public.signalements
   where statut = 'en_attente'
     and created_at < v_now - interval '24 hours';

  select count(*)::int into v_alert_kyc
    from public.verifications_identite
   where statut = 'pending'
     and created_at < v_now - interval '48 hours';

  select count(*)::int into v_alert_suspended_30d
    from public.users
   where is_active = false
     and updated_at > v_now - interval '30 days';

  select count(*)::int into v_alert_boosts_stuck
    from public.paiements_niqo
   where type = 'boost'
     and statut = 'pending'
     and created_at < v_now - interval '1 hour';

  -- ── Compose final JSON ──────────────────────────────────────────────────
  return jsonb_build_object(
    'generated_at', v_now,
    'period',       v_period_label,

    'overview', jsonb_build_object(
      'vendeurs_actifs_period',  v_vendeurs_actifs,
      'revenus_fcfa_period',     v_revenus_fcfa_period,
      'revenus_eur_period',      round(v_revenus_fcfa_period::numeric / v_eur_rate, 2),
      'annonces_actives_total',  v_annonces_actives,
      'dau', v_dau,
      'mau', v_mau
    ),

    'users', jsonb_build_object(
      'total',         v_total_users,
      'by_country',    jsonb_build_object('CI', v_by_ci, 'CG', v_by_cg),
      'new_period',    v_new_period,
      'new_period_delta_pct', case
        when v_period_label = 'all' then null
        when v_new_prev = 0 and v_new_period = 0 then 0
        when v_new_prev = 0 then 100
        else round(((v_new_period - v_new_prev)::numeric / v_new_prev * 100)::numeric, 0)
      end,
      'active_period', v_active_period,
      'verified',      v_verified,
      'verified_pct',  case when v_total_users = 0 then 0
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
        'proposed',  v_rdv_proposed,
        'confirmed', v_rdv_confirmed,
        'cancelled', v_rdv_cancelled,
        'completed', v_rdv_completed
      ),
      'funnel', jsonb_build_object(
        'conv_to_rdv_pct',     case when v_conv_period = 0 then 0
                                    else round((v_rdv_proposed::numeric / v_conv_period * 100)::numeric, 1)
                               end,
        'rdv_to_complete_pct', case when v_rdv_confirmed = 0 then 0
                                    else round((v_rdv_completed::numeric / v_rdv_confirmed * 100)::numeric, 1)
                               end,
        'complete_to_avis_pct', case when v_rdv_completed = 0 then 0
                                     else round((v_avis_in_period::numeric / v_rdv_completed * 100)::numeric, 1)
                                end
      )
    ),

    'trust', jsonb_build_object(
      'note_vendeur_avg',   coalesce(v_note_vendeur_avg, 0),
      'note_acheteur_avg',  coalesce(v_note_acheteur_avg, 0),
      'note_distribution',  v_note_distribution,
      'avis_period',        v_avis_count,
      'bad_reviews_pct',    case when v_avis_count = 0 then 0
                                 else round((v_bad_reviews::numeric / v_avis_count * 100)::numeric, 1)
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
        'count',      v_boost7_count,
        'total_fcfa', v_boost7_fcfa,
        'total_eur',  round(v_boost7_fcfa::numeric / v_eur_rate, 2)
      ),
      'boosts_30j', jsonb_build_object(
        'count',      v_boost30_count,
        'total_fcfa', v_boost30_fcfa,
        'total_eur',  round(v_boost30_fcfa::numeric / v_eur_rate, 2)
      ),
      'monthly_history',    v_revenue_history,
      'total_alltime_eur',  round(v_total_revenue_alltime::numeric / v_eur_rate, 2),
      'arpu_eur',           case when v_vendeurs_actifs = 0 then 0
                                 else round(
                                   (v_total_revenue_alltime::numeric / v_eur_rate / v_vendeurs_actifs)::numeric, 2
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

-- L'ancienne signature sans param a été remplacée. On drop l'ancienne
-- version explicitement au cas où elle persisterait avec une signature
-- différente (Postgres garde les overloads).
drop function if exists public.get_admin_kpis();

revoke all on function public.get_admin_kpis(text) from public, anon;
grant execute on function public.get_admin_kpis(text) to authenticated;

comment on function public.get_admin_kpis(text) is
  'Dashboard KPIs back-office /admin/kpis avec filtre période. p_period in (30d, 90d, 12m, all). Gate is_admin.';
