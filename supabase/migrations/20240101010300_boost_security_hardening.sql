-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 63 — Hardening sécurité paiement boost (F09)
--
-- 3 blockers identifiés à la review code après merge mig 60-62 :
--
-- A. RACE CONDITION DOUBLE-SPEND
--    Le SELECT v_paiement (check consumed_at IS NULL) puis UPDATE séparé
--    n'est pas atomique. 2 devices simultanés peuvent passer le check
--    en parallèle puis booster 2× la même annonce avec 1 paiement.
--    Fix : faire l'UPDATE consumed_at d'abord avec WHERE consumed_at IS NULL
--    + RETURNING — single statement atomique. Si pas trouvé → déjà consommé.
--
-- B. TARGET_ID NULLABLE BYPASS
--    `paiements_niqo.target_id` est nullable et l'Edge Function le set à
--    NULL si body.target_id absent. Comme mig 62 ne checke que `if not null
--    and != p_annonce_id`, un user peut omettre target_id puis booster
--    n'importe laquelle de ses annonces actives.
--    Fix : pour type='boost', refuser si target_id IS NULL (la clé d'un
--    paiement boost = l'annonce ciblée).
--
-- C. PAS DE WHITELIST MONTANT_FCFA PAR DURÉE
--    L'Edge Function valide juste 1 ≤ montant ≤ 100 000. Un user peut
--    payer 50 FCFA pour 30j de boost (RPC ne re-checke pas le prix).
--    Fix côté RPC : assert que montant_fcfa correspond au tarif officiel
--    pour la durée demandée (1 000 → 7j, 3 000 → 30j).
--    (L'Edge Function va aussi être durcie en parallèle — defense en profondeur.)
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_uid           uuid := auth.uid();
  v_paiement      record;
  v_annonce       record;
  v_new_until     timestamptz;
  v_expected_price int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if p_duration_days not in (7, 30) then
    raise exception 'INVALID_DURATION' using errcode = 'P0002';
  end if;

  -- ── Pricing officiel (single source of truth, miroir de lib/boost.ts)
  v_expected_price := case p_duration_days when 7 then 1000 when 30 then 3000 end;

  -- ── A. Atomic claim du paiement (UPDATE ... RETURNING)
  -- Fait l'UPDATE consumed_at en 1 statement atomique. Si la row était
  -- déjà consommée (consumed_at non null), 0 row update → not found.
  -- Évite la race condition SELECT-puis-UPDATE de mig 60.
  update public.paiements_niqo
     set consumed_at = now()
   where id = p_paiement_id
     and user_id = v_uid
     and type = 'boost'
     and statut = 'completed'
     and consumed_at is null
   returning * into v_paiement;

  if not found then
    -- 4 raisons possibles distinguées :
    select * into v_paiement
      from public.paiements_niqo
     where id = p_paiement_id;
    if not found or v_paiement.user_id <> v_uid then
      raise exception 'INVALID_PAIEMENT' using errcode = 'P0003';
    end if;
    if v_paiement.type <> 'boost' or v_paiement.statut <> 'completed' then
      raise exception 'INVALID_PAIEMENT' using errcode = 'P0003';
    end if;
    -- Restant : consumed_at IS NOT NULL → déjà utilisé
    raise exception 'PAIEMENT_ALREADY_USED' using errcode = 'P0004';
  end if;

  -- ── B. target_id obligatoire pour les paiements boost
  -- (mig 62 ne couvrait que le cas != ; ici on exige la non-nullité)
  if v_paiement.target_id is null then
    raise exception 'PAIEMENT_TARGET_MISSING' using errcode = 'P0007';
  end if;

  if v_paiement.target_id <> p_annonce_id then
    raise exception 'PAIEMENT_TARGET_MISMATCH' using errcode = 'P0006';
  end if;

  -- ── C. Whitelist montant : refuse si < tarif officiel
  -- (Defense en profondeur — l'Edge Function devrait déjà bloquer.)
  if v_paiement.montant_fcfa <> v_expected_price then
    raise exception 'INVALID_PRICE' using errcode = 'P0008';
  end if;

  -- ── Annonce : ownership + active
  select * into v_annonce
    from public.annonces
   where id = p_annonce_id
     and vendeur_id = v_uid
     and statut = 'active';

  if not found then
    -- ROLLBACK manuel : on a déjà consumé le paiement. On le libère.
    -- Sinon le user perd son argent sur une annonce qui n'est pas active.
    update public.paiements_niqo
       set consumed_at = null
     where id = p_paiement_id;
    raise exception 'ANNONCE_INVALID' using errcode = 'P0005';
  end if;

  -- ── Cumul si déjà boostée
  v_new_until := greatest(coalesce(v_annonce.boost_until, now()), now())
                 + (p_duration_days || ' days')::interval;

  update public.annonces
     set is_boosted  = true,
         boost_until = v_new_until,
         updated_at  = now()
   where id = p_annonce_id;

  return v_new_until;
end;
$$;
