-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 27 — Auto-remplir description signalement avec le contenu de la cible
--
-- Quand un user signale un message, une annonce ou un utilisateur, la RPC
-- stocke automatiquement un résumé de la cible dans `description` pour que
-- l'admin puisse traiter le signalement sans faire de jointure manuelle.
--
-- Prérequis : migration 25 (signalements).
-- Idempotente (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_report(
  p_target_type cible_signalement,
  p_target_id uuid,
  p_motif text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exists boolean;
  v_auto_desc text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Anti-auto-signalement (cible utilisateur)
  if p_target_type = 'utilisateur' and p_target_id = v_uid then
    return jsonb_build_object('success', false, 'error', 'cannot_report_self');
  end if;

  -- Vérifier que la cible existe + récupérer un résumé pour la description
  if p_target_type = 'annonce' then
    select true, '[Annonce] ' || titre || ' — ' || left(description, 200)
    into v_exists, v_auto_desc
    from public.annonces where id = p_target_id;
  elsif p_target_type = 'utilisateur' then
    select true, '[User] ' || prenom || ' ' || upper(left(nom, 1)) || '. — ' || ville || ', ' || pays
    into v_exists, v_auto_desc
    from public.users where id = p_target_id;
  elsif p_target_type = 'message' then
    select true, '[Message] ' || left(contenu, 500)
    into v_exists, v_auto_desc
    from public.messages where id = p_target_id;
  end if;

  if not coalesce(v_exists, false) then
    return jsonb_build_object('success', false, 'error', 'target_not_found');
  end if;

  -- Description : préfère celle du client si fournie, sinon auto-générée
  if p_description is null or trim(p_description) = '' then
    p_description := v_auto_desc;
  end if;

  -- Insert (le UNIQUE constraint gère le doublon)
  begin
    insert into public.signalements (target_type, target_id, signaleur_id, motif, description)
    values (p_target_type, p_target_id, v_uid, p_motif, p_description);
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'error', 'already_reported');
  end;

  return jsonb_build_object('success', true);
end;
$$;
