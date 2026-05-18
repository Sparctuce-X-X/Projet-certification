-- ─────────────────────────────────────────────────────────────────────────────
-- ASO App Store screenshots — Seed data
--
-- Objectif : générer 5 annonces + 1 conversation chat riche pour capturer
-- les 8 screenshots App Store de Niqo.
--
-- Idempotent — safe à re-run (DELETE marquée puis re-INSERT).
--
-- ⚠ PROD live — toutes les insertions sont identifiables via le marqueur
-- `__ASO_DEMO__` dans `annonces.description`. Le script de purge en miroir
-- (`purge-aso-screenshots.sql`) supprime tout proprement après captures.
--
-- ── PREREQUIS À FAIRE AVANT D'EXÉCUTER ──────────────────────────────────────
--
-- 1. Compte vendeur fictif :
--    `apple-review@niqo.africa` doit exister dans public.users. Si non,
--    exécuter d'abord `scripts/sql/pre-approve-apple-review.sql` (qui requiert
--    lui-même un sign-up préalable via l'app mobile).
--
-- 2. Compte acheteur (toi) :
--    `hdbosshdboss01@gmail.com` doit exister dans public.users
--    (normalement déjà le cas — c'est ton compte de prod).
--
-- 3. Upload 5 photos dans Supabase Storage Dashboard :
--    Bucket : `annonces-photos` (public)
--    Folder : `aso-demo/`
--    Fichiers attendus (exactement ces noms) :
--      • aso-demo/iphone14.jpg     ← photo d'un iPhone (ou objet tech premium)
--      • aso-demo/perfume.jpg      ← photo d'un coffret parfums / produit beauté
--      • aso-demo/jacket.jpg       ← photo d'une veste / vêtement
--      • aso-demo/fridge.jpg       ← photo d'un frigo / gros électroménager
--      • aso-demo/car.jpg          ← photo d'une voiture
--    Les photos peuvent venir de n'importe où (unsplash, ta galerie perso,
--    photos stock). Le bucket est public donc pas de permission à régler.
--
-- 4. Dans l'app mobile Niqo :
--    Toggle le country picker sur "Congo" (Brazzaville). Sinon le feed Home
--    affichera tes annonces CI et pas le seed CG.
--
-- ── CE QUE FAIT LE SCRIPT ──────────────────────────────────────────────────
--
-- A. Renomme apple-review@niqo.africa → Aïssatou Diallo, Brazzaville (CG),
--    vérifiée, 4.8★, 7 ventes.
-- B. Insère 5 annonces actives en CG/Brazzaville avec photos.
-- C. Crée 1 conversation entre toi (acheteur) et Aïssatou (vendeur) sur l'iPhone.
-- D. Insère 8 messages réalistes de négociation + 1 message système RDV.
-- E. Set l'état RDV à "confirmé + rencontré" → l'app activera le CTA "Noter
--    votre rencontre" (utilisé pour le screenshot #6).
--
-- ── APRÈS LES CAPTURES ─────────────────────────────────────────────────────
--
-- Lancer `scripts/sql/purge-aso-screenshots.sql` pour tout nettoyer et
-- restaurer apple-review@niqo.africa dans son état "Apple Reviewer".
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_vendeur_id   uuid;
  v_dominique_id uuid;
  v_conv_id      uuid;
  v_iphone_id    uuid;
  v_cat_phones   uuid;
  v_cat_beauty   uuid;
  v_cat_mode     uuid;
  v_cat_home     uuid;
  v_cat_vehicles uuid;
