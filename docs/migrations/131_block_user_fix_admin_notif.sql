-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 131 — Fix block_user : email admin déclenché même si déjà signalé
--
-- PROBLÈME (constaté 2026-05-15)
--   Le RPC block_user (mig 129) catch `unique_violation` quand l'utilisateur
--   avait déjà signalé le même user avant de le bloquer. Conséquence :
--   l'INSERT signalements n'a pas lieu → trigger AFTER INSERT
--   tg_admin_notif_signalement (mig 125) ne fire pas → pas d'email admin.
--
--   Or l'utilisateur qui PASSE à bloquer après avoir signalé est un signal
--   plus fort à l'admin : "ce user est suffisamment problématique pour que
--   le signaleur ait coupé tout contact". L'admin doit être notifié.
--
-- CORRECTION
--   - Remplace l'INSERT + EXCEPTION par INSERT ... ON CONFLICT DO UPDATE :
--       - row INSERT (premier signalement par cet user)
--           → AFTER INSERT trigger fire → email auto ✅
--       - row UPDATE (signalement existait déjà)
--           → AFTER INSERT ne fire pas (c'est un UPDATE)
--           → on appelle manuellement _notify_admin_email avec l'id existant
--   - Update remet aussi statut='en_attente' (si admin avait déjà traité/
--     rejeté, le block est une nouvelle alerte) et update motif/description.
--   - Detection insert vs update via `xmax = 0` (trick Postgres standard).
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + task #20.
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_signalement_id uuid;
  v_was_inserted boolean;
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
  v_signalement_motif := coalesce(
    'Bloqué : ' || left(p_reason, 90),
    'Bloqué par utilisateur'
  );
  v_signalement_desc := coalesce(
    p_reason,
    'Blocage déclenché par l''utilisateur depuis l''app (sans motif détaillé fourni).'
  );

  -- INSERT ou UPDATE : si signalement déjà existant (unique constraint
  -- signalements_unique_per_user), on update son motif/description/statut
  -- pour refléter que le user est passé à l'action plus forte (block).
  -- `xmax = 0` retourne TRUE si la row a été INSERTED, FALSE si UPDATED.
  begin
    insert into public.signalements (target_type, target_id, signaleur_id, motif, description)
    values ('utilisateur', p_target_id, v_uid, v_signalement_motif, v_signalement_desc)
    on conflict on constraint signalements_unique_per_user
    do update set
      motif = excluded.motif,
      description = excluded.description,
      -- Remet en attente si admin avait déjà traité/rejeté — le block est
      -- une nouvelle alerte qui mérite d'être ré-examinée.
      statut = 'en_attente',
      updated_at = now()
    returning id, (xmax = 0) into v_signalement_id, v_was_inserted;

    -- Si c'est un UPDATE (signalement préexistant), le trigger AFTER INSERT
    -- tg_admin_notif_signalement (mig 125) n'a pas fire. On déclenche
    -- manuellement l'envoi d'email admin pour notifier le passage au block.
    if not v_was_inserted and v_signalement_id is not null then
      perform public._notify_admin_email('signalement', v_signalement_id);
    end if;
    -- Si v_was_inserted = TRUE : le trigger AFTER INSERT a déjà fait le boulot.
  exception
    when others then
      -- N'importe quelle erreur sur le signalement ne doit pas annuler le
      -- block (Apple peut le voir comme un échec de la feature). On swallow
      -- avec un raise notice pour debug.
      raise notice 'block_user: signalement upsert non-critical failure: %', sqlerrm;
  end;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.block_user(uuid, text) from public;
grant execute on function public.block_user(uuid, text) to authenticated;

comment on function public.block_user(uuid, text) is
  'Bloque un user. INSERT ON CONFLICT signalements (mig 131 fix mig 129) — email admin garanti même si signalement déjà existant. SECURITY DEFINER avec auth.uid() check.';
