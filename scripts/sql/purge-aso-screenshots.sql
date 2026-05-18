-- ─────────────────────────────────────────────────────────────────────────────
-- ASO App Store screenshots — Purge data (miroir de seed-aso-screenshots.sql)
--
-- Supprime toutes les données seedées pour les captures ASO :
--   • Messages dans les conversations du vendeur fictif
--   • Conversations du vendeur fictif
--   • Annonces marquées `__ASO_DEMO__` du vendeur fictif
--   • Restaure apple-review@niqo.africa à son état "Apple Reviewer Demo"
--
-- À LANCER IMMÉDIATEMENT APRÈS LES CAPTURES (fenêtre de visibilité publique
-- à minimiser).
--
-- Idempotent — safe à re-run.
--
-- N'affecte PAS :
--   • Le user `apple-review@niqo.africa` lui-même (juste rename back)
--   • Les annonces/conversations/messages du user Dominique (compte perso)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_vendeur_id uuid;
  v_msg_count int;
  v_conv_count int;
  v_ann_count int;
begin
  select id into v_vendeur_id
    from public.users where email = 'apple-review@niqo.africa';

  if v_vendeur_id is null then
    raise notice 'apple-review@niqo.africa introuvable — rien à purger.';
    return;
  end if;

  -- Delete messages (FK conversation_id CASCADE ferait le job mais on
  -- explicit pour visibilité + comptage).
  delete from public.messages
   where conversation_id in (
     select id from public.conversations where vendeur_id = v_vendeur_id
   );
  get diagnostics v_msg_count = row_count;

  delete from public.conversations where vendeur_id = v_vendeur_id;
  get diagnostics v_conv_count = row_count;

  delete from public.annonces
   where vendeur_id = v_vendeur_id
     and description like '%__ASO_DEMO__%';
  get diagnostics v_ann_count = row_count;

  -- Restaure le compte vendeur à son état pre-seed (Apple Reviewer Demo).
  -- Garde is_verified=true (était déjà comme ça via pre-approve-apple-review.sql)
  -- pour ne pas casser le compte de review Apple.
  update public.users
     set prenom       = 'Demo',
         nom          = 'Reviewer',
         ville        = 'Abidjan',
         pays         = 'CI',
         note_vendeur = 0,
         nb_ventes    = 0
   where id = v_vendeur_id;

  raise notice 'Purge ASO done — % messages, % conversations, % annonces supprimés. Vendeur fictif restauré en "Demo Reviewer (CI)".',
    v_msg_count, v_conv_count, v_ann_count;
end $$;

-- ── Vérification post-purge ────────────────────────────────────────────────
select
  'annonces restantes' as label,
  count(*) as count
from public.annonces
where vendeur_id = (select id from public.users where email = 'apple-review@niqo.africa')
union all
select
  'conversations restantes',
  count(*)
from public.conversations
where vendeur_id = (select id from public.users where email = 'apple-review@niqo.africa')
union all
select
  'messages restants',
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
  '  → ' || prenom || ' ' || nom || ', ' || ville || ' (' || pays || ')',
  null
from public.users
where email = 'apple-review@niqo.africa';
