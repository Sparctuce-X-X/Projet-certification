-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 116 — `admin_kpis_alerts(p_pays)` (admin dashboard v2 — AlertBand)
--
-- RPC dédiée pour la bande "actions en attente" du dashboard /admin/kpis.
-- Indépendante des 3 panels (mig 111-113) car appelée séparément + cachable
-- agressivement côté front (refresh à chaque load, pas besoin de filtre période).
--
-- ## Pourquoi séparer
--
-- - V1 (mig 80) imbriquait `moderation_alerts` dans le monolithe. V2 a viré la
--   bande lors du refactor → audit UX 2026-05-11 a remis ça en P0 critique
--   (admin solo daily-use : les "trucs à faire" doivent précéder les chiffres).
-- - Filtre pays uniquement (pas de période — un signalement pending depuis
--   25h est toujours urgent, peu importe la fenêtre temporelle sélectionnée).
-- - Sortie minimale : 4 compteurs + total → rapide, simple à consommer.
--
-- ## KPIs retournés
--
-- - `signalements_pending_24h_plus` : signalements `statut='en_attente'`
--   créés il y a >24h
-- - `kyc_pending_48h_plus` : verifications_identite `statut='pending'`
--   créées il y a >48h
-- - `suspended_30d` : users `is_active=false` mis à jour dans les 30 derniers j
-- - `boosts_stuck_pending` : paiements_niqo `type='boost' statut='pending'`
--   créés il y a >1h (anomalie webhook PawaPay)
-- - `total` : somme des 4
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_kpis_alerts(
  p_pays text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_now            timestamptz := now();
  v_sig            int;
  v_kyc            int;
  v_suspended      int;
  v_boosts_stuck   int;
begin
  if not exists (
    select 1 from public.users where id = auth.uid() and is_admin = true
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_pays is not null and p_pays not in ('CI', 'CG') then
    raise exception 'INVALID_PAYS: % (expected CI, CG or null)', p_pays;
  end if;

  -- Signalements pending >24h
  -- (filtre pays via la cible — annonce ou user — un peu complexe.
  -- Simplification V1 : pas de filtre pays sur signalements, ils sont rares
  -- et l'admin solo traite tout d'un bloc peu importe le pays.)
  select count(*)::int into v_sig
    from public.signalements
   where statut = 'en_attente'
     and created_at < v_now - interval '24 hours';

  -- KYC pending >48h (verifications_identite — filtre pays via users)
  select count(*)::int into v_kyc
    from public.verifications_identite v
    join public.users u on u.id = v.user_id
   where v.statut = 'pending'
     and v.created_at < v_now - interval '48 hours'
     and (p_pays is null or u.pays = p_pays::pays_code);

  -- Suspended dans les 30 derniers jours (info de modération)
  select count(*)::int into v_suspended
    from public.users
   where is_active = false
     and updated_at > v_now - interval '30 days'
     and (p_pays is null or pays = p_pays::pays_code);

  -- Boosts stuck pending depuis >1h (anomalie webhook PawaPay non-arrivé)
  select count(*)::int into v_boosts_stuck
    from public.paiements_niqo p
    join public.users u on u.id = p.user_id
   where p.type = 'boost'
     and p.statut = 'pending'
     and p.created_at < v_now - interval '1 hour'
     and (p_pays is null or u.pays = p_pays::pays_code);

  return jsonb_build_object(
    'generated_at',                    v_now,
    'pays',                            coalesce(p_pays, 'ALL'),
    'signalements_pending_24h_plus',   v_sig,
    'kyc_pending_48h_plus',            v_kyc,
    'suspended_30d',                   v_suspended,
    'boosts_stuck_pending',            v_boosts_stuck,
    'total',                           v_sig + v_kyc + v_suspended + v_boosts_stuck
  );
end;
$$;

revoke all on function public.admin_kpis_alerts(text) from public, anon;
grant execute on function public.admin_kpis_alerts(text) to authenticated;

comment on function public.admin_kpis_alerts(text) is
  'AlertBand pour /admin/kpis : compteurs des 4 types d''alertes (signalements 24h+, KYC 48h+, suspended 30d, boosts stuck). Filtre pays optionnel. Gate is_admin. Mig 116 (audit UX 2026-05-11 — P0 daily-use).';
