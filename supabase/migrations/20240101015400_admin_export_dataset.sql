-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 114 — `admin_export_dataset(p_dataset, p_from, p_to, p_pays)`
--
-- Export CSV pour 6 datasets business/comptables. Une seule RPC qui aiguille
-- vers la requête bonne (signature uniforme côté frontend, code SQL co-localisé).
--
-- ## Datasets supportés
--
-- - `users`         : signups, pays, dates, is_verified, suspensions, télhash
-- - `annonces`      : toutes annonces filtrées par created_at + pays
-- - `paiements`     : completed only — pour réconciliation comptable
-- - `rdv`           : conversations avec rdv_propose_at non-null
-- - `avis`          : reviews postées
-- - `signalements`  : reports avec statut résolution
--
-- ## RGPD : hash téléphone (SHA256 hex)
--
-- Le CSV est exporté hors-app (Excel cabinet comptable, Google Sheets perso).
-- Téléphones en clair = fuite si fichier traîne. On hash via SHA256, l'admin
-- peut quand même croiser deux exports (même phone → même hash) sans exposer.
-- Cf. CLAUDE.md §RGPD vérifications systématiques.
--
-- Note : `users.telephone_enc` est dans le Vault, on hash le `telephone` (plain
-- text si encore présent en colonne) — pour MVP, la column `telephone` n'est
-- pas garantie populée à 100%, on hash quand non-null sinon `''` (vide).
--
-- ## CSV format (RFC 4180)
--
-- - Séparateur : virgule
-- - Tous les champs text/uuid/timestamp wrapped dans `"..."` (simplification :
--   pas de logique conditionnelle, toujours quote — Excel et libreoffice
--   acceptent)
-- - Échappement : `"` → `""` à l'intérieur des champs quoted
-- - Champs numeric NON-quoted (Excel les reconnaît comme nombres)
-- - Newlines : `\n` (LF) — Excel sur Mac/Linux accepte ; Windows
--   Excel ouvrira sans BOM (utiliser ; comme separator si Excel FR)
-- - Charset : UTF-8
--
-- ## Hard limit 5MB
--
-- Limite plan-eng-review 2026-05-11 (D5 = C). Si CSV > 5MB, raise
-- `EXPORT_TOO_LARGE` au lieu de renvoyer un payload silencieux qui plantera
-- PostgREST (limite 6MB). User doit alors filtrer plus strictement.
--
-- ## Audit log
--
-- Chaque export laisse une trace dans `audit_log_admin` via `_log_admin_action`
-- (mig 103). Action `export_<dataset>` + metadata `{from, to, pays, rows}`.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_export_dataset(
  p_dataset text,
  p_from    timestamptz default null,
  p_to      timestamptz default null,
  p_pays    text        default null
)
returns text
language plpgsql
security definer
volatile  -- INSERT dans audit_log_admin → side-effect
-- search_path inclut `extensions` pour résoudre `digest()` (pgcrypto installé
-- par Supabase dans schema `extensions`, pas `public`).
set search_path = public, extensions
as $$
declare
  v_now          timestamptz := now();
  v_window_start timestamptz;
  v_window_end   timestamptz;
  v_csv          text;
  v_rows         int;
  v_size_bytes   int;
  v_max_bytes    constant int := 5 * 1024 * 1024;  -- 5MB hard limit
  v_admin_id     uuid;
