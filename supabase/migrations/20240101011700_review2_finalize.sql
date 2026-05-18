-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 77 — Finalisation review #2 (D + E + F)
--
-- 3 derniers points identifiés à la review #2 (les plus mineurs après mig 70-76) :
--
--   D. Anonymisation `paiements_niqo.pawapay_metadata`
--      ────────────────────────────────────────────────
--      Le webhook PawaPay v2 stocke le payload brut tel quel dans
--      `pawapay_metadata` (pour debug). Ce payload contient le numéro mobile
--      du payeur sous `payer.accountDetails.phoneNumber`.
--      RGPD : on n'a aucun usage métier de ce numéro post-paiement (le
--      mapping user→paiement est déjà via `user_id`). On le scrub côté DB
--      via un trigger BEFORE INSERT/UPDATE → garantit que même un futur
--      bug côté Edge Function ne pourra pas faire fuiter le numéro.
--
--   E. Trigger `tg_check_score_abus` étendu à `update of is_active`
--      ───────────────────────────────────────────────────────────
--      Le trigger (mig 28) ne s'exécute QUE sur `update of score_abus`.
--      Si un admin réactive manuellement un compte (`is_active = true`)
--      alors que `score_abus >= 3` (jamais purgé), le compte reste actif
--      malgré le seuil. Edge case admin → on durcit en ajoutant
--      `update of is_active` à la liste de colonnes surveillées.
--
--   F. Vault entry rename `service_role_key` → `push_internal_key`
--      ──────────────────────────────────────────────────────────
--      Le secret stocké sous `service_role_key` n'est plus le service_role
--      Supabase mais NIQO_INTERNAL_KEY (32 bytes hex, custom). Le nom est
--      trompeur. On copie sous le nouveau nom et on update mig 65 pour
--      lire `push_internal_key` en priorité, fallback `service_role_key`
--      pour transition.
--      L'ancien nom sera dropé après vérification (mig manuelle ou Phase 2).
--
-- Idempotente. Cf. CLAUDE.md §RGPD + §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── D. Scrub pawapay_metadata.payer.accountDetails.phoneNumber ───────────────

create or replace function public.fn_scrub_pawapay_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_meta jsonb := NEW.pawapay_metadata;
begin
  if v_meta is null then
    return NEW;
  end if;

  -- payer.accountDetails.phoneNumber → scrub
  if v_meta #> '{payer,accountDetails,phoneNumber}' is not null then
    v_meta := jsonb_set(
      v_meta,
      '{payer,accountDetails,phoneNumber}',
      '"[redacted]"'::jsonb,
      false
    );
  end if;

  -- payee.accountDetails.phoneNumber (au cas où PawaPay l'inclue dans un
  -- callback futur — pour l'instant Niqo n'utilise que les deposits)
  if v_meta #> '{payee,accountDetails,phoneNumber}' is not null then
    v_meta := jsonb_set(
      v_meta,
      '{payee,accountDetails,phoneNumber}',
      '"[redacted]"'::jsonb,
      false
    );
  end if;

  -- metadata user-supplied : vérif qu'on n'a pas glissé un champ phone là
  -- (PawaPay accepte un array de {fieldName, fieldValue} en metadata)
  if jsonb_typeof(v_meta -> 'metadata') = 'array' then
    v_meta := jsonb_set(
      v_meta,
      '{metadata}',
      (
        select coalesce(jsonb_agg(
          case
            when lower(coalesce(elem ->> 'fieldName', '')) ~ '(phone|telephone|msisdn)'
              then jsonb_set(elem, '{fieldValue}', '"[redacted]"'::jsonb, false)
            else elem
          end
        ), '[]'::jsonb)
        from jsonb_array_elements(v_meta -> 'metadata') elem
      ),
      false
    );
  end if;

  NEW.pawapay_metadata := v_meta;
  return NEW;
end;
$$;

drop trigger if exists tg_scrub_pawapay_metadata on public.paiements_niqo;
create trigger tg_scrub_pawapay_metadata
  before insert or update of pawapay_metadata on public.paiements_niqo
  for each row
  execute function public.fn_scrub_pawapay_metadata();

