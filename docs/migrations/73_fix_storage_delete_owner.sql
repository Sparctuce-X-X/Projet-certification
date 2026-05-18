-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 73 — Fix delete_my_account : purge cni-verifications via client
--
-- Bug remonté lors d'un test BEGIN/ROLLBACK en simulant l'appel RPC :
--
--   ERROR 42501: Direct deletion from storage tables is not allowed.
--   Use the Storage API instead.
--   CONTEXT: PL/pgSQL function storage.protect_delete() line 5 at RAISE
--
-- Cause : Supabase a ajouté un trigger `storage.protect_delete` qui interdit
-- les `delete from storage.objects` directs en SQL (anti-orphelin S3). La
-- mig 53 faisait justement ça pour purger les CNI au moment du droit à
-- l'oubli → bloque toute suppression de compte pour les users qui ont
-- déjà soumis une vérif.
--
-- Fix en 2 temps :
--
--   1. Ajouter une policy DELETE owner sur cni-verifications (cohérent
--      RGPD droit à l'effacement de ses propres données — l'user peut
--      effacer ses CNI à tout moment).
--      C'est moins strict que mig 46 (DELETE admin-only) mais reste OK
--      car l'user ne peut effacer QUE son propre folder
--      (storage.foldername(name)[1] = auth.uid()::text).
--
--   2. Simplifier delete_my_account : ne plus toucher storage.objects
--      depuis SQL. Le client mobile (lib/supabase.ts) appelle maintenant
--      purgeUserBucket("cni-verifications", userId) AVANT la RPC, via la
--      Storage API HTTP qui contourne protect_delete proprement.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Policy DELETE owner sur cni-verifications ────────────────────────────

drop policy if exists cni_verif_owner_delete on storage.objects;
create policy cni_verif_owner_delete on storage.objects
  for delete
  using (
    bucket_id = 'cni-verifications'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- (mig 46 conservait `cni_verif_admin_delete` — admin garde aussi son DELETE
--  pour le cron purge J+30/6mois, ils coexistent.)

-- ── 2. Simplifier delete_my_account — plus de delete storage.objects ────────
-- Le client mobile fait maintenant la purge des 3 buckets (avatars,
-- annonces-photos, cni-verifications) avant d'appeler cette RPC. La RPC
-- ne fait plus que delete auth.users → cascade.

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

  -- ⚠ La purge des fichiers Storage (avatars, annonces-photos,
  -- cni-verifications) est faite côté client AVANT cet appel via la
  -- Storage API HTTP — voir lib/supabase.ts deleteMyAccount().
  -- Ne pas faire de delete from storage.objects ici (bloqué par
  -- storage.protect_delete()).

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
