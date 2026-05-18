-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 40 — Cleanup v3.14 : drop conversations.statut + enum statut_conv
--
-- L'enum statut_conv était piloté par le module transactions (v3.14, escrow)
-- qui n'existe plus en v4.0. La colonne `conversations.statut` :
--   - 'ouverte' : default à la création (set par RPC get_or_create_conversation)
--   - 'en_transaction' : était set au start de l'escrow → jamais set en v4.0
--   - 'fermee' : était set après dispute resolution → jamais set en v4.0
-- + le frontend ne lit jamais cette colonne.
--
-- → Drop column + enum. Allège le schéma. On rajoutera quelque chose si on
-- en a besoin un jour.
--
-- Prérequis : aucun usage actif (vérifié via grep frontend + RPCs).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Recréer get_or_create_conversation SANS référence à v_conv.statut
-- (le %rowtype va planter sinon après drop de la colonne)

create or replace function public.get_or_create_conversation(p_annonce_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_vendeur_id uuid;
  v_statut     statut_annonce;
  v_conv       public.conversations%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select vendeur_id, statut into v_vendeur_id, v_statut
  from public.annonces
  where id = p_annonce_id;

  if v_vendeur_id is null then
    return jsonb_build_object('success', false, 'error', 'annonce_not_found');
  end if;

  if v_uid = v_vendeur_id then
    return jsonb_build_object('success', false, 'error', 'cannot_message_self');
  end if;

  if v_statut not in ('active', 'en_cours') then
    return jsonb_build_object('success', false, 'error', 'annonce_not_available');
  end if;

  insert into public.conversations (annonce_id, acheteur_id, vendeur_id)
  values (p_annonce_id, v_uid, v_vendeur_id)
  on conflict (annonce_id, acheteur_id) do nothing;

  select * into v_conv
  from public.conversations
  where annonce_id = p_annonce_id
    and acheteur_id = v_uid;

  return jsonb_build_object(
    'success', true,
    'conversation', jsonb_build_object(
      'id', v_conv.id,
      'annonce_id', v_conv.annonce_id,
      'acheteur_id', v_conv.acheteur_id,
      'vendeur_id', v_conv.vendeur_id,
      'created_at', v_conv.created_at
    )
  );
end;
$$;

revoke all on function public.get_or_create_conversation(uuid) from public;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;

-- 2. Drop la colonne statut sur conversations
alter table public.conversations drop column if exists statut;

-- 3. Drop l'enum (nécessite que plus aucune table ne l'utilise)
drop type if exists statut_conv;

-- Note : l'enum type_message ('texte', 'offre_prix', 'systeme', 'image') est
-- conservé. 'offre_prix' et 'image' sont des features Phase 2 documentées
-- dans le CDC, pas du poids mort.
