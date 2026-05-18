-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 126 — Email confirmation de paiement + PDF de reçu (Phase 3 email)
--
-- Envoie automatiquement un email de confirmation avec reçu PDF dès qu'un
-- paiement Niqo passe au statut `completed`.
--
-- ARCHITECTURE
--   0. Bucket Storage `paiements-receipts` (privé, path : {user_id}/{paiement_id}.pdf)
--      Policies RLS owner-only SELECT (upload via service_role EF uniquement)
--
--   1. Vault secret `payment_confirmation_function_url` (URL Edge Function)
--        → fallback hardcoded si Vault absent
--
--   2. Helper `_notify_payment_confirmation(p_paiement_id uuid)` SECURITY DEFINER
--        → lit `service_role_key` (Vault, même clé que mig 65 _notify_push)
--        → lit ou fallback `payment_confirmation_function_url` (Vault)
--        → appelle net.http_post → Edge Function `send-payment-confirmation`
--        → fire-and-forget non-bloquant
--        → REVOKE all from public/anon/authenticated (appelable triggers seulement)
--
--   3. Trigger function `tg_fn_payment_confirmation()` RETURNS trigger
--        → appelle `_notify_payment_confirmation(NEW.id)`
--
--   4. Deux triggers partageant la même trigger function (Postgres interdit
--      OLD dans le WHEN d'un trigger INSERT, ERROR 42P17) :
--        - `tg_payment_confirmation_insert` AFTER INSERT
--             WHEN (NEW.statut = 'completed')
--             couvre le mode mock pawapay-init-deposit (INSERT direct
--             statut='completed').
--        - `tg_payment_confirmation_update` AFTER UPDATE
--             WHEN (NEW.statut = 'completed' AND OLD.statut IS DISTINCT FROM 'completed')
--             couvre le mode réel pawapay-webhook (UPDATE pending→completed)
--             + filtre les no-op + anti-rétrogradation.
--
--   5. Fonction `purge_old_receipts()` + cron annuel (retention 10 ans Code Commerce CI/CG)
--
-- PRÉREQUIS (à vérifier avant de jouer en prod)
--   - Extension `pg_net` activée (Dashboard → Database → Extensions)
--   - Extension `supabase_vault` activée
--   - Secret `service_role_key` dans vault.decrypted_secrets (posé par mig 65)
--   - Extension `pg_cron` activée (pour la purge — fallback gracieux si absente)
--   - Edge Function `send-payment-confirmation` déployée :
--       supabase functions deploy send-payment-confirmation
--   - Secret RESEND_API_KEY configuré dans Edge Function Secrets
--   - Secret NIQO_INTERNAL_KEY configuré dans Edge Function Secrets (partagé mig 65)
--
-- TEST POST-DEPLOY
--   -- Tester l'envoi manuel :
--   select _notify_payment_confirmation('<uuid-paiement-completed>');
--   -- Vérifier dans niqo_event_log :
--   select * from niqo_event_log where module = 'payment-confirmation' order by occurred_at desc limit 10;
--   -- Vérifier les objets uploadés :
--   select * from storage.objects where bucket_id = 'paiements-receipts' order by created_at desc limit 5;
--
-- IDEMPOTENTE. Pattern mig 124 (welcome email) + mig 125 (admin notif).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Bucket Storage `paiements-receipts` ───────────────────────────────────
-- Privé (public=false). Limite 1 MB par fichier (un PDF reçu ~50-100 KB).
-- Path convention : `paiements-receipts/{user_id}/{paiement_id}.pdf`

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'paiements-receipts',
  'paiements-receipts',
  false,
  1048576,                            -- 1 MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ── 1. RLS Storage policies ──────────────────────────────────────────────────
-- SELECT : user voit uniquement ses propres reçus (path commence par son uid).
-- Pas de policy INSERT/UPDATE/DELETE côté client : upload via service_role EF.

drop policy if exists "receipts_select_own" on storage.objects;

create policy "receipts_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'paiements-receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── 2. URL de l'Edge Function (Vault, pattern mig 65 + 124 + 125) ────────────
-- Stockée côté Vault pour basculer prod/staging sans modifier le SQL.
-- Fallback hardcoded si le secret est absent (Vault désactivé).

do $$
begin
  perform vault.create_secret(
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-payment-confirmation',
    'payment_confirmation_function_url',
    'URL Edge Function send-payment-confirmation (override prod via Vault)'
  );
exception
  when unique_violation then null;
  when others then
    raise notice '[payment-confirmation] vault.create_secret payment_confirmation_function_url failed (vault disabled?), on utilisera l''URL hardcodée';
end $$;

-- ── 3. Helper privé _notify_payment_confirmation ─────────────────────────────
-- SECURITY DEFINER : tourne avec les droits du owner (postgres), pas du caller.
-- REVOKE de public/anon/authenticated : appelable uniquement par les triggers.
-- search_path verrouillé : public, vault, extensions (anti search_path hijack).

create or replace function public._notify_payment_confirmation(
  p_paiement_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
  v_url text;
begin
  -- Clé bearer (NIQO_INTERNAL_KEY) lue depuis Vault.
  -- Même clé que _notify_push (mig 65) — stockée sous le nom 'service_role_key'.
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
  exception
    when undefined_table then
      raise notice '[payment-confirmation] vault not enabled, skip envoi email';
      return;
  end;

  if v_key is null then
    raise notice '[payment-confirmation] no service_role_key in vault, skip envoi email';
    return;
  end if;

  -- URL Edge Function : Vault override si dispo, sinon fallback hardcoded.
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'payment_confirmation_function_url'
     limit 1;
  exception when others then
    v_url := null;
  end;

  v_url := coalesce(
    v_url,
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-payment-confirmation'
  );

  -- Fire-and-forget via pg_net (non-bloquant — ne bloque pas la transaction métier).
  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'paiement_id', p_paiement_id::text
      )
    );
  exception
    when undefined_function then
      raise notice '[payment-confirmation] pg_net not enabled, skip envoi email';
    when others then
      raise notice '[payment-confirmation] http_post failed: %', sqlerrm;
  end;
