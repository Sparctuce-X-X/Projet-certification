-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 104 — Backfill audit_log_admin pour les actions KYC historiques
--
-- CONTEXTE
--   Mig 103 a posé `audit_log_admin` + helper `_log_admin_action()` + patch
--   des 6 RPCs admin. Forward c'est tracé. Mais toutes les actions admin
--   FAITES AVANT mig 103 (validations KYC depuis le lancement, signalements
--   modérés, annonces suspendues, etc.) sont absentes du log.
--
-- CE QUI EST RECONSTRUCTIBLE
--   Seules les **validations KYC** ont gardé l'identité de l'admin qui a
--   décidé : `verifications_identite.reviewed_by` (uuid admin) +
--   `reviewed_at` (timestamp). Métadonnées disponibles : `numero_cni` (mig 85)
--   et `reject_reason`. Reconstruction parfaitement déterministe.
--
--   Pour les autres actions (signalements, suspensions, soft-delete) il
--   n'existe AUCUNE colonne `*_by` historique → la seule reconstruction
--   possible serait "admin = Dominique" (vrai aujourd'hui car admin solo,
--   mais hypothèse non auditable). On laisse tomber : faible valeur ajoutée
--   pour le risque d'écrire de la fausse traçabilité.
--
-- DESIGN
--   - Insert depuis `verifications_identite WHERE statut IN ('verified',
--     'rejected') AND reviewed_at IS NOT NULL`
--   - action = 'kyc_verified' ou 'kyc_rejected' (même convention que mig 103)
--   - admin_id = reviewed_by (peut être NULL si l'admin a été purgé entre
--     temps — la FK on delete set null gère)
--   - target_type = 'verification', target_id = verifications_identite.id
--   - created_at = reviewed_at (PRÉSERVE le timing historique réel — sinon
--     toutes les rows backfillées auraient le même timestamp = mig play time)
--   - metadata.backfilled = true (flag pour distinguer les rows reconstruites
--     des rows live tracées en temps réel post-mig 103)
--   - Idempotente via WHERE NOT EXISTS sur (target_id, action LIKE 'kyc_%')
--     → re-jouable sans dupliquer
--
-- IMPORTANT — l'INSERT bypass le helper `_log_admin_action` (qui lit
--   `auth.uid()` pour poser admin_id). Ici on connaît l'admin réel via
--   `reviewed_by`, on insert directement avec un INSERT brut sous postgres
--   role (pas de session JWT, on n'a pas auth.uid()).
--
-- Cf. CLAUDE.md §Migrations Supabase + docs/migrations/103_audit_log_admin.sql.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.audit_log_admin (admin_id, action, target_type, target_id, metadata, created_at)
select
  v.reviewed_by                                                  as admin_id,
  case
    when v.statut = 'verified' then 'kyc_verified'
    when v.statut = 'rejected' then 'kyc_rejected'
  end                                                            as action,
  'verification'                                                 as target_type,
  v.id                                                           as target_id,
  jsonb_build_object('backfilled', true)
    || case
         when v.statut = 'verified' and v.numero_cni is not null
           then jsonb_build_object('numero_cni', v.numero_cni)
         when v.statut = 'rejected' and v.reject_reason is not null
           then jsonb_build_object('reject_reason', v.reject_reason)
         else '{}'::jsonb
       end                                                       as metadata,
  v.reviewed_at                                                  as created_at
from public.verifications_identite v
where v.statut in ('verified', 'rejected')
  and v.reviewed_at is not null
  and not exists (
    -- Anti-doublon : si déjà un log kyc_* sur cette verification,
    -- ne pas réinsérer (mig re-jouable).
    select 1 from public.audit_log_admin a
    where a.target_id = v.id
      and a.action like 'kyc_%'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Fin mig 104
-- ─────────────────────────────────────────────────────────────────────────────
