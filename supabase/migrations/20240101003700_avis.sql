-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 37 — Notation post-RDV (F06)
--
-- ⚠️ Évolutions ultérieures :
--   - mig 38 : cron `avis-auto-j7` + fonction `fn_avis_auto_j7` supprimés
--             (décision UX : pas de note auto 3/5, voir mig 38 header)
--   - mig 38 : trigger `tg_avis_after_delete` ajouté (anti-fraude purge)
--   - mig 42 : trigger `fn_avis_after_insert` symétrisé en recalc-from-scratch
--             (cohérent avec le delete trigger)
--
-- CDC v4.0 §confiance : après un RDV physique confirmé, chaque participant
-- peut noter l'autre (1-5 étoiles + commentaire). Les avis sont publics, signés,
-- et figés. Mise à jour automatique des moyennes note_vendeur / note_acheteur
-- et des compteurs nb_ventes / nb_achats côté users.
--
-- Décisions :
--   - Table avis ancrée sur conversation_id (transactions n'existe pas en v4.0)
--   - 1 avis max par (conversation, auteur) — donc 2 avis max par RDV
--   - Auteur signé (visible) — pas d'anonymat (responsabilité + confiance)
--   - Note non modifiable, non supprimable
--   - Cron J+7 → note auto 3/5 (sans commentaire) si l'utilisateur n'a pas noté
--   - Compteurs nb_ventes/nb_achats incrémentés à chaque INSERT avis
--   - Commentaires : 200 chars max, optionnels
--   - Pas de filtre mots interdits sur commentaire en MVP (à ajouter si abus)
--
-- Composants :
--   1. Table avis + indexes + check constraints
--   2. RLS (SELECT public, INSERT via RPC uniquement)
--   3. Trigger after insert : recalc moyenne + increment compteur
--   4. RPC submit_avis (SECURITY DEFINER)
--   5. Fonction fn_avis_auto_j7 + cron pg_cron quotidien 04:00
--   6. Évolution get_user_public_profile (note_acheteur + nb_achats + recent_avis)
--
-- Prérequis : migrations 01 (users), 22 (conversations), 35 (RDV), pg_cron activé.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table avis ─────────────────────────────────────────────────────────

create table if not exists public.avis (
  id              uuid          primary key default uuid_generate_v4(),
  conversation_id uuid          not null references public.conversations(id) on delete cascade,
  auteur_id       uuid          not null references public.users(id),
  cible_id        uuid          not null references public.users(id),
  note            smallint      not null check (note between 1 and 5),
  commentaire     text          check (commentaire is null or char_length(commentaire) between 1 and 200),
  role_auteur     text          not null check (role_auteur in ('acheteur', 'vendeur')),
  is_auto         boolean       not null default false,
  created_at      timestamptz   not null default now(),

  constraint avis_unique_par_conv_auteur unique (conversation_id, auteur_id),
  constraint avis_pas_soi_meme           check (auteur_id != cible_id)
);

comment on table public.avis is
  'Notations post-RDV. 1 avis max par auteur par conversation. Avis figés (pas update/delete). Le trigger fn_avis_after_insert met à jour la moyenne et le compteur côté cible.';

-- Indexes
create index if not exists idx_avis_cible
  on public.avis (cible_id, role_auteur, created_at desc);

create index if not exists idx_avis_conv
  on public.avis (conversation_id);

create index if not exists idx_avis_auteur
  on public.avis (auteur_id, created_at desc);

-- ── 2. RLS ─────────────────────────────────────────────────────────────────

alter table public.avis enable row level security;

-- SELECT public — les avis sont visibles partout (profils publics, browse-first)
drop policy if exists avis_select_public on public.avis;
create policy avis_select_public on public.avis
  for select using (true);

-- INSERT / UPDATE / DELETE : interdit en direct.
-- L'INSERT passe par la RPC submit_avis (SECURITY DEFINER) ou par le cron J+7.
-- Pas de policy = pas d'autorisation par défaut sous RLS.

-- ── 3. Trigger après INSERT — recalcul moyenne + compteur ─────────────────

create or replace function public.fn_avis_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.role_auteur = 'acheteur' then
    -- Cible = vendeur. Recalcul note_vendeur (avg de tous ses avis reçus en
    -- tant que vendeur), incrément nb_ventes.
    update public.users
    set note_vendeur = (
          select round(avg(note)::numeric, 2)
          from public.avis
          where cible_id = NEW.cible_id and role_auteur = 'acheteur'
        ),
        nb_ventes = nb_ventes + 1
    where id = NEW.cible_id;
  else
    -- Cible = acheteur. Recalcul note_acheteur, incrément nb_achats.
    update public.users
    set note_acheteur = (
          select round(avg(note)::numeric, 2)
          from public.avis
          where cible_id = NEW.cible_id and role_auteur = 'vendeur'
        ),
        nb_achats = nb_achats + 1
    where id = NEW.cible_id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_avis_after_insert on public.avis;
create trigger tg_avis_after_insert
  after insert on public.avis
  for each row
  execute function public.fn_avis_after_insert();

-- ── 4. RPC submit_avis ────────────────────────────────────────────────────
-- Permet à un participant de noter l'autre, après que le RDV ait eu lieu.
-- Détermine automatiquement role_auteur et cible_id depuis la conversation.

create or replace function public.submit_avis(
  p_conversation_id uuid,
  p_note            smallint,
  p_commentaire     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_conv         public.conversations%rowtype;
  v_role_auteur  text;
  v_cible_id     uuid;
  v_existing     uuid;
  v_clean_comment text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Validation note
  if p_note is null or p_note < 1 or p_note > 5 then
    return jsonb_build_object('success', false, 'error', 'note_invalid');
  end if;

  -- Normalisation commentaire (vide → null)
  v_clean_comment := nullif(trim(coalesce(p_commentaire, '')), '');

  if v_clean_comment is not null and char_length(v_clean_comment) > 200 then
    return jsonb_build_object('success', false, 'error', 'commentaire_too_long');
  end if;

  -- Charge la conversation (verrou exclusif anti-race)
  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  -- Participant ?
  if v_uid = v_conv.acheteur_id then
    v_role_auteur := 'acheteur';
    v_cible_id    := v_conv.vendeur_id;
  elsif v_uid = v_conv.vendeur_id then
    v_role_auteur := 'vendeur';
    v_cible_id    := v_conv.acheteur_id;
  else
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  -- RDV doit être confirmé ET dans le passé
  if v_conv.rdv_confirme_at is null then
    return jsonb_build_object('success', false, 'error', 'rdv_not_confirmed');
  end if;

  if v_conv.rdv_date is null or v_conv.rdv_date >= now() then
    return jsonb_build_object('success', false, 'error', 'rdv_not_past');
  end if;

  -- Avis déjà posé par cet auteur sur cette conv ?
  select id into v_existing
  from public.avis
  where conversation_id = p_conversation_id and auteur_id = v_uid;

  if v_existing is not null then
    return jsonb_build_object('success', false, 'error', 'avis_already_submitted');
  end if;

  -- INSERT (le trigger recalcule la moyenne + incrémente le compteur)
  insert into public.avis (
    conversation_id, auteur_id, cible_id, note, commentaire, role_auteur, is_auto
  ) values (
    p_conversation_id, v_uid, v_cible_id, p_note, v_clean_comment, v_role_auteur, false
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.submit_avis(uuid, smallint, text) from public;
grant execute on function public.submit_avis(uuid, smallint, text) to authenticated;

-- ── 5. Fonction fn_avis_auto_j7 — cron J+7 ────────────────────────────────
-- Pour chaque RDV confirmé dont rdv_date est passé depuis ≥7 jours, insère
-- un avis automatique 3/5 (sans commentaire) pour chaque côté qui n'a pas
-- encore noté. Idempotent : la contrainte unique empêche les doublons.

create or replace function public.fn_avis_auto_j7()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Côté acheteur : insère avis auto si l'acheteur n'a pas noté
  insert into public.avis (conversation_id, auteur_id, cible_id, note, role_auteur, is_auto)
  select c.id, c.acheteur_id, c.vendeur_id, 3, 'acheteur', true
  from public.conversations c
  where c.rdv_confirme_at is not null
    and c.rdv_date < now() - interval '7 days'
    and not exists (
      select 1 from public.avis a
      where a.conversation_id = c.id and a.auteur_id = c.acheteur_id
    );

  -- Côté vendeur : insère avis auto si le vendeur n'a pas noté
  insert into public.avis (conversation_id, auteur_id, cible_id, note, role_auteur, is_auto)
  select c.id, c.vendeur_id, c.acheteur_id, 3, 'vendeur', true
  from public.conversations c
  where c.rdv_confirme_at is not null
    and c.rdv_date < now() - interval '7 days'
    and not exists (
      select 1 from public.avis a
      where a.conversation_id = c.id and a.auteur_id = c.vendeur_id
    );
end;
$$;

revoke all on function public.fn_avis_auto_j7() from public;
-- pas de grant : seul le cron (postgres role) appelle cette fonction

-- ── 6. Cron quotidien 04:00 UTC ───────────────────────────────────────────

select cron.unschedule('avis-auto-j7') where exists (
  select 1 from cron.job where jobname = 'avis-auto-j7'
);

select cron.schedule(
  'avis-auto-j7',
  '0 4 * * *',
  $$ select public.fn_avis_auto_j7(); $$
);

-- ── 7. Évolution get_user_public_profile ──────────────────────────────────
-- Ajout de note_acheteur, nb_achats, et recent_avis (top 10 avec auteur).

create or replace function public.get_user_public_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
begin
  select * into v_user from public.users where id = p_user_id;

  if not found or v_user.is_active = false then
    return null;
  end if;

  return jsonb_build_object(
    'id',             v_user.id,
    'prenom',         v_user.prenom,
    'nom_initial',    upper(left(v_user.nom, 1)) || '.',
    'avatar_url',     v_user.avatar_url,
    'pays',           v_user.pays,
    'ville',          v_user.ville,
    'note_vendeur',   v_user.note_vendeur,
    'nb_ventes',      v_user.nb_ventes,
    'note_acheteur',  v_user.note_acheteur,
    'nb_achats',      v_user.nb_achats,
    'created_at',     v_user.created_at,
    'recent_avis',    (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      from (
        select
          a.id,
          a.note,
          a.commentaire,
          a.role_auteur,
          a.is_auto,
          a.created_at,
          ua.id          as auteur_id,
          ua.prenom      as auteur_prenom,
          ua.avatar_url  as auteur_avatar_url
        from public.avis a
        join public.users ua on ua.id = a.auteur_id
        where a.cible_id = p_user_id
        order by a.created_at desc
        limit 10
      ) t
    )
  );
end;
$$;

-- Grants identiques à l'original (mig 16)
revoke all on function public.get_user_public_profile(uuid) from public;
grant execute on function public.get_user_public_profile(uuid) to authenticated, anon;
