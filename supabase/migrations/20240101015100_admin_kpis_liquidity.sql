-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 111 — `admin_kpis_liquidity(p_from, p_to, p_pays)` (admin dashboard v2)
--
-- Panel 1/3 du nouveau dashboard `/admin/kpis` : Liquidité par pays.
-- Refactor du monolithe `get_admin_kpis()` (mig 78→80) en 3 RPCs ciblées.
-- Cette première RPC couvre les deux faces de la liquidité marketplace :
-- Supply Health (offre vendeurs) + Demand Engagement (intérêt acheteurs).
--
-- ## Pourquoi décomposer
--
-- - Plan eng-review 2026-05-11 (D3 = disruptive refactor) : `get_admin_kpis`
--   monolithe agrège users + marketplace + trust + revenue dans un seul JSON.
--   Lecture difficile + impossible de filtrer par pays sans tout recalculer.
-- - V2 admin doit segmenter CI vs CG (premier marché vs deuxième marché —
--   ne pas mélanger les chiffres comme dans la v1). Voir office-hours design
--   doc 2026-05-11 §Premise 1 (Liquidité par pays = P0).
--
-- ## Signature
--
--   admin_kpis_liquidity(
--     p_from timestamptz default null,  -- défaut : 30 derniers jours
--     p_to   timestamptz default null,
--     p_pays text        default null   -- 'CI' | 'CG' | null (=ALL)
--   ) returns jsonb
--
-- Gate `is_admin` (raise ADMIN_REQUIRED). Defaults idem mig 80 (30j window).
--
-- ## Sémantique pays
--
-- - `p_pays = 'CI'` : filtre toutes les sous-requêtes sur les annonces/users
--   du pays. Conversations/messages dérivent leur pays via `annonces.pays`.
-- - `p_pays = 'CG'` : idem.
-- - `p_pays = null` : pas de filtre (agrégat ALL).
-- - Toute autre valeur → exception INVALID_PAYS (defense-in-depth).
--
-- ## KPIs retournés
--
-- ### supply_health
-- - `annonces_nouvelles_period` : count annonces.created_at in [from,to[
-- - `annonces_actives_total`    : snapshot count statut='active'
-- - `annonces_expirees_period`  : count statut='expiree' AND updated_at in window
-- - `contacts_per_annonce_avg`  : convs créées sur annonces de la période /
--   annonces nouvelles — `nullif(annonces, 0)` (CRITICAL : sans nullif,
--   division par zéro → NaN propagé → dashboard plante avec 0 annonces.
--   Identifié comme failure mode critique au plan-eng-review).
-- - `time_to_first_contact_p50_hours` : médiane (premier message d'une conv -
--   annonce.created_at), pour annonces avec ≥1 contact dans la période.
--
-- ### demand_engagement
-- - `dau` / `wau` / `mau` : DISTINCT users JOIN push_tokens.last_seen_at <
--   24h / 7d / 30d. Filtrés par users.pays si p_pays.
-- - `vues_total_period` : sum(nb_vues) sur les annonces créées dans la fenêtre
--   (proxy demand : combien de gens ont VU les annonces nouvelles)
-- - `conversations_initiated_period` : count conversations.created_at in window
-- - `vues_to_contact_pct` : convs / vues — `nullif(vues, 0)` (cf. supra)
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_kpis_liquidity(
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

  -- supply
  v_annonces_new       int;
  v_annonces_active    int;
  v_annonces_expired   int;
  v_convs_on_new       int;
  v_contacts_per_avg   numeric;
  v_ttfc_p50_hours     numeric;

  -- demand
  v_dau                int;
  v_wau                int;
  v_mau                int;
  v_vues_total         int;
  v_convs_initiated    int;
  v_vues_to_contact    numeric;
begin
  -- Gate admin
  if not exists (
    select 1 from public.users where id = auth.uid() and is_admin = true
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  -- Whitelist pays (defense-in-depth — le front contraint déjà via CountrySelector)
  if p_pays is not null and p_pays not in ('CI', 'CG') then
    raise exception 'INVALID_PAYS: % (expected CI, CG or null)', p_pays;
  end if;

  -- Resolve fenêtre
  v_window_start := coalesce(p_from, v_now - interval '30 days');
  v_window_end   := coalesce(p_to,   v_now);

  if v_window_end <= v_window_start then
    raise exception 'INVALID_WINDOW: p_to (%) must be > p_from (%)',
      v_window_end, v_window_start;
  end if;

  -- ── Supply Health ────────────────────────────────────────────────────────

  select count(*)::int into v_annonces_new
    from public.annonces a
   where a.created_at >= v_window_start
     and a.created_at <  v_window_end
     and (p_pays is null or a.pays = p_pays::pays_code);

  select count(*)::int into v_annonces_active
    from public.annonces a
   where a.statut = 'active'
     and (p_pays is null or a.pays = p_pays::pays_code);

  select count(*)::int into v_annonces_expired
    from public.annonces a
   where a.statut = 'expiree'
     and a.updated_at >= v_window_start
     and a.updated_at <  v_window_end
     and (p_pays is null or a.pays = p_pays::pays_code);

  -- Contacts par annonce : convs créées sur annonces publiées dans la
  -- fenêtre (cohorte stricte — on suit les conv générées par les annonces
  -- de la période, peu importe quand la conv est née).
  select count(*)::int into v_convs_on_new
    from public.conversations c
    join public.annonces a on a.id = c.annonce_id
   where a.created_at >= v_window_start
     and a.created_at <  v_window_end
     and (p_pays is null or a.pays = p_pays::pays_code);

  -- CRITICAL : nullif(denom, 0) — sans ça, 0 annonces → NaN → dashboard plante
  -- (failure mode identifié plan-eng-review 2026-05-11).
  v_contacts_per_avg := round(
    v_convs_on_new::numeric / nullif(v_annonces_new, 0),
    2
  );

  -- Time-to-first-contact : médiane (heures) entre annonce.created_at et
  -- premier message reçu, pour les annonces de la période ayant reçu ≥1 contact.
  select round(
    (percentile_cont(0.5) within group (
       order by extract(epoch from (first_msg_at - a.created_at)) / 3600
     ))::numeric,
    1
  ) into v_ttfc_p50_hours
    from public.annonces a
    join lateral (
      select min(m.created_at) as first_msg_at
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
       where c.annonce_id = a.id
         and m.type <> 'systeme'
    ) fc on fc.first_msg_at is not null
   where a.created_at >= v_window_start
     and a.created_at <  v_window_end
     and (p_pays is null or a.pays = p_pays::pays_code);

  -- ── Demand Engagement ───────────────────────────────────────────────────

  -- DAU/WAU/MAU : DISTINCT users avec push_token actif dans la fenêtre. Le
  -- filtre pays passe via users.pays (push_tokens n'a pas de colonne pays).
  select count(distinct u.id)::int into v_dau
    from public.users u
    join public.push_tokens pt on pt.user_id = u.id
   where pt.last_seen_at > v_now - interval '24 hours'
     and (p_pays is null or u.pays = p_pays::pays_code);

  select count(distinct u.id)::int into v_wau
    from public.users u
    join public.push_tokens pt on pt.user_id = u.id
   where pt.last_seen_at > v_now - interval '7 days'
     and (p_pays is null or u.pays = p_pays::pays_code);

  select count(distinct u.id)::int into v_mau
    from public.users u
    join public.push_tokens pt on pt.user_id = u.id
   where pt.last_seen_at > v_now - interval '30 days'
     and (p_pays is null or u.pays = p_pays::pays_code);

  -- Vues totales : sum(nb_vues) sur les annonces créées dans la fenêtre.
  -- Proxy "intérêt acheteurs sur le supply nouveau".
  select coalesce(sum(a.nb_vues), 0)::int into v_vues_total
    from public.annonces a
   where a.created_at >= v_window_start
     and a.created_at <  v_window_end
     and (p_pays is null or a.pays = p_pays::pays_code);

  -- Conversations créées dans la fenêtre (peu importe quand l'annonce est née)
  select count(*)::int into v_convs_initiated
    from public.conversations c
    join public.annonces a on a.id = c.annonce_id
   where c.created_at >= v_window_start
     and c.created_at <  v_window_end
     and (p_pays is null or a.pays = p_pays::pays_code);

  -- Ratio vues→contact : convs créées / vues totales × 100. nullif protège.
  v_vues_to_contact := round(
    (v_convs_initiated::numeric / nullif(v_vues_total, 0)) * 100,
    2
  );

  -- ── Compose final JSON ──────────────────────────────────────────────────
  return jsonb_build_object(
    'generated_at', v_now,
    'window_from',  v_window_start,
    'window_to',    v_window_end,
    'pays',         coalesce(p_pays, 'ALL'),

    'supply_health', jsonb_build_object(
      'annonces_nouvelles_period',     v_annonces_new,
      'annonces_actives_total',        v_annonces_active,
      'annonces_expirees_period',      v_annonces_expired,
      'contacts_per_annonce_avg',      v_contacts_per_avg,
      'time_to_first_contact_p50_hrs', v_ttfc_p50_hours
    ),

    'demand_engagement', jsonb_build_object(
      'dau',                            v_dau,
      'wau',                            v_wau,
      'mau',                            v_mau,
      'vues_total_period',              v_vues_total,
      'conversations_initiated_period', v_convs_initiated,
      'vues_to_contact_pct',            v_vues_to_contact
    )
  );
end;
$$;

revoke all on function public.admin_kpis_liquidity(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_kpis_liquidity(timestamptz, timestamptz, text) to authenticated;

comment on function public.admin_kpis_liquidity(timestamptz, timestamptz, text) is
  'Panel 1/3 dashboard admin v2 : Supply Health (offre vendeurs) + Demand Engagement (intérêt acheteurs). Filtré par pays (CI/CG/null=ALL). Gate is_admin. Defaults : 30 derniers jours. nullif(denom, 0) sur les ratios pour éviter NaN. Mig 111 (refactor du monolithe mig 80).';
