-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 129 — Bloquer un utilisateur (Apple Guideline 1.2 UGC compliance)
--
-- CONTEXTE
--   Apple a rejeté iOS 1.0.0 (4) le 2026-05-15 pour Guideline 1.2 Safety —
--   User Generated Content : "A mechanism for users to block abusive users.
--   Blocking should also notify the developer of the inappropriate content
--   and should remove it from the user's feed instantly."
--
--   Google Play UGC policy exige la même chose (filter + report + block). Cette
--   mig + mig 130 + UI mobile + filter front règle ce blocker pour les 2 stores.
--
-- CE QUE FAIT CETTE MIG
--   1. Table public.blocked_users (blocker_id, blocked_id, reason, created_at)
--   2. RLS owner-scoped (auth.uid() = blocker_id pour select/insert/delete)
--   3. RPC block_user(target_id, reason) :
--      - Vérifie auth, anti-self-block, cible existe
--      - INSERT blocked_users
--      - INSERT signalement implicite (notification developer per Apple)
--   4. RPC unblock_user(target_id) : DELETE blocked_users
--   5. Add to supabase_realtime publication (sync UI immédiat)
--
-- ARCHITECTURE NOTIFY DEVELOPER
--   Apple exige que le block "notifie le developer". On crée un signalement
--   automatique target_type='utilisateur' au moment du block. Si le user a déjà
--   un signalement actif (unique constraint), on ne re-fait pas (silent).
--   L'admin web (landing/admin/signalements) verra le motif "Bloqué par
--   utilisateur" et pourra investiguer.
--
-- ARCHITECTURE REMOVE FROM FEED INSTANTLY
--   - Mig 130 ajoute un trigger BEFORE INSERT messages qui raise si destinataire
--     a bloqué expéditeur (côté bloqué, son envoi de message échoue).
--   - Côté client mobile, un hook useBlockedUsers() filter les annonces et
--     conversations du bloqué via .not('vendeur_id', 'in', blockedIds).
--   - Realtime sync via publication supabase_realtime : add to blocked_users
--     déclenche un update instantané sur tous les devices du blocker.
--
-- LIMITES
--   - Le bloqué peut toujours voir les annonces du bloqueur (asymétrique
--     intentionnel — empêche stalking/contournement via création de nouveau
--     compte côté bloqueur). Standard de l'industrie (Twitter, Insta, etc.).
--   - Le bloqué ne sait pas qu'il a été bloqué (pas de notification visible).
--     Si tente d'envoyer un message, erreur générique côté client.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + task #20.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table blocked_users ─────────────────────────────────────────────────

create table if not exists public.blocked_users (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  reason     text null check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

comment on table public.blocked_users is
  'User-to-user block list. blocker has blocked blocked. Owner-scoped via RLS. Required by Apple Guideline 1.2 UGC + Google Play UGC policy (mig 129).';

-- Index pour les queries inverses (qui a bloqué cet user — pour stats admin)
create index if not exists idx_blocked_users_blocked
  on public.blocked_users (blocked_id, created_at desc);

-- ── 2. RLS owner-scoped ────────────────────────────────────────────────────

alter table public.blocked_users enable row level security;

drop policy if exists blocked_users_own_select on public.blocked_users;
create policy blocked_users_own_select on public.blocked_users
  for select using (auth.uid() = blocker_id);

drop policy if exists blocked_users_own_insert on public.blocked_users;
create policy blocked_users_own_insert on public.blocked_users
  for insert with check (auth.uid() = blocker_id);

drop policy if exists blocked_users_own_delete on public.blocked_users;
create policy blocked_users_own_delete on public.blocked_users
  for delete using (auth.uid() = blocker_id);

-- Pas de UPDATE — le motif est figé au moment du block. Pour changer, unblock + re-block.

-- ── 3. Realtime publication (sync UI sur block/unblock) ────────────────────

-- Ajoute la table à la publication supabase_realtime pour que le hook
-- useBlockedUsers reçoive les events INSERT/DELETE en realtime sans polling.
-- Idempotent : si déjà présente, alter publication ne fail pas (Postgres 15+).

do $$
begin
  alter publication supabase_realtime add table public.blocked_users;
exception
  when duplicate_object then null;
  when others then
    -- publication n'existe pas (test env) — skip silencieusement
    null;
end $$;

-- ── 4. RPC block_user ──────────────────────────────────────────────────────
-- Création atomique : blocked_users + signalement implicite.
-- SECURITY DEFINER pour bypass RLS sur l'INSERT signalements (le signaleur est
-- l'user qui block, donc auth.uid() = signaleur_id passe la policy, mais la
-- function se simplifie en SECURITY DEFINER + check explicite).