begin
  v_admin_id := auth.uid();

  if not exists (
    select 1 from public.users where id = v_admin_id and is_admin = true
  ) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_pays is not null and p_pays not in ('CI', 'CG') then
    raise exception 'INVALID_PAYS: % (expected CI, CG or null)', p_pays;
  end if;

  if p_dataset not in ('users', 'annonces', 'paiements', 'rdv', 'avis', 'signalements') then
    raise exception 'INVALID_DATASET: % (expected users|annonces|paiements|rdv|avis|signalements)', p_dataset;
  end if;

  v_window_start := coalesce(p_from, v_now - interval '30 days');
  v_window_end   := coalesce(p_to,   v_now);

  if v_window_end <= v_window_start then
    raise exception 'INVALID_WINDOW: p_to (%) must be > p_from (%)',
      v_window_end, v_window_start;
  end if;

  -- ── Dispatch dataset ────────────────────────────────────────────────────
  case p_dataset

    when 'users' then
      -- Header + rows. SHA256 sur telephone, hash hex 64 chars.
      with rows_cte as (
        select
          id::text                                                                       as col_id,
          to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')           as col_created,
          coalesce(prenom, '')                                                            as col_prenom,
          coalesce(nom, '')                                                               as col_nom,
          coalesce(pays::text, '')                                                        as col_pays,
          coalesce(ville, '')                                                             as col_ville,
          coalesce(email, '')                                                             as col_email,
          case
            when telephone is null then ''
            -- Schema-qualified : pgcrypto vit dans `extensions` (Supabase default)
            else encode(extensions.digest(telephone, 'sha256'), 'hex')
          end                                                                             as col_tel_sha256,
          is_verified::text                                                               as col_verified,
          is_active::text                                                                 as col_active,
          score_abus::text                                                                as col_score,
          nb_ventes::text                                                                 as col_nb_ventes,
          note_vendeur::text                                                              as col_note_vendeur
          from public.users
         where created_at >= v_window_start and created_at < v_window_end
           and (p_pays is null or pays = p_pays::pays_code)
         order by created_at desc
      )
      select
        'id,created_at,prenom,nom,pays,ville,email,telephone_sha256,is_verified,is_active,score_abus,nb_ventes,note_vendeur' ||
        E'\n' ||
        coalesce(string_agg(
          '"' || replace(col_id, '"', '""') || '",' ||
          '"' || col_created || '",' ||
          '"' || replace(col_prenom, '"', '""') || '",' ||
          '"' || replace(col_nom, '"', '""') || '",' ||
          '"' || col_pays || '",' ||
          '"' || replace(col_ville, '"', '""') || '",' ||
          '"' || replace(col_email, '"', '""') || '",' ||
          '"' || col_tel_sha256 || '",' ||
          col_verified || ',' ||
          col_active || ',' ||
          col_score || ',' ||
          col_nb_ventes || ',' ||
          col_note_vendeur,
          E'\n'
        ), ''),
        count(*)::int
        into v_csv, v_rows
        from rows_cte;

    when 'annonces' then
      with rows_cte as (
        select
          a.id::text                                                                     as col_id,
          to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')         as col_created,
          a.vendeur_id::text                                                              as col_vendeur,
          coalesce(u.prenom, '') || ' ' || coalesce(u.nom, '')                            as col_vendeur_nom,
          coalesce(a.titre, '')                                                           as col_titre,
          coalesce(a.categorie_id::text, '')                                              as col_cat,
          coalesce(a.statut::text, '')                                                    as col_statut,
          a.prix::text                                                                    as col_prix,
          coalesce(a.pays::text, '')                                                      as col_pays,
          coalesce(a.ville, '')                                                           as col_ville,
          a.nb_vues::text                                                                 as col_vues,
          coalesce(a.is_boosted::text, 'false')                                            as col_boosted
          from public.annonces a
          left join public.users u on u.id = a.vendeur_id
         where a.created_at >= v_window_start and a.created_at < v_window_end
           and (p_pays is null or a.pays = p_pays::pays_code)
         order by a.created_at desc
      )
      select
        'id,created_at,vendeur_id,vendeur_nom,titre,categorie_id,statut,prix_fcfa,pays,ville,nb_vues,is_boosted' ||
        E'\n' ||
        coalesce(string_agg(
          '"' || col_id || '",' ||
          '"' || col_created || '",' ||
          '"' || col_vendeur || '",' ||
          '"' || replace(col_vendeur_nom, '"', '""') || '",' ||
          '"' || replace(col_titre, '"', '""') || '",' ||
          '"' || col_cat || '",' ||
          '"' || col_statut || '",' ||
          col_prix || ',' ||
          '"' || col_pays || '",' ||
          '"' || replace(col_ville, '"', '""') || '",' ||
          col_vues || ',' ||
          col_boosted,
          E'\n'
        ), ''),
        count(*)::int
        into v_csv, v_rows
        from rows_cte;

    when 'paiements' then
      -- Comptabilité : completed only, ventilation XOF/XAF par pays du payeur
      with rows_cte as (
        select
          p.id::text                                                                     as col_id,
          to_char(p.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')       as col_completed,
          p.user_id::text                                                                 as col_user,
          coalesce(u.prenom, '') || ' ' || coalesce(u.nom, '')                            as col_user_nom,
          coalesce(u.pays::text, '')                                                      as col_pays,
          case u.pays when 'CI' then 'XOF' when 'CG' then 'XAF' else '' end               as col_devise,
          coalesce(p.type::text, '')                                                      as col_type,
          p.montant_fcfa::text                                                            as col_montant,
          coalesce(p.pawapay_deposit_id, '')                                              as col_deposit_id,
          coalesce(p.target_id::text, '')                                                 as col_target
          from public.paiements_niqo p
          join public.users u on u.id = p.user_id
         where p.statut = 'completed'
           and p.completed_at >= v_window_start and p.completed_at < v_window_end
           and (p_pays is null or u.pays = p_pays::pays_code)
         order by p.completed_at desc
      )
      select
        'id,completed_at,user_id,user_nom,pays,devise,type,montant,pawapay_deposit_id,target_id' ||
        E'\n' ||
        coalesce(string_agg(
          '"' || col_id || '",' ||
          '"' || col_completed || '",' ||
          '"' || col_user || '",' ||
          '"' || replace(col_user_nom, '"', '""') || '",' ||
          '"' || col_pays || '",' ||
          '"' || col_devise || '",' ||
          '"' || col_type || '",' ||
          col_montant || ',' ||
          '"' || replace(col_deposit_id, '"', '""') || '",' ||
          '"' || col_target || '"',
          E'\n'
        ), ''),
        count(*)::int
        into v_csv, v_rows
        from rows_cte;

    when 'rdv' then
      with rows_cte as (
        select
          c.id::text                                                                     as col_id,
          to_char(c.rdv_propose_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')     as col_propose,
          coalesce(
            to_char(c.rdv_confirme_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''
          )                                                                              as col_confirme,
          coalesce(
            to_char(c.rdv_annule_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''
          )                                                                              as col_annule,
          coalesce(
            to_char(c.rdv_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''
          )                                                                              as col_date,
          c.annonce_id::text                                                              as col_annonce,
          c.acheteur_id::text                                                             as col_acheteur,
          c.vendeur_id::text                                                              as col_vendeur,
          coalesce(a.pays::text, '')                                                      as col_pays,
          coalesce(c.rdv_lieu, '')                                                        as col_lieu
          from public.conversations c
          join public.annonces a on a.id = c.annonce_id
         where c.rdv_propose_at >= v_window_start and c.rdv_propose_at < v_window_end
           and (p_pays is null or a.pays = p_pays::pays_code)
         order by c.rdv_propose_at desc
      )
      select
        'id,rdv_propose_at,rdv_confirme_at,rdv_annule_at,rdv_date,annonce_id,acheteur_id,vendeur_id,pays,lieu' ||
        E'\n' ||
        coalesce(string_agg(
          '"' || col_id || '",' ||
          '"' || col_propose || '",' ||
          '"' || col_confirme || '",' ||
          '"' || col_annule || '",' ||
          '"' || col_date || '",' ||
          '"' || col_annonce || '",' ||
          '"' || col_acheteur || '",' ||
          '"' || col_vendeur || '",' ||
          '"' || col_pays || '",' ||
          '"' || replace(col_lieu, '"', '""') || '"',
          E'\n'
        ), ''),
        count(*)::int
        into v_csv, v_rows
        from rows_cte;

    when 'avis' then
      with rows_cte as (
        select
          av.id::text                                                                    as col_id,
          to_char(av.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')        as col_created,
          av.conversation_id::text                                                        as col_conv,
          av.auteur_id::text                                                              as col_auteur,
          av.cible_id::text                                                               as col_cible,
          coalesce(av.role_auteur, '')                                                    as col_role,
          av.note::text                                                                   as col_note,
          av.is_auto::text                                                                as col_auto,
          coalesce(av.commentaire, '')                                                    as col_comm,
          coalesce(a.pays::text, '')                                                      as col_pays
          from public.avis av
          join public.conversations c on c.id = av.conversation_id
          join public.annonces a      on a.id = c.annonce_id
         where av.created_at >= v_window_start and av.created_at < v_window_end
           and (p_pays is null or a.pays = p_pays::pays_code)
         order by av.created_at desc
      )
      select
        'id,created_at,conversation_id,auteur_id,cible_id,role_auteur,note,is_auto,commentaire,pays' ||
        E'\n' ||
        coalesce(string_agg(
          '"' || col_id || '",' ||
          '"' || col_created || '",' ||
          '"' || col_conv || '",' ||
          '"' || col_auteur || '",' ||
          '"' || col_cible || '",' ||
          '"' || col_role || '",' ||
          col_note || ',' ||
          col_auto || ',' ||
          '"' || replace(col_comm, '"', '""') || '",' ||
          '"' || col_pays || '"',
          E'\n'
        ), ''),
        count(*)::int
        into v_csv, v_rows
        from rows_cte;

    when 'signalements' then
      -- Note : signalements n'a pas de `decided_at` ; on utilise `updated_at`
      -- comme proxy (s'incrémente quand le statut passe à traite/rejete).
      with rows_cte as (
        select
          s.id::text                                                                     as col_id,
          to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')         as col_created,
          coalesce(s.statut::text, '')                                                    as col_statut,
          coalesce(s.target_type::text, '')                                                as col_target_type,
          coalesce(s.target_id::text, '')                                                  as col_target_id,
          s.signaleur_id::text                                                             as col_signaleur,
          coalesce(s.motif, '')                                                            as col_motif,
          coalesce(s.description, '')                                                      as col_desc,
          case
            when s.statut <> 'en_attente'
            then to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            else ''
          end                                                                              as col_updated
          from public.signalements s
         where s.created_at >= v_window_start and s.created_at < v_window_end
         order by s.created_at desc
      )
      select
        'id,created_at,statut,target_type,target_id,signaleur_id,motif,description,updated_at' ||
        E'\n' ||
        coalesce(string_agg(
          '"' || col_id || '",' ||
          '"' || col_created || '",' ||
          '"' || col_statut || '",' ||
          '"' || col_target_type || '",' ||
          '"' || col_target_id || '",' ||
          '"' || col_signaleur || '",' ||
          '"' || replace(col_motif, '"', '""') || '",' ||
          '"' || replace(col_desc, '"', '""') || '",' ||
          '"' || col_updated || '"',
          E'\n'
        ), ''),
        count(*)::int
        into v_csv, v_rows
        from rows_cte;
  end case;

  -- ── Hard limit 5MB ──────────────────────────────────────────────────────
  v_size_bytes := octet_length(v_csv);
  if v_size_bytes > v_max_bytes then
    raise exception 'EXPORT_TOO_LARGE: % bytes > % bytes (5MB). Restrict window or pays filter.',
      v_size_bytes, v_max_bytes;
  end if;

  -- ── Audit log via _log_admin_action (mig 103) ───────────────────────────
  -- Signature : (p_action, p_target_type, p_target_id, p_metadata).
  -- admin_id est récupéré via auth.uid() à l'intérieur du helper.
  -- Best-effort : n'échoue pas si la mig 103 n'est pas appliquée.
  begin
    perform public._log_admin_action(
      ('export_' || p_dataset)::text,
      p_dataset,
      null::uuid,
      jsonb_build_object(
        'from', v_window_start,
        'to',   v_window_end,
        'pays', coalesce(p_pays, 'ALL'),
        'rows', v_rows,
        'bytes', v_size_bytes
      )
    );
  exception when undefined_function then
    null;
  end;

  return v_csv;
end;
$$;

revoke all on function public.admin_export_dataset(text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_export_dataset(text, timestamptz, timestamptz, text) to authenticated;

comment on function public.admin_export_dataset(text, timestamptz, timestamptz, text) is
  'Export CSV admin pour 6 datasets (users, annonces, paiements, rdv, avis, signalements). RFC 4180. SHA256 hash téléphones (RGPD). Hard limit 5MB (raise EXPORT_TOO_LARGE). Filtre window + pays. Gate is_admin. Audit log via _log_admin_action. Mig 114.';
