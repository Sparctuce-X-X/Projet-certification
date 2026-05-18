-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 94 — Security Advisor Cleanup
--
-- PROBLÈME RÉSOLU
--   Audit Supabase Security Advisor (mai 2026) a remonté :
--     - 1 ERROR : view v_signalements_queue_stats en SECURITY DEFINER
--     - 5 WARN  : functions sans search_path lock (trigger PG search_path
--                 hijack potentiel)
--     - 2 WARN  : public storage buckets avec broad SELECT policy (listing
--                 leak)
--     - ~140 WARN : SECURITY DEFINER functions executable par anon/authenticated
--                   sans GRANT explicite (default PUBLIC inherit)
--
-- SECTIONS
--   1. View v_signalements_queue_stats → security_invoker = on
--   2. ALTER FUNCTION × 5 set search_path = public
--   3. DROP storage policies LIST sur buckets publics (URLs publiques OK sans)
--   4. REVOKE EXECUTE bulk par bucket :
--      A. Trigger functions       → revoke public, anon, authenticated
--      B. Cron / system           → revoke public, anon, authenticated
--      C. Encryption helpers      → revoke public, anon, authenticated
--      D. RPCs auth-only mobile   → revoke public, anon (keep authenticated)
--      E. RPCs anon-callable      → keep public/anon (browse-first + signup)
--      F. RPCs admin-only         → revoke public, anon (keep authenticated)
--      G. Helpers RLS-callable    → keep authenticated (sinon RLS casse)
--
-- IDÉE DIRECTRICE
--   Postgres grant default sur fonctions = PUBLIC (inherit anon + authenticated).
--   Pattern propre : revoke from public + grant explicit to roles needed.
--   Idempotente : on peut re-jouer la mig sans casser quoi que ce soit.
--
-- HORS SCOPE (à régler côté Dashboard Supabase, pas SQL)
--   - Activer "Leaked Password Protection" dans Authentication → Policies
--     (gratuit, check vs HaveIBeenPwned.org)
--
-- Prérequis : toutes les migs jusqu'à 93.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 1 — View v_signalements_queue_stats (FIX ERROR Advisor)        ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- En PG 15+, les views default = security_definer-like (utilisent les
-- permissions du OWNER, pas du caller). Force security_invoker pour que la
-- RLS sur signalements (signalements_admin_select) gate effectivement les
-- accès. Un non-admin verra count=0 (ce qu'on veut).

create or replace view public.v_signalements_queue_stats
with (security_invoker = on)
as
select
  count(*) filter (where statut = 'en_attente')::int as en_attente,
  count(*) filter (where statut = 'traite')::int     as traite,
  count(*) filter (where statut = 'rejete')::int     as rejete,
  count(*)::int                                       as total
from public.signalements;

grant select on public.v_signalements_queue_stats to authenticated;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 2 — search_path lock sur 5 fonctions                           ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- Anti-search-path-hijack : si un attaquant créé un schema avec une fonction
-- now() malicieuse dans son search_path, et qu'on call now() depuis une
-- SECURITY DEFINER, il peut exécuter du code arbitraire en tant que owner.
-- Lock à 'public' pour éviter ça.

alter function public.fn_enforce_annonce_no_duplicate()      set search_path = public;
alter function public.set_updated_at()                       set search_path = public;
alter function public.fn_reset_mark_vendue_reminders()       set search_path = public;
alter function public.set_annonces_expires_at()              set search_path = public;
alter function public._tz_for_pays(text)                     set search_path = public;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 3 — DROP listing policies sur buckets publics                  ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- Public buckets : accès objet par URL publique fonctionne SANS policy SELECT
-- sur storage.objects. La policy "*_public_read" ouvre en plus le LIST → leak
-- de métadonnées (nombre d'objets, patterns naming, etc.). On drop les 2.

drop policy if exists "annonces_photos_public_read" on storage.objects;
drop policy if exists "avatars_public_read"          on storage.objects;

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 4 — REVOKE EXECUTE bulk par bucket                             ║
-- ╚═════════════════════════════════════════════════════════════════════════╝

-- ───── Bucket A — Trigger functions (REVOKE public, anon, authenticated) ─────
-- Ces fonctions tournent en contexte trigger (DB owner postgres). N'ont aucune
-- raison d'être REST-callable. Les revoke ne casse pas les triggers (qui
-- n'utilisent pas la grant chain REST).

revoke execute on function public.fn_annonce_statut_on_rdv_change()       from public, anon, authenticated;
revoke execute on function public.fn_annonce_statut_on_rencontre_change() from public, anon, authenticated;
revoke execute on function public.fn_annonces_content_filter()            from public, anon, authenticated;
revoke execute on function public.fn_avis_after_delete()                  from public, anon, authenticated;
revoke execute on function public.fn_avis_after_insert()                  from public, anon, authenticated;
revoke execute on function public.fn_check_forbidden_words(text)          from public, anon, authenticated;
revoke execute on function public.fn_check_score_abus()                   from public, anon, authenticated;
revoke execute on function public.fn_enforce_annonce_no_duplicate()       from public, anon, authenticated;
revoke execute on function public.fn_messages_content_filter()            from public, anon, authenticated;
revoke execute on function public.fn_push_annonce_expired()               from public, anon, authenticated;
revoke execute on function public.fn_push_annonce_suspended()             from public, anon, authenticated;
revoke execute on function public.fn_push_avis_received()                 from public, anon, authenticated;
revoke execute on function public.fn_push_new_message()                   from public, anon, authenticated;
revoke execute on function public.fn_push_rdv_annule()                    from public, anon, authenticated;
revoke execute on function public.fn_push_rdv_confirmed()                 from public, anon, authenticated;
revoke execute on function public.fn_push_rdv_proposed()                  from public, anon, authenticated;
revoke execute on function public.fn_push_signalement_treated()           from public, anon, authenticated;
revoke execute on function public.fn_push_user_suspended()                from public, anon, authenticated;
revoke execute on function public.fn_push_verification_decided()          from public, anon, authenticated;
revoke execute on function public.fn_send_push(uuid[], text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.fn_signalement_check_threshold()        from public, anon, authenticated;
revoke execute on function public.fn_signalement_on_insert()              from public, anon, authenticated;
revoke execute on function public.fn_update_conversation_last_message()   from public, anon, authenticated;
revoke execute on function public.fn_verif_on_approve()                   from public, anon, authenticated;
revoke execute on function public.get_push_tokens_for_users(uuid[])       from public, anon, authenticated;
revoke execute on function public.handle_email_update()                   from public, anon, authenticated;
revoke execute on function public.handle_new_user()                       from public, anon, authenticated;
revoke execute on function public.inherit_annonces_pays_from_user()       from public, anon, authenticated;
revoke execute on function public.set_annonces_expires_at()               from public, anon, authenticated;
revoke execute on function public.set_updated_at()                        from public, anon, authenticated;
revoke execute on function public.fn_reset_mark_vendue_reminders()        from public, anon, authenticated;

-- ───── Bucket B — Cron / system (REVOKE public, anon, authenticated) ─────
-- Tournent uniquement via pg_cron (rôle cron) ou pg_net. Aucune raison REST.

revoke execute on function public.enforce_annonces_rate_limit()        from public, anon, authenticated;
revoke execute on function public.fn_purge_expired_annonces()          from public, anon, authenticated;
revoke execute on function public.purge_expired_boosts()               from public, anon, authenticated;
revoke execute on function public.purge_expired_kyc_verifications()    from public, anon, authenticated;
revoke execute on function public.purge_stale_push_tokens()            from public, anon, authenticated;
revoke execute on function public._tz_for_pays(text)                   from public, anon, authenticated;

-- rls_auto_enable() : présente sur la prod Supabase (helper Dashboard) mais
-- pas définie dans nos migrations versionnées → guard idempotent pour rester
-- compatible avec un `supabase start` local from-scratch (CI).
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- ───── Bucket C — Encryption helpers (REVOKE public, anon, authenticated) ─────
-- Appelées uniquement depuis d'autres SECURITY DEFINER (handle_new_user,
-- complete_my_profile, update_my_phone, get_my_phone). En SECURITY DEFINER, le
-- caller hérite des droits du DEFINER → revoke EXECUTE n'empêche pas l'usage
-- interne.

revoke execute on function public.encrypt_phone(text)  from public, anon, authenticated;
revoke execute on function public.decrypt_phone(bytea) from public, anon, authenticated;
revoke execute on function public.hash_phone(text)     from public, anon, authenticated;

-- ───── Bucket D — RPCs auth-only mobile (REVOKE anon, KEEP authenticated) ─────
-- Confirmé via grep dans lib/ + app/ : ces 23 RPCs sont appelées depuis le
-- client mobile par un user authentifié. Anon n'a aucune raison de les call.

revoke execute on function public.accept_sell_cgu()                                                from public, anon;
revoke execute on function public.add_rencontre_photo(uuid, text)                                  from public, anon;
revoke execute on function public.apply_boost(uuid, uuid, integer)                                 from public, anon;
revoke execute on function public.cancel_rdv(uuid)                                                 from public, anon;
revoke execute on function public.complete_my_profile(text, text, text, public.pays_code, text, text) from public, anon;
revoke execute on function public.confirm_rdv(uuid)                                                from public, anon;
revoke execute on function public.confirm_rencontre(uuid, boolean)                                 from public, anon;
revoke execute on function public.create_signalement_post_rdv(uuid, public.motif_signalement_rdv, text) from public, anon;
revoke execute on function public.delete_my_account()                                              from public, anon;
revoke execute on function public.fn_prolonger_annonce(uuid)                                       from public, anon;
revoke execute on function public.get_my_dashboard_stats()                                         from public, anon;
revoke execute on function public.get_my_phone()                                                   from public, anon;
revoke execute on function public.get_or_create_conversation(uuid)                                 from public, anon;
revoke execute on function public.get_pending_user_actions()                                       from public, anon;
revoke execute on function public.mark_annonce_vendue(uuid)                                        from public, anon;
revoke execute on function public.mark_messages_read(uuid)                                         from public, anon;
revoke execute on function public.propose_rdv(uuid, text, timestamptz)                             from public, anon;
revoke execute on function public.register_push_token(text, text, text)                            from public, anon;
revoke execute on function public.repair_my_profile()                                              from public, anon;
revoke execute on function public.submit_avis(uuid, smallint, text)                                from public, anon;
revoke execute on function public.submit_report(public.cible_signalement, uuid, text, text)        from public, anon;
revoke execute on function public.submit_verification(uuid, text, text, text, text)                from public, anon;
revoke execute on function public.update_my_phone(text)                                            from public, anon;
revoke execute on function public.update_my_profile(jsonb)                                         from public, anon;

-- ───── Bucket E — RPCs anon-callable (KEEP public, anon, authenticated) ─────
-- Volontairement appelables sans auth :
--   - accept_auth_cgu      : appelée pendant signup (anon = nouveau user)
--   - fn_increment_views   : browse-first sans compte (compteur vues annonce)
--   - get_user_public_profile : browse-first profil vendeur sans compte
-- → AUCUN revoke, on documente juste l'intention.
--
-- (Si une mig future change la politique browse-first, revoke ici.)

-- ───── Bucket F — RPCs admin-only (REVOKE anon, KEEP authenticated) ─────
-- Appelées depuis landing/ admin web. Le gate is_admin est dans le corps des
-- fonctions (raise si pas admin), donc même un authenticated non-admin tape
-- mur. On revoke quand même anon par défense en profondeur.

revoke execute on function public.admin_soft_delete_message(uuid)                                    from public, anon;
revoke execute on function public.admin_suspend_annonce(uuid)                                        from public, anon;
revoke execute on function public.admin_suspend_user(uuid)                                           from public, anon;
revoke execute on function public.admin_treat_signalement(uuid, text)                                from public, anon;
revoke execute on function public.admin_validate_verification(uuid, boolean, text, text)             from public, anon;
revoke execute on function public.get_admin_kpis(timestamptz, timestamptz)                           from public, anon;

-- ───── Bucket G — Helpers RLS-callable (KEEP authenticated) ─────
-- Ces 2 fonctions sont appelées DANS les expressions RLS (ex:
-- `using (is_my_account_active())`). Si on revoke EXECUTE à authenticated, la
-- RLS fail à l'évaluation → casse toutes les opérations gated. KEEP authenticated.
--
-- Anon n'a pas besoin (pas de RLS qui y appelle pour anon path), mais on garde
-- par sécurité (broad-grant default = harmless ici car la fonction lit auth.uid()
-- qui retourne null pour anon → renvoie false).

-- (no revoke — intentionnel)

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 5 — Note RLS table mots_interdits (INFO Advisor)               ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
-- Advisor remonte "RLS enabled, no policy" sur public.mots_interdits.
-- C'est volontaire : deny-by-default = aucun client ne peut lire la liste des
-- mots interdits. Seul le service_role (utilisé en interne par
-- fn_check_forbidden_words SECURITY DEFINER) peut SELECT.
-- Pas de fix nécessaire, juste un comment pour clarifier l'intention.

comment on table public.mots_interdits is
  'Liste des mots interdits pour le content filter. RLS deny-by-default volontaire : seul le service_role (via fn_check_forbidden_words SECURITY DEFINER) peut SELECT. Aucune policy = aucun client REST.';
