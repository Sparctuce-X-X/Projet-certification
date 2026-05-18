-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 16 — annonces : crons (expire + purge) + RPCs + anti-spam trigger
--
-- Composants :
--   1. Cron `expire-annonces` (02:00) — active → expiree quand expires_at < now()
--   2. Cron `purge-expired-annonces` (03:00) — DELETE expirees au-delà de 28j
--      + appel Edge Function purge-annonces-photos pour cleanup Storage
--   3. RPC `fn_prolonger_annonce(p_annonce_id)` — réactivation 28j post-expire
--   4. RPC `fn_increment_views(p_annonce_id)` — increment atomique nb_vues
--   5. RPC `get_user_public_profile(p_user_id)` — profil public read-only
--   6. Trigger `enforce_annonces_rate_limit` — max 5 nouvelles annonces / 24h
--
-- Prérequis :
--   - Migration 15 (table annonces) jouée
--   - Edge Function purge-annonces-photos déployée :
--       supabase functions deploy purge-annonces-photos
--       supabase secrets set PURGE_AUTH_TOKEN=<random-32-chars>
--   - Extensions pg_cron, pgcrypto (déjà actives), pg_net (à activer si pas
--     déjà fait : Dashboard → Database → Extensions → pg_net)
--   - Vault secrets posés AVANT exécution (cf. section 0 ci-dessous)
--
-- ⚠ AVANT DE JOUER CETTE MIGRATION, exécuter dans SQL Editor :
--
--   select vault.create_secret(
--     '<token-random-32-chars-EXACT-MATCH-AVEC-PURGE_AUTH_TOKEN-EDGE-FUNC>',
--     'purge_auth_token'
--   );
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/purge-annonces-photos',
--     'purge_function_url'
--   );
--
-- (Re-jouer la migration ne re-crée pas les secrets : ils sont stockés une
--  fois pour toutes côté Vault. Les remplacer = `update vault.secrets ...`.)
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Cron expire-annonces — active → expiree (02:00 quotidien) ────────────

select cron.unschedule('expire-annonces') where exists (
  select 1 from cron.job where jobname = 'expire-annonces'
);

select cron.schedule(
  'expire-annonces',
  '0 2 * * *',
  $$
    update public.annonces
    set statut = 'expiree', updated_at = now()
    where statut = 'active'
      and expires_at < now();
  $$
);

-- ── 2. Cron purge-expired-annonces (03:00) ─────────────────────────────────
-- Sélectionne les annonces expirees au-delà de 28j (fenêtre de prolongation
-- Leboncoin terminée), POST les paths photos à l'Edge Function via pg_net,
-- puis DELETE les rows. La cascade FK supprimera plus tard les conversations,
-- transactions, etc. (à venir migrations suivantes).
--
-- Stratégie best-effort : on POST à l'Edge Function (async, fire-and-forget
-- via pg_net.http_post qui retourne un request_id sans attendre la réponse),
-- puis DELETE. Si le POST échoue ou que la fonction crashe, les photos
-- deviennent orphelines mais la DB reste cohérente. Un sweep manuel admin
-- (TODO Phase 2) pourra les rattraper via un diff bucket vs DB.

create or replace function public.fn_purge_expired_annonces()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purge_url   text;
  v_purge_token text;
  v_paths       text[];
  v_chunk       text[];
  v_chunk_size  int := 100;  -- doit matcher MAX_PATHS_PER_CALL côté Edge Function
  v_offset      int := 0;
begin
  -- Lecture des secrets Vault (URL + token Bearer)
  select decrypted_secret into v_purge_url
    from vault.decrypted_secrets
    where name = 'purge_function_url'
    limit 1;
  select decrypted_secret into v_purge_token
    from vault.decrypted_secrets
    where name = 'purge_auth_token'
    limit 1;

  if v_purge_url is null or v_purge_token is null then
    raise warning 'fn_purge_expired_annonces : secrets Vault manquants (purge_function_url, purge_auth_token). Skip.';
    return;
  end if;

  -- Aggrège tous les photo paths des annonces à purger
  select coalesce(array_agg(p), '{}')
    into v_paths
    from (
      select unnest(photos) as p
      from public.annonces
      where statut = 'expiree'
        and expires_at < now() - interval '28 days'
    ) sub;

  -- POST par chunks de 100 (limite Edge Function)
  while v_offset < array_length(v_paths, 1) loop
    v_chunk := v_paths[v_offset + 1 : v_offset + v_chunk_size];
    perform net.http_post(
      url := v_purge_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_purge_token
      ),
      body := jsonb_build_object('paths', to_jsonb(v_chunk))
    );
    v_offset := v_offset + v_chunk_size;
  end loop;

  -- DELETE les rows. La RLS owner_delete ne s'applique pas aux SECURITY
  -- DEFINER functions, donc on peut delete tout ce qui matche.
  delete from public.annonces
  where statut = 'expiree'
    and expires_at < now() - interval '28 days';
