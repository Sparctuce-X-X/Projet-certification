-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 03 — Droit à l'oubli (RGPD)
--
-- Crée la RPC public.delete_my_account() qui permet à un user authentifié
-- de supprimer son propre compte. La FK public.users.id REFERENCES
-- auth.users(id) ON DELETE CASCADE (cf. migration 01) garantit la suppression
-- atomique des deux lignes.
--
-- Cf. CLAUDE.md §RGPD point 6 (droit à l'oubli) + docs/rgpd-audit.md entrée #1.
--
-- ⚠ LIMITES MVP :
--   À ce stade aucune table dépendante (annonces, transactions, messages)
--   n'existe — la cascade depuis auth.users supprime tout proprement.
--   QUAND elles existeront (S3-5, S6-7) il FAUDRA :
--     - annonces : CASCADE OK (l'annonce d'un compte supprimé n'a plus de sens)
--     - transactions : ANONYMISER (rétention fiscale 10 ans CI/CG) — ne PAS
--       cascade. Remplacer cette RPC par une qui :
--         1. set transactions.acheteur_id = NULL + acheteur_email_hash
--         2. set transactions.vendeur_id = NULL + vendeur_email_hash
--         3. delete from auth.users (cascade le reste)
--     - messages : à débattre — soft delete + scrub contenu ?
--     - litiges/avis : idem transactions
--   Ré-écrire cette migration en 03b_anonymize_account.sql à ce moment-là.
--
-- À jouer dans Supabase SQL Editor APRÈS 02_users_phone_vault.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  -- DELETE atomique. SECURITY DEFINER → s'exécute en role postgres,
  -- bypass la RLS. Le check auth.uid() ci-dessus garantit que l'user ne
  -- peut supprimer QUE son propre compte.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
