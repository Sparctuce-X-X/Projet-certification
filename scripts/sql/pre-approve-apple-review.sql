-- ─────────────────────────────────────────────────────────────────────────────
-- Pre-approve the Apple App Store reviewer demo account.
--
-- Apple's App Review team needs a working seller account to test the full
-- buyer + seller flow. We can't ask a reviewer to upload their own ID card,
-- so we manually flip is_verified on a dedicated demo account.
--
-- This is a ONE-SHOT operational script — NOT a migration. Run it manually
-- in Supabase Dashboard → SQL Editor.
--
-- Prerequisites BEFORE running:
--   1. Email `apple-review@niqo.africa` must be set up (forward to your inbox
--      or create via Resend) so the reviewer-side password reset works if
--      Apple ever needs it.
--   2. Sign up that email through the normal mobile app sign-up flow
--      (email/password). This triggers handle_new_user which inserts the
--      public.users row. DO NOT try to INSERT into auth.users directly here
--      — GoTrue requires specific fields (aud, role, raw_app_meta_data) and
--      the account would exist but be unable to sign in.
--   3. Verify the public.users row exists by running:
--        select id, email, prenom, nom, pays, is_verified
--        from public.users
--        where email = 'apple-review@niqo.africa';
--   4. Then run THIS script.
--
-- What this does:
--   • Sets is_verified = true so the "Vendeur vérifié" badge appears.
--   • Backdates verification_paid_at to mimic a real verified seller.
--   • Pre-accepts the seller CGU so the reviewer can publish ads without
--     ticking the box (cleaner reviewer flow).
--   • Sets a clean display name + city for the screenshot in their review.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from public.users
  where email = 'apple-review@niqo.africa';

  if v_user_id is null then
    raise exception 'Demo account not found. Sign up apple-review@niqo.africa via the mobile app first.';
  end if;

  update public.users
  set
    is_verified            = true,
    verification_paid_at   = coalesce(verification_paid_at, now()),
    cgu_sell_accepted_at   = coalesce(cgu_sell_accepted_at, now()),
    prenom                 = 'Demo',
    nom                    = 'Reviewer',
    ville                  = 'Abidjan',
    pays                   = 'CI'
  where id = v_user_id;

  raise notice 'Demo account % is now pre-verified and seller-CGU accepted.', v_user_id;
end $$;

-- Verify the result
select
  id,
  email,
  prenom || ' ' || nom as display_name,
  pays,
  ville,
  is_verified,
  verification_paid_at,
  cgu_sell_accepted_at,
  is_active
from public.users
where email = 'apple-review@niqo.africa';
