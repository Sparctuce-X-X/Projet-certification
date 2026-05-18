-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 85 — UNIQUE numero_cni sur verifications validées (anti-fraude KYC)
--
-- Pourquoi :
--   `verifications_identite` stocke 3 paths photos (cni_recto, cni_verso,
--   selfie) mais PAS le numéro de la CNI. Conséquence : un user peut
--   soumettre la MÊME CNI sur 5 comptes différents — chaque submission
--   est une row distincte avec photos différentes (cadrage, luminosité)
--   mais même identité réelle. L'admin ne peut le détecter qu'à l'œil
--   en comparant des miniatures, ingérable au-delà de quelques dizaines.
--
--   Pour une plateforme de confiance, c'est le trou principal : 1 fraudeur
--   peut créer 10 comptes "vérifiés" et bypass toutes les protections
--   (suspension auto, score d'abus, cap d'annonces).
--
-- Stratégie :
--   1. Colonne `numero_cni text` sur verifications_identite (nullable —
--      les rows pending d'avant cette mig n'en ont pas).
--   2. Saisie par l'admin lors de la validation : il lit le numéro sur
--      la photo CNI et le tape dans le back-office. Pas d'OCR auto pour MVP
--      (latence + faux positifs).
--   3. UNIQUE INDEX partiel `WHERE statut = 'verified'` : seules les
--      validées sont contraintes. Une CNI rejetée puis resoumise doit
--      pouvoir réapparaître.
--   4. Format normalisé : trim + uppercase. Le numéro CI est typiquement
--      `CI[0-9]{12}`, le CG est `CG[0-9]{10}` ou format libre selon
--      autorité. On accepte 4-20 chars alphanumériques (large pour
--      couvrir les variantes), validation dans la RPC.
--   5. Update `admin_validate_verification(p_verification_id, p_approved,
--      p_reject_reason, p_numero_cni)`. Si approved, p_numero_cni
--      obligatoire + format check + map unique_violation → 'CNI_ALREADY_USED'.
--
-- Rejet en cas de doublon : workflow normal côté admin web →
--   - admin tape le numero
--   - clique "Valider"
--   - DB raise CNI_ALREADY_USED
--   - admin web affiche "Cette CNI est déjà validée pour un autre compte"
--   - admin doit alors REJETER cette nouvelle soumission avec raison
--     "Identité déjà associée à un autre compte" (anti-fraude).
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + docs/backend/auth.md §sécurité.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonne numero_cni ───────────────────────────────────────────────────

alter table public.verifications_identite
  add column if not exists numero_cni text null;

comment on column public.verifications_identite.numero_cni is
  'Numéro CNI saisi par l''admin lors de la validation (lu sur la photo). Permet de détecter les soumissions multi-comptes d''une même identité.';

-- Format check (4-20 chars, alphanumériques majuscules + tirets/espaces optionnels)
alter table public.verifications_identite
  drop constraint if exists verif_numero_cni_format;
alter table public.verifications_identite
  add constraint verif_numero_cni_format
  check (
    numero_cni is null
    or numero_cni ~ '^[A-Z0-9 \-]{4,20}$'
  );

-- Coherence : si statut=verified, numero_cni doit être renseigné (sauf
-- les rows verified d'AVANT cette mig — on les exclut via la clause
-- `created_at >= now()` au moment du add). Pour l'instant on n'enforce
-- PAS via check (sinon impossible de jouer la mig avec rows verified
-- existantes). On enforce via la RPC admin_validate_verification.

-- ── 2. UNIQUE INDEX partiel ─────────────────────────────────────────────────
-- Une CNI ne peut être 'verified' que pour 1 user. Si rejected ou pending,
-- le numéro peut réapparaître (resoumission après refus, par ex).

create unique index if not exists verifications_numero_cni_verified_unique
  on public.verifications_identite (numero_cni)
  where statut = 'verified' and numero_cni is not null;

-- ── 3. Update RPC admin_validate_verification ──────────────────────────────
-- Nouvelle signature : 4 params (ajoute p_numero_cni). Drop préalable
-- obligatoire (changement de signature).
--
-- Validation côté serveur :
--   - Si p_approved=true : p_numero_cni obligatoire, format normalisé
--     (trim + upper), regex 4-20 alphanumériques.
--   - Si p_approved=false : p_numero_cni ignoré (peut être null).
--   - Catch unique_violation sur l'index → raise 'CNI_ALREADY_USED' P0013.

drop function if exists public.admin_validate_verification(uuid, boolean, text);

create function public.admin_validate_verification(
  p_verification_id  uuid,
  p_approved         boolean,
  p_reject_reason    text default null,
  p_numero_cni       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id   uuid;
  v_numero_cni text;
begin
  v_admin_id := auth.uid();
  if v_admin_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.users where id = v_admin_id and is_admin = true) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0010';
  end if;

  if not p_approved and (p_reject_reason is null or char_length(p_reject_reason) < 5) then
    raise exception 'REJECT_REASON_REQUIRED' using errcode = 'P0011';
  end if;

  if p_approved then
    -- Numéro CNI requis + format
    v_numero_cni := upper(nullif(trim(coalesce(p_numero_cni, '')), ''));
    if v_numero_cni is null then
      raise exception 'NUMERO_CNI_REQUIRED' using errcode = 'P0014';
    end if;
    if v_numero_cni !~ '^[A-Z0-9 \-]{4,20}$' then
      raise exception 'NUMERO_CNI_INVALID' using errcode = 'P0015';
    end if;
  end if;

  begin
    update public.verifications_identite
       set statut        = (case when p_approved then 'verified' else 'rejected' end)::statut_verification,
           reviewed_by   = v_admin_id,
           reviewed_at   = now(),
           reject_reason = case when p_approved then null else p_reject_reason end,
           numero_cni    = case when p_approved then v_numero_cni else numero_cni end
     where id = p_verification_id
       and statut = 'pending'::statut_verification;
  exception when unique_violation then
    if SQLERRM like '%verifications_numero_cni_verified_unique%' then
      raise exception 'CNI_ALREADY_USED' using errcode = 'P0013';
    else
      raise;
    end if;
  end;

  if not found then
    raise exception 'VERIFICATION_NOT_PENDING' using errcode = 'P0012';
  end if;
end;
$$;

grant execute on function public.admin_validate_verification(uuid, boolean, text, text) to authenticated;