create or replace function public.block_user(
  p_target_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_exists boolean;
  v_already_blocked boolean;
  v_signalement_motif text;
  v_signalement_desc text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Anti-self-block
  if v_uid = p_target_id then
    return jsonb_build_object('success', false, 'error', 'cannot_block_self');
  end if;

  -- Système user (Niqo Auto-Modération) ne peut pas être bloqué
  if p_target_id = '00000000-0000-0000-0000-000000000001'::uuid then
    return jsonb_build_object('success', false, 'error', 'cannot_block_system');
  end if;

  -- Check cible existe
  select exists(select 1 from public.users where id = p_target_id) into v_target_exists;
  if not v_target_exists then
    return jsonb_build_object('success', false, 'error', 'target_not_found');
  end if;

  -- Check anti-doublon (équivalent au PK constraint mais retour structuré)
  select exists(
    select 1 from public.blocked_users
    where blocker_id = v_uid and blocked_id = p_target_id
  ) into v_already_blocked;

  if v_already_blocked then
    return jsonb_build_object('success', false, 'error', 'already_blocked');
  end if;

  -- INSERT blocked_users (PK constraint protège contre race condition)
  begin
    insert into public.blocked_users (blocker_id, blocked_id, reason)
    values (v_uid, p_target_id, p_reason);
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'error', 'already_blocked');
  end;

  -- "Notify the developer" per Apple Guideline 1.2
  -- Crée un signalement implicite target_type='utilisateur'. Si déjà signalé
  -- par cet user (unique constraint signalements_unique_per_user), on swallow.
  v_signalement_motif := coalesce(
    'Bloqué : ' || left(p_reason, 90),
    'Bloqué par utilisateur'
  );
  v_signalement_desc := coalesce(
    p_reason,
    'Blocage déclenché par l''utilisateur depuis l''app (sans motif détaillé fourni).'
  );

  begin
    insert into public.signalements (target_type, target_id, signaleur_id, motif, description)
    values ('utilisateur', p_target_id, v_uid, v_signalement_motif, v_signalement_desc);
  exception
    when unique_violation then
      -- Déjà signalé par cet user, le block suffit en tant que mécanisme
      null;
    when others then
      -- N'importe quelle autre erreur sur le signalement ne doit pas annuler
      -- le block (Apple peut le voir comme un échec de la feature). On swallow.
      raise notice 'block_user: signalement insert non-critical failure (block reste valide)';
  end;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.block_user(uuid, text) from public;
grant execute on function public.block_user(uuid, text) to authenticated;

comment on function public.block_user(uuid, text) is
  'Bloque un user. Crée blocked_users + signalement implicite (Apple 1.2 notify developer). SECURITY DEFINER avec auth.uid() check (mig 129).';

-- ── 5. RPC unblock_user ────────────────────────────────────────────────────

create or replace function public.unblock_user(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted_count int;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  delete from public.blocked_users
  where blocker_id = v_uid and blocked_id = p_target_id;

  get diagnostics v_deleted_count = row_count;

  -- Idempotent : si rien à delete, on retourne quand même success
  -- (l'user peut spam le bouton unblock sans erreur).

  return jsonb_build_object(
    'success', true,
    'was_blocked', v_deleted_count > 0
  );
end;
$$;

revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.unblock_user(uuid) to authenticated;

comment on function public.unblock_user(uuid) is
  'Déblocage idempotent (mig 129). Retourne was_blocked=false si rien à supprimer.';

-- ── 6. RPC is_user_blocked (helper for client filter) ──────────────────────
-- Helper utilisé par le hook useBlockedUsers pour fetch en bulk la liste des
-- IDs bloqués par l'user courant. Évite N+1 queries côté front.

create or replace function public.get_my_blocked_user_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select blocked_id from public.blocked_users where blocker_id = auth.uid();
$$;

revoke all on function public.get_my_blocked_user_ids() from public;
grant execute on function public.get_my_blocked_user_ids() to authenticated;

comment on function public.get_my_blocked_user_ids() is
  'Returns the list of user IDs blocked by the current authenticated user. Bulk fetch for client-side filter (mig 129).';
