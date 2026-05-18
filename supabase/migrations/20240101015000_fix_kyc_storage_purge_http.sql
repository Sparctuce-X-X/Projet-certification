-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 110 — Fix KYC storage purge (HTTP au lieu de SQL direct)
--
-- Cause :
--   Depuis que Supabase a ajouté le trigger global `storage.protect_objects_delete`
--   (~2026-Q1), tout `DELETE FROM storage.objects` direct depuis SQL raise :
--     ERROR 42501: Direct deletion from storage tables is not allowed.
--     Use the Storage API instead.
--   Conséquence : le trigger `trg_purge_cni_storage` (mig 54) qui faisait
--   `delete from storage.objects ... where name in (recto, verso, selfie)`
--   est **bloqué à chaque firing**. Donc :
--     - La cron `purge_expired_kyc_verifications` (mig 54+75) ne purge rien
--       (la transaction rollback sur le RAISE du protect_delete).
--     - La cascade `users → verifications_identite` (FK CASCADE) raise aussi
--       → `auth.admin.deleteUser` peut échouer pour les comptes avec KYC.
--     - RGPD : promesses du consent (30j refus / 6m validé / 60j pending
--       abandonné) non tenues côté DB. Violation directe ARTCI 2024-30,
--       ANRTIC 2023-15, RW 2021-058.
--
--   Mig 73 avait fixé le même symptôme dans `delete_my_account()` (purge
--   passée côté client via Storage HTTP API) mais a oublié de fixer le
--   trigger mig 54 — d'où ce bug latent détecté 2026-05-11 lors du backfill
--   des tests pgTAP du module KYC.
--
-- Stratégie : remplacer le `DELETE FROM storage.objects` du trigger function
-- par un appel HTTP DELETE vers l'API Storage de Supabase (même pattern que
-- mig 65 pour les push notifs). Le trigger reste wired BEFORE DELETE — donc
-- toute suppression d'une row `verifications_identite` (cron, cascade,
-- admin manual) déclenche la purge HTTP fire-and-forget.
--
-- Architecture sécurité :
--   - Service role key lue depuis `vault.decrypted_secrets` (mig 65 a déjà
--     créé le secret 'service_role_key' à utiliser).
--   - URL Storage stockée dans Vault sous 'cni_storage_remove_url' pour
--     pouvoir override prod/staging sans modifier le SQL. Fallback URL prod
--     hardcodée si Vault indisponible.
--   - `net.http_delete` fire-and-forget non-bloquant (la trigger return même
--     si Storage répond lentement).
--   - Best-effort : si Vault vide ou pg_net erreur, on log notice et continue
--     (la purge DB se fait, l'orphelin Storage sera nettoyé par un cron
--     dédié — à écrire si on observe des orphelins en prod).
--
-- API Supabase Storage utilisée :
--   DELETE /storage/v1/object/{bucket}
--   body  : { "prefixes": ["{path1}", "{path2}", "{path3}"] }
--   auth  : Bearer {service_role_key}
--
-- Prérequis :
--   - Extension `pg_net` activée (déjà OK via mig 65)
--   - Extension `supabase_vault` activée (déjà OK via mig 65)
--   - Secret `service_role_key` stocké dans Vault (déjà OK via mig 65)
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + docs/backend/kyc.md
-- §Known issues.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. URL Storage purge dans Vault (override prod/staging si besoin) ───────

do $$
begin
  perform vault.create_secret(
    'https://uokauzmafppukgsemugz.supabase.co/storage/v1/object/cni-verifications',
    'cni_storage_remove_url',
    'URL Supabase Storage REST DELETE pour bucket cni-verifications (bulk via body.prefixes)'
  );
exception
  when unique_violation then null;
  when others then
    raise notice '[kyc] vault.create_secret cni_storage_remove_url failed (vault disabled?), continue with hardcoded URL';
end $$;

-- ── 2. Replace purge_cni_storage_on_verif_delete : SQL direct → HTTP DELETE ──

create or replace function public.purge_cni_storage_on_verif_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url  text;
  v_key  text;
  v_body jsonb;
begin
  -- Récupère la service role key (chiffrée Vault). Si absent : log + skip.
  -- On ne bloque PAS la transaction métier (DELETE de la row continue).
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key' limit 1;
  exception
    when undefined_table then null;
    when others then null;
  end;

  if v_key is null then
    raise notice '[kyc] vault service_role_key unavailable, skip storage purge (orphelins possibles)';
    return old;
  end if;

  -- Récupère l'URL Storage. Fallback hardcodée si Vault vide.
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'cni_storage_remove_url' limit 1;
  exception
    when undefined_table then null;
    when others then null;
  end;

  if v_url is null then
    v_url := 'https://uokauzmafppukgsemugz.supabase.co/storage/v1/object/cni-verifications';
  end if;

  -- Body : Supabase Storage REST API attend { "prefixes": [...] } pour bulk delete.
  v_body := jsonb_build_object(
    'prefixes', array[
      old.cni_recto_path,
      old.cni_verso_path,
      old.selfie_path
    ]
  );

  -- Fire-and-forget HTTP DELETE. Si la requête échoue (timeout, 5xx), on log
  -- mais on continue (la row sera supprimée, l'orphelin Storage reste —
  -- best-effort cohérent avec mig 65).
  begin
    perform net.http_delete(
      url     := v_url,
      body    := v_body,
      headers := jsonb_build_object(
        'authorization', 'Bearer ' || v_key,
        'content-type',  'application/json'
      )
    );
  exception
    when others then
      raise notice '[kyc] storage purge HTTP failed (orphelins possibles): %', sqlerrm;
  end;

  return old;
end;
$$;

-- Le trigger trg_purge_cni_storage (mig 54) reste wired tel quel — seul le
-- corps de la fonction change. Aucun DROP/CREATE TRIGGER nécessaire.

-- ── 3. Security advisor (cohérence mig 94) ──────────────────────────────────

revoke all on function public.purge_cni_storage_on_verif_delete() from public, anon, authenticated;