-- Backfill : scrub les rows existantes (idempotent — re-scrub un row déjà
-- redacted ne change rien)
update public.paiements_niqo
   set pawapay_metadata = pawapay_metadata
 where pawapay_metadata #> '{payer,accountDetails,phoneNumber}' is not null
    or pawapay_metadata #> '{payee,accountDetails,phoneNumber}' is not null;

-- ── E. Étend tg_check_score_abus à update of is_active ──────────────────────

drop trigger if exists tg_check_score_abus on public.users;
create trigger tg_check_score_abus
  before update of score_abus, is_active on public.users
  for each row
  execute function public.fn_check_score_abus();

-- ── F. Vault rename : copie service_role_key → push_internal_key ────────────
-- On ne drop PAS l'ancien nom dans cette migration : mig 65 lit encore
-- `service_role_key` en fallback. L'ancien nom sera dropé après vérification
-- via un script manuel (cf. docs/migrations/_vault_rename_check.sql).

do $$
declare
  v_old_id  uuid;
  v_new_id  uuid;
  v_secret  text;
begin
  -- Vault accessible ?
  begin
    select id into v_old_id from vault.secrets where name = 'service_role_key' limit 1;
  exception when undefined_table then
    raise notice '[mig77] vault not enabled, skipping rename';
    return;
  end;

  if v_old_id is null then
    raise notice '[mig77] no service_role_key in vault — skipping rename';
    return;
  end if;

  select id into v_new_id from vault.secrets where name = 'push_internal_key' limit 1;
  if v_new_id is not null then
    raise notice '[mig77] push_internal_key already exists, skipping copy';
    return;
  end if;

  -- Lit la valeur de l'ancien et la dépose sous le nouveau nom
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  if v_secret is null then
    raise notice '[mig77] could not decrypt service_role_key, skipping';
    return;
  end if;

  perform vault.create_secret(
    v_secret,
    'push_internal_key',
    'Secret partagé Niqo entre pg_net (DB triggers) et send-push-notification Edge Function. Renommé depuis service_role_key (mig 77) — l''ancien nom reste en place jusqu''au cleanup manuel.'
  );

  raise notice '[mig77] vault: push_internal_key created from service_role_key';
end;
$$;

-- Update push helper (mig 65) pour lire push_internal_key en priorité,
-- fallback service_role_key pour transition zéro-downtime.

create or replace function public.fn_send_push(
  p_user_ids uuid[],
  p_title    text,
  p_body     text,
  p_data     jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key  text;
  v_url  text;
begin
  if cardinality(coalesce(p_user_ids, array[]::uuid[])) = 0 then
    return;
  end if;

  -- Niqo internal key (chiffrée Vault). Lecture priorité : nouveau nom puis
  -- ancien (transition mig 77). Si ni l'un ni l'autre : log + skip.
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'push_internal_key'
     limit 1;
    if v_key is null then
      select decrypted_secret into v_key
        from vault.decrypted_secrets
       where name = 'service_role_key'
       limit 1;
    end if;
  exception
    when undefined_table then
      raise notice '[push] vault not enabled, skipping push notif';
      return;
  end;
  if v_key is null then
    raise notice '[push] no push_internal_key (or legacy service_role_key) in vault, skipping';
    return;
  end if;

  -- URL : Vault override si dispo, sinon hardcoded
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'push_function_url'
     limit 1;
  exception when others then v_url := null;
  end;
  v_url := coalesce(
    v_url,
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-push-notification'
  );

  -- Fire-and-forget : pg_net renvoie un id de request mais on ne l'attend pas.
  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'user_ids', (select jsonb_agg(uid::text) from unnest(p_user_ids) uid),
        'title',    p_title,
        'body',     p_body,
        'data',     p_data
      )
    );
  exception
    when others then
      raise notice '[push] http_post failed: %', SQLERRM;
  end;
end;
$$;
