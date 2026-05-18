-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 112 — `admin_kpis_activation(p_from, p_to, p_pays)` (admin dashboard v2)
--
-- Panel 2/3 du dashboard `/admin/kpis`. Mesure la santé de l'activation user :
-- combien de signups → combien activent (publient ≥1 annonce) → combien
-- engagent (RDV proposé) → combien complètent (note laissée).
--
-- Funnel pensé "cohorte" : on suit les users **inscrits dans la fenêtre**
-- jusqu'à leur outcome (peu importe quand ils ont activé, tant que c'est
-- avant v_window_end). Permet de comparer la qualité du recrutement entre
-- périodes (ex : campagne d'acquisition CI vs CG).
--
-- ## KPIs retournés
--
-- ### signups
-- - `total_period` : count users.created_at in [from, to[
-- - `delta_pct_vs_prev_period` : variation vs même durée immédiatement avant
--
-- ### activation_funnel (cohorte = signups in window)
-- - `signed_up` : taille cohorte
-- - `published_first_annonce` : sous-ensemble ayant au moins 1 annonces.created_at
-- - `proposed_first_rdv` : sous-ensemble ayant au moins 1 conv.rdv_propose_at
-- - `completed_first_rdv` : sous-ensemble ayant au moins 1 avis (cible :
--   produire un avis = signal d'outcome positif, on n'attend pas 7j)
-- - `signup_to_publish_pct`, `publish_to_rdv_pct`, `rdv_to_avis_pct` :
--   ratios bornés à 100% (numérateur ⊆ dénominateur). `nullif(denom, 0)`.
--
-- ### trust_quality (snapshot — pas filtré par période)
-- - `verified_pct` : % users is_verified=true sur total filtré par pays
-- - `vendeur_fiable_pct` : % users nb_ventes >= 5 AND note_vendeur >= 4.0
--   (statut implicite "Vendeur Fiable" défini en code, non dans CDC ;
--   voir CLAUDE.md §Rôles utilisateurs)
-- - `suspended_auto_score`  : count is_active=false AND score_abus >= 3
-- - `suspended_admin_manual`: count is_active=false AND score_abus < 3
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_kpis_activation(
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
  v_now            timestamptz := now();
  v_window_start   timestamptz;
  v_window_end     timestamptz;
  v_window_seconds bigint;
  v_prev_start     timestamptz;
  v_prev_end       timestamptz;

  -- signups
  v_signups_period int;
  v_signups_prev   int;
  v_delta_pct      numeric;

  -- funnel
  v_published      int;
  v_rdv_proposed   int;
  v_with_avis      int;

  -- trust quality
  v_total_users    int;
  v_verified       int;
  v_vendeur_fiable int;
  v_susp_auto      int;
  v_susp_manual    int;
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

  -- Fenêtre précédente (même durée, juste avant) pour delta %
  v_window_seconds := extract(epoch from (v_window_end - v_window_start))::bigint;
  v_prev_end       := v_window_start;
  v_prev_start     := v_window_start - make_interval(secs => v_window_seconds);

  -- ── Signups ─────────────────────────────────────────────────────────────
  select count(*)::int into v_signups_period
    from public.users u
   where u.created_at >= v_window_start
     and u.created_at <  v_window_end
     and (p_pays is null or u.pays = p_pays::pays_code);

  select count(*)::int into v_signups_prev
    from public.users u
   where u.created_at >= v_prev_start
     and u.created_at <  v_prev_end
     and (p_pays is null or u.pays = p_pays::pays_code);

  v_delta_pct := case
    when v_signups_prev = 0 and v_signups_period = 0 then 0
    when v_signups_prev = 0 then 100
    else round(((v_signups_period - v_signups_prev)::numeric / v_signups_prev * 100), 0)
  end;

  -- ── Activation Funnel (cohorte = signups in window) ─────────────────────
  -- Tous les compteurs aval sont des SOUS-ENSEMBLES de la cohorte initiale.
  -- Garantit ratios ≤ 100%.
  with cohort as (
    select u.id
      from public.users u
     where u.created_at >= v_window_start
       and u.created_at <  v_window_end
       and (p_pays is null or u.pays = p_pays::pays_code)
  )
  select
    count(*) filter (
      where exists (
        select 1 from public.annonces a where a.vendeur_id = cohort.id
      )
    )::int,
    count(*) filter (
      where exists (
        select 1 from public.conversations c
         where c.vendeur_id = cohort.id and c.rdv_propose_at is not null
      )
    )::int,
    count(*) filter (
      where exists (
        select 1 from public.avis av where av.auteur_id = cohort.id
      )
    )::int
    into v_published, v_rdv_proposed, v_with_avis
    from cohort;

  -- ── Trust Quality (snapshot — indépendant de la fenêtre) ────────────────
  select
    count(*)::int,
    count(*) filter (where is_verified = true)::int,
    count(*) filter (where nb_ventes >= 5 and note_vendeur >= 4.0)::int,
    count(*) filter (where is_active = false and score_abus >= 3)::int,
    count(*) filter (where is_active = false and score_abus < 3)::int
    into v_total_users, v_verified, v_vendeur_fiable, v_susp_auto, v_susp_manual
    from public.users u
   where (p_pays is null or u.pays = p_pays::pays_code);

  -- ── Compose final JSON ──────────────────────────────────────────────────
  return jsonb_build_object(
    'generated_at', v_now,
    'window_from',  v_window_start,
    'window_to',    v_window_end,
    'pays',         coalesce(p_pays, 'ALL'),

    'signups', jsonb_build_object(
      'total_period',            v_signups_period,
      'total_prev_period',       v_signups_prev,
      'delta_pct_vs_prev_period', v_delta_pct
    ),

    'activation_funnel', jsonb_build_object(
      'signed_up',                v_signups_period,
      'published_first_annonce',  v_published,
      'proposed_first_rdv',       v_rdv_proposed,
      'completed_first_rdv',      v_with_avis,
      'signup_to_publish_pct',    round(
        (v_published::numeric / nullif(v_signups_period, 0)) * 100, 1
      ),
      'publish_to_rdv_pct',       round(
        (v_rdv_proposed::numeric / nullif(v_published, 0)) * 100, 1
      ),
      'rdv_to_avis_pct',          round(
        (v_with_avis::numeric / nullif(v_rdv_proposed, 0)) * 100, 1
      )
    ),

    'trust_quality', jsonb_build_object(
      'total_users',              v_total_users,
      'verified',                 v_verified,
      'verified_pct',             round(
        (v_verified::numeric / nullif(v_total_users, 0)) * 100, 1
      ),
      'vendeur_fiable',           v_vendeur_fiable,
      'vendeur_fiable_pct',       round(
        (v_vendeur_fiable::numeric / nullif(v_total_users, 0)) * 100, 1
      ),
      'suspended_auto_score',     v_susp_auto,
      'suspended_admin_manual',   v_susp_manual
    )
  );
end;
$$;

revoke all on function public.admin_kpis_activation(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_kpis_activation(timestamptz, timestamptz, text) to authenticated;

comment on function public.admin_kpis_activation(timestamptz, timestamptz, text) is
  'Panel 2/3 dashboard admin v2 : funnel signup→annonce→RDV→avis (cohorte stricte) + trust quality (verified %, Vendeur Fiable %, suspensions). Filtré par pays (CI/CG/null=ALL). Gate is_admin. nullif sur tous les ratios. Mig 112.';