begin
  -- ── 1. Lookup users ────────────────────────────────────────────────────────
  select id into v_vendeur_id
    from public.users where email = 'apple-review@niqo.africa';
  if v_vendeur_id is null then
    raise exception 'apple-review@niqo.africa introuvable. Sign-up via app mobile + run pre-approve-apple-review.sql d''abord.';
  end if;

  select id into v_dominique_id
    from public.users where email = 'hdbosshdboss01@gmail.com';
  if v_dominique_id is null then
    raise exception 'hdbosshdboss01@gmail.com introuvable dans public.users.';
  end if;

  -- ── 2. Lookup categories (FK obligatoire) ─────────────────────────────────
  select id into v_cat_phones   from public.categories where nom ilike '%Téléphones%'      limit 1;
  select id into v_cat_beauty   from public.categories where nom ilike '%Beauté%'           limit 1;
  select id into v_cat_mode     from public.categories where nom ilike '%Mode%'             limit 1;
  select id into v_cat_home     from public.categories where nom ilike '%Maison%'           limit 1;
  select id into v_cat_vehicles from public.categories where nom ilike '%Véhicules%'        limit 1;

  if v_cat_phones is null or v_cat_beauty is null or v_cat_mode is null
     or v_cat_home is null or v_cat_vehicles is null then
    raise exception 'Une ou plusieurs catégories introuvables. Vérifie le seed migrations 13/31/32.';
  end if;

  raise notice 'Vendeur fictif: % | Dominique: %', v_vendeur_id, v_dominique_id;

  -- ── 3. Cleanup démo précédente (idempotence) ──────────────────────────────
  delete from public.messages
   where conversation_id in (
     select id from public.conversations
      where vendeur_id = v_vendeur_id
   );
  delete from public.conversations
   where vendeur_id = v_vendeur_id;
  delete from public.annonces
   where vendeur_id = v_vendeur_id
     and description like '%__ASO_DEMO__%';

  -- ── 4. Renomme + verify le vendeur fictif ─────────────────────────────────
  update public.users
     set prenom               = 'Aïssatou',
         nom                  = 'Diallo',
         ville                = 'Brazzaville',
         pays                 = 'CG',
         is_verified          = true,
         verification_paid_at = coalesce(verification_paid_at, now() - interval '90 days'),
         cgu_sell_accepted_at = coalesce(cgu_sell_accepted_at, now() - interval '90 days'),
         note_vendeur         = 4.8,
         nb_ventes            = 7
   where id = v_vendeur_id;

  -- ── 5. Insère 5 annonces en CG/Brazzaville ────────────────────────────────
  -- Triggers actifs : inherit_annonces_pays (force pays=CG depuis users.pays),
  -- set_annonces_expires_at_trigger (force +60d), enforce_annonces_rate_limit
  -- (5/24h — OK puisqu'on a delete au step 3), enforce_annonce_no_duplicate
  -- (titres tous distincts), tg_annonces_content_filter (descriptions safe).

  insert into public.annonces
    (vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, quartier)
  values
    (v_vendeur_id, v_cat_phones,
     'iPhone 14 Pro 256 Go',
     E'iPhone 14 Pro 256 Go acheté en 2024. Batterie à 92%, aucune rayure, jamais réparé. Boîte d''origine et chargeur inclus. Disponible immédiatement à Brazzaville. __ASO_DEMO__',
     350000, array['aso-demo/iphone14.jpg'], 'tres_bon', 'Brazzaville', 'Centre-ville')
   returning id into v_iphone_id;

  insert into public.annonces
    (vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, quartier)
  values
    (v_vendeur_id, v_cat_beauty,
     'Coffret parfums Dior original',
     E'Coffret 3 parfums Dior Sauvage 100ml. Achat duty-free Paris CDG, jamais ouvert, sous cellophane d''origine. Idéal cadeau. __ASO_DEMO__',
     85000, array['aso-demo/perfume.jpg'], 'neuf', 'Brazzaville', 'Plateau'),

    (v_vendeur_id, v_cat_mode,
     'Veste en cuir véritable taille M',
     E'Veste cuir véritable noir, coupe slim, taille M. Portée 2-3 fois, très bon état. Marque ZARA. __ASO_DEMO__',
     45000, array['aso-demo/jacket.jpg'], 'tres_bon', 'Brazzaville', 'Bacongo'),

    (v_vendeur_id, v_cat_home,
     'Réfrigérateur Samsung 250L No Frost',
     E'Réfrigérateur Samsung 250L deux portes, technologie No Frost. Acheté il y a 1 an, parfait état de marche. Cause déménagement. __ASO_DEMO__',
     280000, array['aso-demo/fridge.jpg'], 'tres_bon', 'Brazzaville', 'Moungali'),

    (v_vendeur_id, v_cat_vehicles,
     'Toyota Corolla 2018 Essence',
     E'Toyota Corolla 2018, 87 000 km, essence, climatisation, boîte manuelle. Entretien à jour, carnet disponible. Visible sur Brazzaville. __ASO_DEMO__',
     6500000, array['aso-demo/car.jpg'], 'bon', 'Brazzaville', 'Mpila');

  -- ── 6. Crée la conversation Dominique (acheteur) ↔ Aïssatou (vendeur) ────
  -- RDV passé + rencontre confirmée des 2 côtés → l'app activera le CTA
  -- "Noter votre rencontre" (utilisé pour screenshot #6 NOTE).
  -- Respect invariant memory feedback_rencontre_decided_at_invariant :
  -- decided_at non-null UNIQUEMENT quand les 2 ont répondu.
  insert into public.conversations
    (annonce_id, acheteur_id, vendeur_id,
     rdv_lieu, rdv_date, rdv_propose_par, rdv_propose_at, rdv_confirme_at,
     rencontre_acheteur, rencontre_vendeur, rencontre_decided_at,
     last_message_preview, last_message_at)
  values
    (v_iphone_id, v_dominique_id, v_vendeur_id,
     'Casino centre-ville, Brazzaville',
     now() - interval '1 day',                              -- RDV était hier
     v_vendeur_id,                                          -- Aïssatou a proposé
     now() - interval '2 days',                             -- Proposé il y a 2j
     now() - interval '2 days' + interval '1 hour',         -- Dominique a confirmé 1h après
     true, true,                                            -- les 2 ont validé la rencontre
     now() - interval '12 hours',                           -- Décision figée il y a 12h
     'Aïssatou propose un rendez-vous',
     now() - interval '2 days')
   returning id into v_conv_id;

  -- ── 7. Messages réalistes de négociation (8 msgs + 1 systeme RDV) ────────
  -- Content filter actif sur type='texte' (bypass type='systeme' depuis mig 35).
  -- is_read=true partout pour pas de badge unread parasite sur les screenshots.
  insert into public.messages
    (conversation_id, expediteur_id, contenu, type, is_read, created_at)
  values
    (v_conv_id, v_dominique_id, 'Bonjour, est-ce que l''iPhone est encore disponible ?',                           'texte',   true, now() - interval '3 days' + interval '0 min'),
    (v_conv_id, v_vendeur_id,   'Bonjour ! Oui il est disponible, en parfait état.',                                'texte',   true, now() - interval '3 days' + interval '4 min'),
    (v_conv_id, v_dominique_id, 'Super. Quelle est la capacité de stockage et la santé batterie ?',                 'texte',   true, now() - interval '3 days' + interval '6 min'),
    (v_conv_id, v_vendeur_id,   '256 Go, batterie à 92%. Jamais réparé, boîte et chargeur inclus.',                 'texte',   true, now() - interval '3 days' + interval '9 min'),
    (v_conv_id, v_dominique_id, 'Top. Possible un petit geste sur le prix ?',                                       'texte',   true, now() - interval '3 days' + interval '12 min'),
    (v_conv_id, v_vendeur_id,   'Je peux faire 320 000 FCFA au lieu de 350 000.',                                   'texte',   true, now() - interval '3 days' + interval '15 min'),
    (v_conv_id, v_dominique_id, 'Ça marche ! Quand est-ce qu''on peut se voir ?',                                   'texte',   true, now() - interval '3 days' + interval '17 min'),
    (v_conv_id, v_vendeur_id,   'Demain 14h chez Casino centre-ville, ça vous va ?',                                'texte',   true, now() - interval '3 days' + interval '20 min'),
    (v_conv_id, v_vendeur_id,   E'Aïssatou propose un rendez-vous :\nDemain 14h00\nCasino centre-ville, Brazzaville', 'systeme', true, now() - interval '2 days');

  raise notice 'Seed terminé : 5 annonces, 1 conversation, 9 messages, RDV rencontré. Conv ID = %', v_conv_id;
end $$;

-- ── Vérification ───────────────────────────────────────────────────────────
select
  'annonces __ASO_DEMO__' as label,
  count(*) as count
from public.annonces
where vendeur_id = (select id from public.users where email = 'apple-review@niqo.africa')
  and description like '%__ASO_DEMO__%'
union all
select
  'conversations',
  count(*)
from public.conversations
where vendeur_id = (select id from public.users where email = 'apple-review@niqo.africa')
union all
select
  'messages',
  count(*)
from public.messages
where conversation_id in (
  select id from public.conversations
  where vendeur_id = (select id from public.users where email = 'apple-review@niqo.africa')
)
union all
select
  'vendeur display',
  null
union all
select
  '  → ' || prenom || ' ' || nom || ', ' || ville || ' (' || pays || ') · ' ||
  case when is_verified then '✓ vérifié' else 'non vérifié' end || ' · ' ||
  coalesce(note_vendeur::text, '—') || '★ · ' ||
  coalesce(nb_ventes::text, '0') || ' ventes',
  null
from public.users
where email = 'apple-review@niqo.africa';
