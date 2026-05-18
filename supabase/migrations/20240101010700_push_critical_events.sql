-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 67 — Push notifs critiques (F10 — events business restants)
--
-- 4 events transactionnels qui méritaient absolument une notif :
--
--   A. Compte suspendu (auto via score abus OU manuel admin_suspend_user)
--      → notif au user concerné — il doit savoir pourquoi il ne peut plus
--        se connecter / poster
--
--   B. Annonce suspendue par admin
--      → notif au vendeur — l'annonce a disparu de Home/Search, il doit
--        savoir et corriger
--
--   C. Avis reçu (notation post-RDV)
--      → notif au noté — boucle de feedback essentielle, incite à
--        consulter son profil + répondre
--
--   D. Annonce expirée (cron 60j passe à 'expiree')
--      → notif au vendeur — incite à prolonger via "Mes annonces"
--
-- Tous utilisent le helper public._notify_push (mig 65).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A. Compte suspendu (users.is_active : true → false) ─────────────────────

create or replace function public.fn_push_user_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.is_active = OLD.is_active then return NEW; end if;
  if NEW.is_active <> false then return NEW; end if;

  perform public._notify_push(
    array[NEW.id],
    'Compte suspendu',
    'Ton compte Niqo a été suspendu suite à des signalements confirmés. Contacte support@niqo.africa.',
    jsonb_build_object('url', '/profile')
  );
  return NEW;
end;
$$;

drop trigger if exists trg_push_user_suspended on public.users;
create trigger trg_push_user_suspended
  after update of is_active on public.users
  for each row
  execute function public.fn_push_user_suspended();

-- ── B. Annonce suspendue (annonces.statut → 'suspendue') ────────────────────

create or replace function public.fn_push_annonce_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.statut = OLD.statut then return NEW; end if;
  if NEW.statut <> 'suspendue' then return NEW; end if;

  perform public._notify_push(
    array[NEW.vendeur_id],
    'Annonce suspendue',
    'Ton annonce "' ||
      case when char_length(NEW.titre) > 60
        then substring(NEW.titre, 1, 57) || '…'
        else NEW.titre
      end || '" a été retirée par la modération.',
    jsonb_build_object('annonce_id', NEW.id::text)
  );
  return NEW;
end;
$$;

drop trigger if exists trg_push_annonce_suspended on public.annonces;
create trigger trg_push_annonce_suspended
  after update of statut on public.annonces
  for each row
  execute function public.fn_push_annonce_suspended();

-- ── C. Avis reçu (insert sur avis) ──────────────────────────────────────────

create or replace function public.fn_push_avis_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auteur_prenom text;
  v_stars         text;
  v_preview       text;
begin
  select coalesce(prenom, 'Quelqu''un') into v_auteur_prenom
    from public.users where id = NEW.auteur_id;

  -- Étoiles unicode (★/☆) pour le titre
  v_stars := repeat('★', NEW.note) || repeat('☆', 5 - NEW.note);

  v_preview := coalesce(v_auteur_prenom, 'Quelqu''un') ||
               ' t''a noté ' || NEW.note || '/5';
  if NEW.commentaire is not null and char_length(NEW.commentaire) > 0 then
    v_preview := v_preview || ' · ' ||
      case when char_length(NEW.commentaire) > 100
        then substring(NEW.commentaire, 1, 97) || '…'
        else NEW.commentaire
      end;
  end if;

  perform public._notify_push(
    array[NEW.cible_id],
    'Avis reçu ' || v_stars,
    v_preview,
    jsonb_build_object('url', '/u/' || NEW.cible_id::text)
  );
  return NEW;
end;
$$;

drop trigger if exists trg_push_avis_received on public.avis;
create trigger trg_push_avis_received
  after insert on public.avis
  for each row
  execute function public.fn_push_avis_received();

-- ── D. Annonce expirée (annonces.statut → 'expiree' par cron mig 16) ────────

create or replace function public.fn_push_annonce_expired()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.statut = OLD.statut then return NEW; end if;
  if NEW.statut <> 'expiree' then return NEW; end if;

  perform public._notify_push(
    array[NEW.vendeur_id],
    'Annonce expirée',
    '"' ||
      case when char_length(NEW.titre) > 60
        then substring(NEW.titre, 1, 57) || '…'
        else NEW.titre
      end ||
      '" a expiré. Prolonge-la depuis Mes annonces.',
    jsonb_build_object('annonce_id', NEW.id::text)
  );
  return NEW;
end;
$$;

drop trigger if exists trg_push_annonce_expired on public.annonces;
create trigger trg_push_annonce_expired
  after update of statut on public.annonces
  for each row
  execute function public.fn_push_annonce_expired();
