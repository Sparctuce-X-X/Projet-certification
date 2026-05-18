-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 66 — Push notif sur proposition RDV (F10)
--
-- La mig 65 a un trigger sur `rdv_confirme_at` (notif "RDV confirmé") mais
-- pas sur `rdv_propose_at`. Conséquence : quand A propose un RDV, B ne reçoit
-- aucune notif — il doit ouvrir le chat manuellement pour voir la demande.
--
-- Cette migration ajoute :
--   1. Trigger fn_push_rdv_proposed → notif à l'autre participant quand
--      rdv_propose_at passe NULL → set (= proposition d'un nouveau RDV)
--   2. Refonte fn_push_rdv_confirmed → notifie SEULEMENT le proposeur
--      (celui qui a confirmé sait qu'il a confirmé, c'est l'autre qui
--      attendait la réponse)
--   3. (bonus) Trigger fn_push_rdv_annule → notif à l'autre quand annulation
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigger : RDV proposé ────────────────────────────────────────────────

create or replace function public.fn_push_rdv_proposed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destinataire_id  uuid;
  v_proposeur_prenom text;
begin
  -- Ne fire que sur transition NULL → set de rdv_propose_at
  -- (re-propositions après annulation : OLD.rdv_propose_at peut être non-NULL
  -- mais OLD.rdv_annule_at est non-NULL aussi → on accepte ce cas)
  if NEW.rdv_propose_at is null then return NEW; end if;
  if OLD.rdv_propose_at is not null and NEW.rdv_propose_at = OLD.rdv_propose_at then
    return NEW;
  end if;

  -- Destinataire = l'autre participant (pas le proposeur)
  v_destinataire_id := case
    when NEW.rdv_propose_par = NEW.acheteur_id then NEW.vendeur_id
    when NEW.rdv_propose_par = NEW.vendeur_id then NEW.acheteur_id
    else null
  end;

  if v_destinataire_id is null then return NEW; end if;

  select coalesce(prenom, 'Quelqu''un') into v_proposeur_prenom
    from public.users where id = NEW.rdv_propose_par;

  perform public._notify_push(
    array[v_destinataire_id],
    coalesce(v_proposeur_prenom, 'Quelqu''un') || ' te propose un RDV',
    'Le ' ||
      to_char(NEW.rdv_date at time zone 'Africa/Abidjan', 'DD/MM "à" HH24"h"MI') ||
      coalesce(' à ' || NEW.rdv_lieu, '') ||
      ' — Confirme depuis le chat',
    jsonb_build_object('conversation_id', NEW.id::text)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_push_rdv_proposed on public.conversations;
create trigger trg_push_rdv_proposed
  after update of rdv_propose_at on public.conversations
  for each row
  execute function public.fn_push_rdv_proposed();

-- ── 2. Refonte trigger RDV confirmé : notifie seulement le proposeur ────────

create or replace function public.fn_push_rdv_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destinataire_id uuid;
begin
  -- Ne fire que sur transition NULL → set de rdv_confirme_at
  if NEW.rdv_confirme_at is null or OLD.rdv_confirme_at is not null then
    return NEW;
  end if;

  -- Le destinataire = le proposeur (qui attendait la confirmation).
  -- Celui qui confirme sait qu'il a confirmé, pas besoin de notif.
  v_destinataire_id := NEW.rdv_propose_par;

  -- Fallback : si rdv_propose_par est null (cas exotique), notif les 2
  if v_destinataire_id is null then
    perform public._notify_push(
      array[NEW.acheteur_id, NEW.vendeur_id],
      'RDV confirmé',
      'Vous vous retrouvez le ' ||
        to_char(NEW.rdv_date at time zone 'Africa/Abidjan', 'DD/MM "à" HH24"h"MI') ||
        coalesce(' à ' || NEW.rdv_lieu, ''),
      jsonb_build_object('conversation_id', NEW.id::text)
    );
    return NEW;
  end if;

  perform public._notify_push(
    array[v_destinataire_id],
    'RDV confirmé !',
    'Vous vous retrouvez le ' ||
      to_char(NEW.rdv_date at time zone 'Africa/Abidjan', 'DD/MM "à" HH24"h"MI') ||
      coalesce(' à ' || NEW.rdv_lieu, ''),
    jsonb_build_object('conversation_id', NEW.id::text)
  );

  return NEW;
end;
$$;

-- (le trigger trg_push_rdv_confirmed est déjà attaché par mig 65, pas à recréer)

-- ── 3. Trigger : RDV annulé (bonus, parité avec proposition/confirmation) ───

create or replace function public.fn_push_rdv_annule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destinataire_id  uuid;
  v_annuleur_prenom  text;
begin
  if NEW.rdv_annule_at is null or OLD.rdv_annule_at is not null then
    return NEW;
  end if;

  -- L'autre = celui qui n'a PAS annulé
  v_destinataire_id := case
    when NEW.rdv_annule_par = NEW.acheteur_id then NEW.vendeur_id
    when NEW.rdv_annule_par = NEW.vendeur_id then NEW.acheteur_id
    else null
  end;

  if v_destinataire_id is null then return NEW; end if;

  select coalesce(prenom, 'Quelqu''un') into v_annuleur_prenom
    from public.users where id = NEW.rdv_annule_par;

  perform public._notify_push(
    array[v_destinataire_id],
    coalesce(v_annuleur_prenom, 'Quelqu''un') || ' a annulé le RDV',
    'Vous pouvez en proposer un nouveau depuis le chat.',
    jsonb_build_object('conversation_id', NEW.id::text)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_push_rdv_annule on public.conversations;
create trigger trg_push_rdv_annule
  after update of rdv_annule_at on public.conversations
  for each row
  execute function public.fn_push_rdv_annule();