end;
$$;

-- Lockdown : uniquement les triggers SECURITY DEFINER (owner) peuvent appeler
-- ce helper — pas exposé à l'API REST ni à anon/authenticated.
revoke all on function public._notify_payment_confirmation(uuid) from public;
revoke all on function public._notify_payment_confirmation(uuid) from authenticated;
revoke all on function public._notify_payment_confirmation(uuid) from anon;

-- ── 4a. Trigger function (partagée par INSERT et UPDATE) ─────────────────────

create or replace function public.tg_fn_payment_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._notify_payment_confirmation(NEW.id);
  return NEW;
end;
$$;

-- ── 4b. Triggers AFTER INSERT / AFTER UPDATE ON paiements_niqo ───────────────
-- Postgres interdit de référencer OLD dans la clause WHEN d'un trigger INSERT
-- (ERROR 42P17). On split donc en deux triggers distincts qui partagent la
-- même trigger function.
--
--   - tg_payment_confirmation_insert (AFTER INSERT) : mode mock
--     pawapay-init-deposit qui INSERT direct statut='completed'.
--   - tg_payment_confirmation_update (AFTER UPDATE) : mode réel
--     pawapay-webhook qui fait UPDATE pending→completed. Filtré par
--     `OLD.statut IS DISTINCT FROM 'completed'` (anti no-op + anti rétrogradation).
--
-- Drop préalables pour idempotence (incl. ancien trigger combiné si déjà tenté).

drop trigger if exists tg_payment_confirmation on public.paiements_niqo;
drop trigger if exists tg_payment_confirmation_insert on public.paiements_niqo;
drop trigger if exists tg_payment_confirmation_update on public.paiements_niqo;

create trigger tg_payment_confirmation_insert
  after insert on public.paiements_niqo
  for each row
  when (NEW.statut = 'completed')
  execute function public.tg_fn_payment_confirmation();

create trigger tg_payment_confirmation_update
  after update on public.paiements_niqo
  for each row
  when (
    NEW.statut = 'completed'
    and OLD.statut is distinct from 'completed'
  )
  execute function public.tg_fn_payment_confirmation();

-- ── 5. Rétention 10 ans — purge_old_receipts() + cron annuel ─────────────────
-- Compliance Code de Commerce CI (art. 34, Loi 2015-537) + Code de Commerce
-- Congo (art. 8) : conservation 10 ans des pièces comptables.
-- Au-delà, le user peut toujours retrouver la trace dans paiements_niqo
-- (la table n'est pas purgée — seuls les PDF Storage le sont).

create or replace function public.purge_old_receipts()
returns int
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_deleted int;
begin
  -- Supprime les objets Storage de plus de 10 ans dans paiements-receipts.
  delete from storage.objects
   where bucket_id = 'paiements-receipts'
     and created_at < now() - interval '10 years';
  get diagnostics v_deleted = row_count;

  -- Log dans niqo_event_log (mig 106) si dispo.
  begin
    insert into public.niqo_event_log (module, event, level, payload, occurred_at)
    values (
      'paiements-receipts',
      'retention.purged',
      'info',
      jsonb_build_object('deleted', v_deleted),
      now()
    );
  exception
    when undefined_table then null;  -- niqo_event_log pas encore créé
  end;

  return v_deleted;
end;
$$;

-- Cron annuel : 1er janvier à 3h UTC. Fallback gracieux si pg_cron absent.
do $$
begin
  perform cron.unschedule('purge_old_receipts');
exception
  when others then null;  -- job pas encore créé, OK
end $$;

do $$
begin
  perform cron.schedule(
    'purge_old_receipts',
    '0 3 1 1 *',
    $cron$ select public.purge_old_receipts(); $cron$
  );
exception
  when undefined_table then
    raise notice '[payment-confirmation] pg_cron not enabled — purge_old_receipts à planifier manuellement via Dashboard';
  when others then
    raise notice '[payment-confirmation] cron.schedule failed: %', sqlerrm;
end $$;
