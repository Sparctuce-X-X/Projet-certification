-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 78 — RPC `get_admin_kpis()` (back-office /admin/kpis)
--
-- Source unique pour le dashboard admin web. Retourne un JSON avec :
--   - overview     : 4 KPIs hero (vendeurs M, revenus M, % vérifiés, annonces actives)
--   - targets      : achievement vs cibles CDC §6 M6 (revenus, vendeurs, vérifiés)
--   - users        : total / par pays / nouveaux / actifs / vérifiés / suspendus
--   - marketplace  : annonces par statut + funnel RDV + top catégories
--   - trust        : notes vendeur/acheteur + distribution + signalements
--   - revenue      : verif + boost7j + boost30j + historique 6 mois + ARPU
--   - moderation_alerts : compteurs items à traiter (signalements, KYC, etc.)
--
-- Gate : `is_admin = true` côté caller (sinon EXCEPTION ADMIN_REQUIRED).
-- SECURITY DEFINER : bypass RLS pour pouvoir agréger sans devoir donner
-- des SELECT cross-user à l'admin web.
--
-- Performance : lourd (multi-aggregations). Pour MVP appel 1×/sem côté admin
-- web, c'est OK (pas en hot path). Si ça devient lent, on cache via une
-- materialized view rafraîchie chaque heure.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_admin_kpis()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  -- ── Constantes
  v_eur_rate         constant numeric := 655.957;  -- 1 EUR = 655.957 FCFA (fixed XOF/XAF)
  v_target_revenus   constant int     := 500;      -- € à M6 (CDC §6)
  v_target_vendeurs  constant int     := 700;      -- vendeurs actifs à M6
  v_target_verif_pct constant int     := 15;       -- % vérifiés à M6

  -- ── Buffers
  v_now                  timestamptz := now();
  v_month_start          timestamptz := date_trunc('month', v_now);

  -- overview
  v_vendeurs_actifs      int;
  v_revenus_fcfa_mois    int;
  v_annonces_actives     int;
  v_dau                  int;
  v_mau                  int;

  -- users
  v_total_users          int;
  v_by_ci                int;
  v_by_cg                int;
  v_new_7d               int;
  v_new_30d              int;
  v_active_30d           int;
  v_verified             int;
  v_suspended_auto       int;
  v_suspended_manual     int;

  -- marketplace
  v_annonces_status      jsonb;
  v_categories           jsonb;
  v_conv_total           int;
  v_rdv_proposed         int;
  v_rdv_confirmed        int;
  v_rdv_cancelled        int;
  v_rdv_completed        int;
  v_avis_total           int;

  -- trust
  v_note_vendeur_avg     numeric;
  v_note_acheteur_avg    numeric;
  v_note_distribution    jsonb;
  v_avis_count           int;
  v_avis_distinct_rdv    int;  -- distinct conversation_id (1 RDV peut avoir 2 avis)
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

  -- ── Overview ────────────────────────────────────────────────────────────
  -- Vendeurs actifs M = distinct vendeur_id qui a une annonce active OU a
  -- créé une annonce dans les 30 derniers jours (proxy de l'activité).
  select count(distinct vendeur_id) into v_vendeurs_actifs
    from public.annonces
   where statut = 'active'
      or created_at > v_now - interval '30 days';

  select coalesce(sum(montant_fcfa), 0)::int into v_revenus_fcfa_mois
    from public.paiements_niqo
   where statut = 'completed'
     and completed_at >= v_month_start;

  select count(*)::int into v_annonces_actives
    from public.annonces
   where statut = 'active';

  -- DAU/MAU via push_tokens.last_seen_at (proxy device actif)
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
         count(*) filter (where created_at > v_now - interval '7 days')::int,
         count(*) filter (where created_at > v_now - interval '30 days')::int,
         count(*) filter (where is_verified = true)::int,
         count(*) filter (where is_active = false and score_abus >= 3)::int,
         count(*) filter (where is_active = false and score_abus < 3)::int
    into v_total_users, v_by_ci, v_by_cg, v_new_7d, v_new_30d,
         v_verified, v_suspended_auto, v_suspended_manual
    from public.users;

  -- Actifs 30j = distinct user_id auteur d'au moins 1 message ces 30j (vrai
  -- engagement, pas juste un device qui ping). On exclut les messages
  -- système (notifs RDV/automatiques) qui ne reflètent pas une action user.
  select count(distinct expediteur_id)::int into v_active_30d
    from public.messages
   where created_at > v_now - interval '30 days'
     and type <> 'systeme';

  -- ── Marketplace ─────────────────────────────────────────────────────────
  -- Annonces par statut (5 statuts possibles)
  select jsonb_build_object(
    'active',    count(*) filter (where statut = 'active'),
    'en_cours',  count(*) filter (where statut = 'en_cours'),
    'vendue',    count(*) filter (where statut = 'vendue'),
    'expiree',   count(*) filter (where statut = 'expiree'),
    'suspendue', count(*) filter (where statut = 'suspendue')
  ) into v_annonces_status
    from public.annonces;

  -- Top 11 catégories par nombre d'annonces total
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
    ) sub on true;

  select count(*)::int into v_conv_total from public.conversations;

  select
    count(*) filter (where rdv_propose_at is not null)::int,
    count(*) filter (where rdv_confirme_at is not null)::int,
    count(*) filter (where rdv_annule_at is not null)::int,
    count(*) filter (where rdv_confirme_at is not null
                       and rdv_annule_at is null
                       and rdv_date is not null
                       and rdv_date < v_now)::int
    into v_rdv_proposed, v_rdv_confirmed, v_rdv_cancelled, v_rdv_completed
    from public.conversations;

  select count(*)::int,
         count(distinct conversation_id)::int
    into v_avis_total, v_avis_distinct_rdv
    from public.avis;

  -- ── Trust ───────────────────────────────────────────────────────────────
  select round(avg(note_vendeur)::numeric, 2)
    into v_note_vendeur_avg
    from public.users where note_vendeur > 0;

  select round(avg(note_acheteur)::numeric, 2)
    into v_note_acheteur_avg
    from public.users where note_acheteur > 0;

  select count(*)::int,
         count(*) filter (where note <= 2)::int
    into v_avis_count, v_bad_reviews
    from public.avis;

  -- Distribution notes 1 → 5 (jsonb array ordonné)
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
    from public.signalements;

  -- Top 5 motifs (motif est text libre, pas un enum)
  select coalesce(jsonb_agg(jsonb_build_object(
    'motif', motif,
    'count', cnt
  ) order by cnt desc), '[]'::jsonb) into v_top_motifs
    from (
      select motif, count(*)::int as cnt
        from public.signalements
       group by motif
       order by cnt desc
       limit 5
    ) t;

  -- ── Revenue ─────────────────────────────────────────────────────────────
  -- Verifications (1000 FCFA fixed)
  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_verif_count, v_verif_fcfa
    from public.paiements_niqo
   where statut = 'completed' and type = 'verification';

  -- Boost 7j (1000 FCFA) vs 30j (3000 FCFA) — distingués par montant
  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_boost7_count, v_boost7_fcfa
    from public.paiements_niqo
   where statut = 'completed' and type = 'boost' and montant_fcfa = 1000;

  select count(*)::int, coalesce(sum(montant_fcfa), 0)::int
    into v_boost30_count, v_boost30_fcfa
    from public.paiements_niqo
   where statut = 'completed' and type = 'boost' and montant_fcfa = 3000;

  -- Historique 6 derniers mois (rempli avec 0 pour les mois sans paiement)
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

  -- ── Moderation alerts ───────────────────────────────────────────────────
  select count(*)::int into v_alert_signalements
    from public.signalements
   where statut = 'en_attente'
     and created_at < v_now - interval '24 hours';

  select count(*)::int into v_alert_kyc
    from public.verifications_identite
   where statut = 'pending'
     and created_at < v_now - interval '48 hours';

  -- Suspendus dans les 30 derniers jours (proxy : updated_at sur user où
  -- is_active passé à false). Imprécis — un user qui change d'avatar avec
  -- is_active=false résettrait updated_at. Pour MVP suffisant.
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

    'overview', jsonb_build_object(
      'vendeurs_actifs_mois',  v_vendeurs_actifs,
      'revenus_fcfa_mois',     v_revenus_fcfa_mois,
      'revenus_eur_mois',      round(v_revenus_fcfa_mois::numeric / v_eur_rate, 2),
      'annonces_actives_total', v_annonces_actives,
      'dau', v_dau,
      'mau', v_mau
    ),

    'targets', jsonb_build_object(
      'revenus_eur_target_m6', v_target_revenus,
      'revenus_eur_current',   round(v_revenus_fcfa_mois::numeric / v_eur_rate, 2),
      'revenus_achieved_pct',  least(100, round(
        (v_revenus_fcfa_mois::numeric / v_eur_rate / v_target_revenus * 100)::numeric, 0
      )),

      'vendeurs_target_m6',    v_target_vendeurs,
      'vendeurs_current',      v_vendeurs_actifs,
      'vendeurs_achieved_pct', least(100, round(
        (v_vendeurs_actifs::numeric / v_target_vendeurs * 100)::numeric, 0
      )),

      'verified_target_pct_m6', v_target_verif_pct,
      'verified_current_pct',   case when v_total_users = 0 then 0
                                     else round((v_verified::numeric / v_total_users * 100)::numeric, 0)
                                end,
      'verified_achieved_pct',  case when v_total_users = 0 then 0
                                     else least(100, round(
                                       ((v_verified::numeric / v_total_users * 100) / v_target_verif_pct * 100)::numeric, 0
                                     ))
                                end
    ),

    'users', jsonb_build_object(
      'total',         v_total_users,
      'by_country',    jsonb_build_object('CI', v_by_ci, 'CG', v_by_cg),
      'new_7d',        v_new_7d,
      'new_30d',       v_new_30d,
      'active_30d',    v_active_30d,
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
      'conversations_total',  v_conv_total,
      'rdv', jsonb_build_object(
        'proposed',  v_rdv_proposed,
        'confirmed', v_rdv_confirmed,
        'cancelled', v_rdv_cancelled,
        'completed', v_rdv_completed
      ),
      'funnel', jsonb_build_object(
        'conv_to_rdv_pct',     case when v_conv_total = 0 then 0
                                    else round((v_rdv_proposed::numeric / v_conv_total * 100)::numeric, 1)
                               end,
        'rdv_to_complete_pct', case when v_rdv_confirmed = 0 then 0
                                    else round((v_rdv_completed::numeric / v_rdv_confirmed * 100)::numeric, 1)
                               end,
        'complete_to_avis_pct', case when v_rdv_completed = 0 then 0
                                     else round((v_avis_distinct_rdv::numeric / v_rdv_completed * 100)::numeric, 1)
                                end
      )
    ),

    'trust', jsonb_build_object(
      'note_vendeur_avg',   coalesce(v_note_vendeur_avg, 0),
      'note_acheteur_avg',  coalesce(v_note_acheteur_avg, 0),
      'note_distribution',  v_note_distribution,
      'avis_total',         v_avis_count,
      'bad_reviews_pct',    case when v_avis_count = 0 then 0
                                 else round((v_bad_reviews::numeric / v_avis_count * 100)::numeric, 1)
                            end,
      'signalements',       v_signalements_status,
      'top_motifs',         v_top_motifs
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

revoke all on function public.get_admin_kpis() from public, anon;
grant execute on function public.get_admin_kpis() to authenticated;

comment on function public.get_admin_kpis() is
  'Dashboard KPIs back-office /admin/kpis. SECURITY DEFINER, gate is_admin. Returns jsonb spec dans CLAUDE.md §Admin KPIs.';
