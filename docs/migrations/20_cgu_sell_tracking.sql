-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 20 — Traçabilité CGU vente (1er post)
--
-- Ajoute `cgu_sell_accepted_at` à public.users pour prouver que l'utilisateur
-- a accepté les CGU spécifiques à la vente (checkbox au 1er post dans le
-- wizard /sell). Distinct de `cgu_accepted_at` (signup auth).
--
-- En cas de contentieux ARTCI (CI loi 2024-30) / ANRTIC (CG loi 2023-15),
-- cette colonne + `cgu_version` permettent de prouver :
--   - QUI a accepté (user_id via auth.uid())
--   - QUAND (timestamp serveur, pas client)
--   - QUELLE version des CGU (cgu_version déjà existant)
--
-- RPC SECURITY DEFINER pour garantir que le timestamp est côté serveur
-- (pas falsifiable par le client) et que seul l'user peut accepter pour
-- lui-même.
--
-- Prérequis : migration 01 (users).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonne nullable — null = jamais vendu, non-null = date d'acceptation CGU vente
alter table public.users
  add column if not exists cgu_sell_accepted_at timestamptz;

comment on column public.users.cgu_sell_accepted_at is
  'Date d''acceptation des CGU vente (checkbox 1er post wizard /sell). Null si jamais vendu. Timestamp serveur (RPC SECURITY DEFINER). Preuve légale ARTCI/ANRTIC.';

-- 2. RPC pour enregistrer l'acceptation — appelée côté client après le 1er
--    createAnnonce réussi. Idempotente (ne re-écrase pas si déjà posée).
create or replace function public.accept_sell_cgu()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Idempotent : ne met à jour que si pas encore accepté
  update public.users
  set cgu_sell_accepted_at = now()
  where id = auth.uid()
    and cgu_sell_accepted_at is null;
end;
$$;

revoke all on function public.accept_sell_cgu() from public;
grant execute on function public.accept_sell_cgu() to authenticated;
