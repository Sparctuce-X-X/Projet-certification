-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 26 — Fix compteurs signalements + suspension auto à la réception
--
-- Problèmes corrigés :
--   1. nb_signalements ne s'incrémente pas à la création d'un signalement
--   2. CDC v4.0 §2.7 : "annonce suspendue après 3 signalements en_attente"
--      → il faut aussi suspendre l'annonce (pas seulement le compte)
--
-- Deux triggers distincts :
--   A. AFTER INSERT sur signalements → incrémente nb_signalements sur le
--      user ciblé. Si ≥ 3 signalements en_attente sur la même annonce →
--      annonce suspendue automatiquement.
--   B. AFTER UPDATE sur signalements (déjà migration 25) → quand admin
--      confirme ('traite') → incrémente score_abus. Si ≥ 3 score_abus
--      en 30j → compte suspendu.
--
-- Résumé des compteurs :
--   nb_signalements = total signalements REÇUS (incrémenté à la création)
--   score_abus      = signalements CONFIRMÉS par admin (incrémenté au traité)
--
-- Prérequis : migration 25 (signalements).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Trigger A : AFTER INSERT — incrémente nb_signalements + suspend annonce ─

create or replace function public.fn_signalement_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user_id uuid;
  v_pending_count int;
begin
  -- Déterminer le user ciblé
  if NEW.target_type = 'utilisateur' then
    v_target_user_id := NEW.target_id;
  elsif NEW.target_type = 'annonce' then
    select vendeur_id into v_target_user_id
    from public.annonces where id = NEW.target_id;
  elsif NEW.target_type = 'message' then
    select expediteur_id into v_target_user_id
    from public.messages where id = NEW.target_id;
  end if;

  if v_target_user_id is null then
    return NEW;
  end if;

  -- Incrémenter nb_signalements (total reçus, pas confirmés)
  update public.users
  set nb_signalements = nb_signalements + 1
  where id = v_target_user_id;

  -- CDC v4.0 §2.7 : annonce suspendue après 3 signalements en_attente
  if NEW.target_type = 'annonce' then
    select count(*) into v_pending_count
    from public.signalements
    where target_type = 'annonce'
      and target_id = NEW.target_id
      and statut = 'en_attente';

    if v_pending_count >= 3 then
      update public.annonces
      set statut = 'suspendue'
      where id = NEW.target_id
        and statut = 'active';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_signalement_on_insert on public.signalements;
create trigger tg_signalement_on_insert
  after insert on public.signalements
  for each row
  execute function public.fn_signalement_on_insert();
