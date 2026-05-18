-- ─────────────────────────────────────────────────────────────────────────────
-- Seed notation pour screenshot #6 — Aïssatou note Dominique 5★
--
-- À lancer APRÈS seed-aso-screenshots.sql.
--
-- Effet visuel côté Dominique (acheteur) dans le chat avec Aïssatou :
--   • Bandeau rencontre met → "Aïssatou t'a noté ⭐⭐⭐⭐⭐"
--   • Bouton coral "Noter Aïssatou" actif (myAvis=null côté Dominique)
--   • Tap → sheet de notation s'ouvre (5 étoiles + champ commentaire)
--     → C'est CE sheet qu'on capture pour l'écran #6.
--
-- Côté technique :
--   • role_auteur='vendeur' → trigger recalcule note_acheteur + nb_achats
--     de Dominique (cible). Le hack note_vendeur=4.8 d'Aïssatou n'est PAS
--     impacté (aucun avis role_auteur='acheteur' inséré).
--   • Idempotent — DELETE puis re-INSERT.
--   • La purge (purge-aso-screenshots.sql) cascade DELETE cet avis via
--     FK avis.conversation_id ON DELETE CASCADE. Trigger AFTER DELETE
--     recalcule note_acheteur de Dominique depuis ses vrais avis restants.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_vendeur_id   uuid;
  v_dominique_id uuid;
  v_conv_id      uuid := '42a29a3c-d697-4aa4-917b-cc39cbfb98a8';
begin
  select id into v_vendeur_id
    from public.users where email = 'apple-review@niqo.africa';
  select id into v_dominique_id
    from public.users where email = 'hdbosshdboss01@gmail.com';

  if v_vendeur_id is null or v_dominique_id is null then
    raise exception 'Vendeur ou acheteur introuvable. Lance d''abord seed-aso-screenshots.sql.';
  end if;

  if not exists (select 1 from public.conversations where id = v_conv_id) then
    raise exception 'Conversation % introuvable. Vérifie l''UUID dans ta DB.', v_conv_id;
  end if;

  -- Sanity check : la conv doit être en état "met" (rencontre confirmée 2 côtés)
  -- sinon le bouton "Noter" ne s'affiche pas dans l'UI.
  if not exists (
    select 1 from public.conversations
     where id = v_conv_id
       and rencontre_acheteur = true
       and rencontre_vendeur = true
       and rencontre_decided_at is not null
  ) then
    raise exception 'Conv % pas en état "met". Re-lance seed-aso-screenshots.sql.', v_conv_id;
  end if;

  -- Cleanup idempotent
  delete from public.avis
   where conversation_id = v_conv_id
     and auteur_id = v_vendeur_id
     and cible_id  = v_dominique_id;

  -- INSERT : Aïssatou (vendeur, role_auteur='vendeur') note Dominique (cible) 5★
  insert into public.avis
    (conversation_id, auteur_id, cible_id, note, commentaire, role_auteur)
  values
    (v_conv_id, v_vendeur_id, v_dominique_id, 5,
     'Très bon échange, acheteur ponctuel et sérieux. À recommander !',
     'vendeur');

  raise notice 'Avis Aïssatou → Dominique inséré (5★).';
  raise notice 'Côté Dominique : CTA "Noter Aïssatou" actif. Tap pour ouvrir le sheet de notation.';
end $$;

-- ── Vérification ───────────────────────────────────────────────────────────
select
  a.note,
  a.commentaire,
  a.role_auteur,
  u_auteur.prenom || ' ' || u_auteur.nom as auteur,
  '→' as direction,
  u_cible.prenom || ' ' || u_cible.nom as cible,
  a.created_at
from public.avis a
join public.users u_auteur on u_auteur.id = a.auteur_id
join public.users u_cible  on u_cible.id  = a.cible_id
where a.conversation_id = '42a29a3c-d697-4aa4-917b-cc39cbfb98a8';