end;
$$;

revoke all on function public.fn_purge_expired_annonces() from public;
-- pas de grant : seul le cron (postgres role) appelle cette fonction

select cron.unschedule('purge-expired-annonces') where exists (
  select 1 from cron.job where jobname = 'purge-expired-annonces'
);

select cron.schedule(
  'purge-expired-annonces',
  '0 3 * * *',
  $$ select public.fn_purge_expired_annonces(); $$
);

-- ── 3. RPC fn_prolonger_annonce — réactivation 28j post-expiration ──────────
-- Source : spec lignes 1002-1029, mais on lit vendeur_id depuis auth.uid()
-- au lieu de le passer en argument (sinon n'importe qui pourrait prolonger
-- l'annonce de n'importe qui en truquant l'argument).

create or replace function public.fn_prolonger_annonce(p_annonce_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_annonce  public.annonces%rowtype;
  v_deadline timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_annonce from public.annonces where id = p_annonce_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if v_annonce.vendeur_id != auth.uid() then
    return jsonb_build_object('success', false, 'error', 'not_owner');
  end if;

  if v_annonce.statut != 'expiree' then
    return jsonb_build_object('success', false, 'error', 'not_expired');
  end if;

  v_deadline := v_annonce.expires_at + interval '28 days';
  if now() > v_deadline then
    return jsonb_build_object(
      'success', false,
      'error', 'window_closed',
      'deadline', v_deadline
    );
  end if;

  update public.annonces
  set statut = 'active',
      expires_at = now() + interval '60 days',
      updated_at = now()
  where id = p_annonce_id;

  return jsonb_build_object(
    'success', true,
    'new_expires_at', now() + interval '60 days'
  );
end;
$$;

revoke all on function public.fn_prolonger_annonce(uuid) from public;
grant execute on function public.fn_prolonger_annonce(uuid) to authenticated;

-- ── 4. RPC fn_increment_views — increment atomique nb_vues ──────────────────
-- Accessible anon (browse-first : les vues anonymes comptent pour les
-- statistiques vendeur). Pas de gate auth.uid().

create or replace function public.fn_increment_views(p_annonce_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.annonces
  set nb_vues = nb_vues + 1
  where id = p_annonce_id
    and statut = 'active';  -- on ne compte pas les vues d'annonces non-actives
end;
$$;

revoke all on function public.fn_increment_views(uuid) from public;
grant execute on function public.fn_increment_views(uuid) to authenticated, anon;

-- ── 5. RPC get_user_public_profile — profil public read-only ────────────────
-- SECURITY DEFINER pour bypass la RLS users_own_profile (qui restreint à
-- auth.uid() = id). Retourne uniquement les colonnes safe pour l'affichage
-- d'un profil vendeur public. Accessible anon (browse-first).
--
-- Calcule nom_initial = première lettre du nom + "." (ex: "Konan" → "K.")
-- pour respecter la minimisation RGPD (pas de nom complet exposé).

create or replace function public.get_user_public_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
begin
  select * into v_user from public.users where id = p_user_id;

  if not found or v_user.is_active = false then
    return null;
  end if;

  return jsonb_build_object(
    'id',            v_user.id,
    'prenom',        v_user.prenom,
    'nom_initial',   upper(left(v_user.nom, 1)) || '.',
    'avatar_url',    v_user.avatar_url,
    'pays',          v_user.pays,
    'ville',         v_user.ville,
    'note_vendeur',  v_user.note_vendeur,
    'nb_ventes',     v_user.nb_ventes,
    'created_at',    v_user.created_at
  );
end;
$$;

revoke all on function public.get_user_public_profile(uuid) from public;
grant execute on function public.get_user_public_profile(uuid) to authenticated, anon;

-- ── 6. Trigger anti-spam — max 5 annonces / 24h / user ──────────────────────
-- Vérifie avant chaque INSERT que le vendeur n'a pas déjà créé 5 annonces
-- dans les dernières 24h. Empêche le spam massif (CDC §F02 anti-abus).
-- Le compte porte sur created_at, pas sur statut : une annonce expirée ou
-- vendue compte aussi (sinon contournement trivial : créer 5, attendre que
-- le cron expire, recréer 5).

create or replace function public.enforce_annonces_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_limit int := 5;
begin
  select count(*) into v_count
    from public.annonces
    where vendeur_id = NEW.vendeur_id
      and created_at > now() - interval '24 hours';

  if v_count >= v_limit then
    raise exception 'rate_limit_announces'
      using
        hint = format(
          'Tu as atteint la limite de %s nouvelles annonces par 24h. Réessaie plus tard.',
          v_limit
        ),
        errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists enforce_annonces_rate_limit_trigger on public.annonces;
create trigger enforce_annonces_rate_limit_trigger
  before insert on public.annonces
  for each row
  execute function public.enforce_annonces_rate_limit();
