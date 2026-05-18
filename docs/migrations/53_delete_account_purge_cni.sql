-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 53 — Purge Storage cni-verifications au delete compte (RGPD)
--
-- Bug pré-existant : delete_my_account() (mig 03) ne purge pas le bucket
-- cni-verifications. RLS Storage mig 46 interdit DELETE aux non-admin → la
-- purge depuis le client (purgeUserBucket dans lib/supabase.ts) échoue
-- silencieusement ou throw. Conséquence : à chaque suppression compte, les
-- CNI restent orphelines indéfiniment. Violation directe :
--   - ARTCI 2024-30 art. 25 (durée de conservation, droit à l'oubli)
--   - ANRTIC 2023-15 (Congo, équivalent)
--   - Loi rwandaise 2021-058 (entité légale Niqo)
--
-- Fix : étendre delete_my_account() pour purger storage.objects côté DB,
-- en SECURITY DEFINER (bypass RLS Storage). Atomique avec le delete
-- auth.users → pas de fenêtre où l'user existe sans CNI, ni l'inverse.
--
-- Les buckets `avatars` et `annonces-photos` continuent d'être purgés
-- côté client (ils ont des policies DELETE owner depuis leurs migs).
-- On pourrait centraliser ici, mais le pattern existant fonctionne — on
-- évite de modifier ce qui n'est pas cassé.
--
-- Convention path mig 46 :
--   cni-verifications/{auth.uid()}/{verification_id}/{recto|verso|selfie}.jpg
--
-- Donc (storage.foldername(name))[1] = uid::text matche tous les fichiers
-- de l'user, peu importe le verification_id (un user peut avoir resoumis
-- plusieurs fois après refus, on purge tout).
--
-- Idempotente. À jouer après 03 + 46. Cf. CLAUDE.md §RGPD.
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

  -- ── 1. Purge Storage cni-verifications (PII sensibles, RLS admin-only)
  -- Match sur (storage.foldername(name))[1] = uid::text — couvre toutes
  -- les soumissions (drafts pending, validées, rejetées) du user.
  delete from storage.objects
   where bucket_id = 'cni-verifications'
     and (storage.foldername(name))[1] = uid::text;

  -- ── 2. Delete auth.users → cascade public.users (FK on delete cascade)
  -- → cascade verifications_identite, paiements_niqo, annonces, etc.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
