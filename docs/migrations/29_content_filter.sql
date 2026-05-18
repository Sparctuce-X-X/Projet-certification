-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 29 — Filtre de contenu (mots interdits)
--
-- Niveau 1 de modération : rejet préventif des annonces et messages
-- contenant des mots interdits. Trigger BEFORE INSERT/UPDATE sur annonces
-- et BEFORE INSERT sur messages.
--
-- Table `mots_interdits` : administrable via Dashboard (ajout/retrait sans
-- migration). Catégorisée pour les stats admin.
--
-- Le filtre est case-insensitive et cherche le mot comme token entier
-- (pas de faux positif sur "assassin" quand on cherche "ass").
--
-- CDC v4.0 §2.7 : "Produits interdits : armes, drogues, contrefaçons,
-- animaux, contenus illégaux, services adultes"
--
-- Prérequis : migrations 15 (annonces), 22 (messages).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table mots_interdits ────────────────────────────────────────────────

create table if not exists public.mots_interdits (
  id         serial      primary key,
  mot        text        not null unique,
  categorie  text        not null default 'autre',
  created_at timestamptz not null default now()
);

comment on table public.mots_interdits is
  'Blocklist de mots interdits. Administrable via Dashboard. Case-insensitive.';

-- ── 2. Seed initial — FR + argot local CI/CG ──────────────────────────────

insert into public.mots_interdits (mot, categorie) values
  -- Armes
  ('pistolet', 'armes'), ('fusil', 'armes'), ('arme', 'armes'), ('kalachnikov', 'armes'),
  ('munition', 'armes'), ('cartouche', 'armes'), ('couteau cran', 'armes'),
  ('bombe', 'armes'), ('explosif', 'armes'),

  -- Drogues
  ('cocaine', 'drogues'), ('cocaïne', 'drogues'), ('heroine', 'drogues'), ('héroïne', 'drogues'),
  ('cannabis', 'drogues'), ('marijuana', 'drogues'), ('weed', 'drogues'), ('chanvre', 'drogues'),
  ('crack', 'drogues'), ('ecstasy', 'drogues'), ('tramadol', 'drogues'),
  ('drogue', 'drogues'), ('stupéfiant', 'drogues'),
  -- Argot CI (Nouchi)
  ('gban', 'drogues'), ('yamba', 'drogues'),

  -- Contrefaçons
  ('faux billet', 'contrefaçons'), ('contrefaçon', 'contrefaçons'),
  ('réplique exacte', 'contrefaçons'), ('copie conforme', 'contrefaçons'),
  ('faux papier', 'contrefaçons'), ('faux permis', 'contrefaçons'),
  ('faux passeport', 'contrefaçons'), ('fausse carte', 'contrefaçons'),

  -- Contenu sexuel / adulte
  ('escort', 'adulte'), ('prostitution', 'adulte'), ('pornographie', 'adulte'),
  ('nudes', 'adulte'), ('sexuel', 'adulte'), ('sex tape', 'adulte'),
  -- Argot
  ('go facile', 'adulte'), ('tchoin', 'adulte'),

  -- Arnaques
  ('arnaque', 'arnaques'), ('brouteur', 'arnaques'), ('scam', 'arnaques'),
  ('ponzi', 'arnaques'), ('pyramide', 'arnaques'), ('investissement garanti', 'arnaques'),
  ('doublement argent', 'arnaques'), ('forex garanti', 'arnaques'),
  ('bitcoin garanti', 'arnaques'), ('crypto garanti', 'arnaques'),
  ('money transfer', 'arnaques'), ('western union', 'arnaques'),

  -- Animaux vivants (interdit marketplace)
  ('chiot à vendre', 'animaux'), ('chaton à vendre', 'animaux'),
  ('animal vivant', 'animaux'), ('perroquet à vendre', 'animaux'),

  -- Insultes graves
  ('enculé', 'insultes'), ('nique ta', 'insultes'), ('fils de pute', 'insultes'),
  ('connard', 'insultes'), ('salaud', 'insultes'),
  -- Nouchi CI
  ('gbêh', 'insultes'), ('kpakpato', 'insultes')

on conflict (mot) do nothing;

-- ── 3. Fonction de vérification ────────────────────────────────────────────

create or replace function public.fn_check_forbidden_words(p_text text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lower text;
  v_found text;
begin
  if p_text is null or trim(p_text) = '' then
    return null;
  end if;

  v_lower := lower(p_text);

  -- Cherche le premier mot interdit trouvé dans le texte.
  -- Utilise position() pour matcher comme sous-chaîne (pas mot entier strict)
  -- car les variantes orthographiques sont courantes en français d'Afrique.
  select m.mot into v_found
  from public.mots_interdits m
  where position(lower(m.mot) in v_lower) > 0
  limit 1;

  return v_found;
end;
$$;

-- ── 4. Trigger BEFORE INSERT/UPDATE sur annonces ───────────────────────────

create or replace function public.fn_annonces_content_filter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found text;
begin
  -- Vérifier le titre
  v_found := public.fn_check_forbidden_words(NEW.titre);
  if v_found is not null then
    raise exception 'contenu_interdit'
      using hint = 'Le titre contient un terme interdit : "' || v_found || '". Modifie ton annonce.';
  end if;

  -- Vérifier la description
  v_found := public.fn_check_forbidden_words(NEW.description);
  if v_found is not null then
    raise exception 'contenu_interdit'
      using hint = 'La description contient un terme interdit : "' || v_found || '". Modifie ton annonce.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_annonces_content_filter on public.annonces;
create trigger tg_annonces_content_filter
  before insert or update on public.annonces
  for each row
  execute function public.fn_annonces_content_filter();

-- ── 5. Trigger BEFORE INSERT sur messages ──────────────────────────────────

create or replace function public.fn_messages_content_filter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found text;
begin
  v_found := public.fn_check_forbidden_words(NEW.contenu);
  if v_found is not null then
    raise exception 'contenu_interdit'
      using hint = 'Ton message contient un terme interdit : "' || v_found || '". Modifie ton message.';
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_messages_content_filter on public.messages;
create trigger tg_messages_content_filter
  before insert on public.messages
  for each row
  execute function public.fn_messages_content_filter();
