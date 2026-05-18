-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 39 — Cycle de vie des annonces v4.0
--
-- Donne enfin un sens aux statuts `en_cours` et `vendue` (orphelins depuis la
-- suppression du module transactions en v4.0). Et préserve l'historique des
-- avis quand une annonce est purgée.
--
-- Composants :
--   1. ALTER FK conversations.annonce_id : on delete cascade → on delete set null
--      + drop not null. Préserve conversations + messages + avis quand une
--      annonce est purgée à J+88. Le code FE gère déjà 'Annonce supprimée'.
--
--   2. Trigger sur conversations : confirm_rdv → annonce.statut = 'en_cours'
--      (si active). cancel_rdv → revert à 'active' si plus aucun RDV confirmé
--      sur l'annonce.
--
--   3. RPC mark_annonce_vendue : action manuelle vendeur, après ≥1 RDV passé.
--
-- Prérequis : migrations 15 (annonces), 22 (conversations), 35 (RDV).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. ALTER FK conversations.annonce_id — on delete set null ──────────────

alter table public.conversations
  drop constraint if exists conversations_annonce_id_fkey;

alter table public.conversations
  alter column annonce_id drop not null;

alter table public.conversations
  add constraint conversations_annonce_id_fkey
  foreign key (annonce_id) references public.annonces(id) on delete set null;

-- ── 2. Trigger statut annonce sur confirm/cancel RDV ──────────────────────
-- À chaque UPDATE de rdv_confirme_at sur conversations, on calcule s'il y a
-- au moins un RDV confirmé actif sur l'annonce. Si oui → en_cours. Sinon → active.
-- Ne touche que les statuts active <-> en_cours (pas vendue/expiree/suspendue).

create or replace function public.fn_annonce_statut_on_rdv_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_annonce_id uuid;
  v_has_confirmed boolean;
begin
  -- Ne réagir que si rdv_confirme_at a changé d'état (null <-> non-null)
  if (OLD.rdv_confirme_at is null) = (NEW.rdv_confirme_at is null) then
    return NEW;
  end if;

  -- L'annonce peut être null si déjà purgée — rien à faire
  v_target_annonce_id := NEW.annonce_id;
  if v_target_annonce_id is null then
    return NEW;
  end if;

  -- Y a-t-il au moins un RDV confirmé actif sur cette annonce ?
  select exists (
    select 1 from public.conversations
    where annonce_id = v_target_annonce_id
      and rdv_confirme_at is not null
  ) into v_has_confirmed;

  if v_has_confirmed then
    -- Au moins un RDV confirmé → marquer "négo en cours" (uniquement si active)
    update public.annonces
    set statut = 'en_cours', updated_at = now()
    where id = v_target_annonce_id
      and statut = 'active';
  else
    -- Plus aucun RDV confirmé → retour à active (uniquement si en_cours)
    update public.annonces
    set statut = 'active', updated_at = now()
    where id = v_target_annonce_id
      and statut = 'en_cours';
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_annonce_statut_on_rdv_change on public.conversations;
create trigger tg_annonce_statut_on_rdv_change
  after update of rdv_confirme_at on public.conversations
  for each row
  execute function public.fn_annonce_statut_on_rdv_change();

-- ── 3. RPC mark_annonce_vendue ────────────────────────────────────────────
-- Le vendeur peut marquer son annonce comme vendue, à condition d'avoir au
-- moins une conversation avec un RDV confirmé ET passé. Garde-fou contre
-- les abus (marquer vendue sans aucune trace de transaction réelle).

create or replace function public.mark_annonce_vendue(p_annonce_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_annonce public.annonces%rowtype;
  v_has_past_rdv boolean;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_annonce
  from public.annonces
  where id = p_annonce_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'annonce_not_found');
  end if;

  if v_annonce.vendeur_id != v_uid then
    return jsonb_build_object('success', false, 'error', 'not_owner');
  end if;

  if v_annonce.statut not in ('active', 'en_cours') then
    return jsonb_build_object('success', false, 'error', 'invalid_state');
  end if;

  -- Au moins un RDV confirmé passé sur cette annonce
  select exists (
    select 1 from public.conversations
    where annonce_id = p_annonce_id
      and rdv_confirme_at is not null
      and rdv_date < now()
  ) into v_has_past_rdv;

  if not v_has_past_rdv then
    return jsonb_build_object('success', false, 'error', 'no_past_rdv');
  end if;

  update public.annonces
  set statut = 'vendue', updated_at = now()
  where id = p_annonce_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.mark_annonce_vendue(uuid) from public;
grant execute on function public.mark_annonce_vendue(uuid) to authenticated;
