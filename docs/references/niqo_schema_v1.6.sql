-- ============================================================
-- NIQO — Schema SQL Supabase v1.6
-- CDC v3.12 · PostgreSQL 15
-- ============================================================
-- Changelog v1.6 (vs v1.5) — PawaPay API v2 intégration :
--   [1]  statut_transaction + 'echoue'           — deposit PawaPay refusé ou FAILED
--   [2]  transactions.pawapay_deposit_id          — remplace pawapay_id (UUID Niqo → POST /v2/deposits)
--                                                   REQUIS pour POST /v2/refunds (référence obligatoire)
--   [3]  transactions.pawapay_payout_id           — UUID Niqo → POST /v2/payouts (virement vendeur)
--   [4]  transactions.pawapay_refund_id           — UUID Niqo → POST /v2/refunds (remboursement)
--   [5]  transactions.pawapay_deposit_provider_tx — providerTransactionId callback deposit (ID opérateur)
--   [6]  transactions.pawapay_payout_provider_tx  — providerTransactionId callback payout
--   [7]  transactions.wave_redirect_url           — authorizationUrl Wave CI (flow redirection)
--   [8]  transactions.montant_str                 — montant en string (format PawaPay, sans décimales XOF)
--   [9]  fn_transactions_before_insert v2         — génère pawapay_deposit_id AVANT appel PawaPay
--  [10]  fn_deposit_webhook                       — traite callback /v2/deposits → statut escrow/echoue
--  [11]  fn_payout_webhook                        — traite callback /v2/payouts → statut complete confirmé
--  [12]  fn_refund_webhook                        — traite callback /v2/refunds → statut rembourse confirmé
--  [13]  cron reconciliation-pawapay              — recheck cycle 15 min (transactions en_attente > 15 min)
-- ============================================================
-- Changelog v1.5 (vs v1.4b) :
--   [v1.5-1]  transactions.remise_confirmee_at — timestamp remise physique (Screen 22A)
--   [v1.5-2]  transactions.remise_photo_url    — preuve optionnelle (Supabase Storage)
--   [v1.5-3]  statut_transaction ENUM enrichi  — 'en_litige' suspend remboursement auto
--   [v1.5-4]  litiges.initiateur_id            — qui a ouvert le litige
--   [v1.5-5]  litiges.type_initiateur          — 'acheteur' | 'vendeur'
--   [v1.5-6]  motif_litige ENUM               — raisons distinctes par rôle
--   [v1.5-7]  litiges.resolu_par              — admin décisionnaire (null = auto-cron)
--   [v1.5-8]  litiges.resolu_at               — horodatage décision admin
--   [v1.5-9]  fn_transactions_on_complete     — pg_notify virement IMMÉDIAT
--  [v1.5-10]  fn_litige_on_insert             — transaction → 'en_litige' à l'INSERT litige
--  [v1.5-11]  fn_auto_decision_litiges v2     — perdant via transactions.acheteur_id/vendeur_id
--  [v1.5-12]  cron expire-codes               — skip statut 'en_litige'
--  [v1.5-13]  users.role_principal SUPPRIMÉ   — même screens pour tous
-- ============================================================
-- Ordre d'exécution :
--   1. Extensions
--   2. Types ENUM
--   3. Tables (ordre FK)
--   4. Index
--   5. Triggers
--   6. RLS Policies
--   7. pg_cron jobs
--   8. Données initiales
--   9. Fonctions utilitaires
--  10. Fonctions auto-décision
-- ============================================================


-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pg_cron";
create extension if not exists "pgcrypto";     -- bcrypt pour code_hash


-- ============================================================
-- 2. TYPES ENUM
-- ============================================================

create type pays_code         as enum ('CI', 'CG');
create type role_type         as enum ('vendeur', 'acheteur');
create type auth_provider     as enum ('google', 'apple', 'email');
create type etat_objet        as enum ('neuf', 'tres_bon', 'bon', 'moyen');
create type statut_annonce    as enum ('active', 'en_cours', 'vendue', 'suspendue', 'expiree');
create type statut_conv       as enum ('ouverte', 'en_transaction', 'fermee');
create type type_message      as enum ('texte', 'offre_prix', 'systeme', 'image');

-- [3][v1.6-1] statut_transaction enrichi
create type statut_transaction as enum (
  'en_attente',   -- deposit initié côté PawaPay, UUID stocké, attente callback
  'echoue',       -- [v1.6] deposit PawaPay FAILED ou REJECTED avant escrow
  'escrow',       -- fonds collectés → dans le compte PawaPay Niqo, remise en attente
  'code_envoye',  -- code 6 chars généré et affiché à l'acheteur
  'en_litige',    -- [v1.5] litige ouvert → remboursement auto suspendu
  'complete',     -- code validé par vendeur → payout déclenché vers vendeur
  'expire',       -- code expiré sans validation ni litige → refund déclenché
  'rembourse'     -- refund PawaPay COMPLETED (acheteur remboursé)
);

-- [6] motif_litige enrichi — raisons distinctes par rôle
create type motif_litige as enum (
  -- Raisons ACHETEUR
  'vendeur_absent',          -- vendeur ne s'est pas présenté
  'article_non_conforme',    -- article ne correspond pas à l'annonce
  'article_endommage',       -- article endommagé à la remise
  -- Raisons VENDEUR
  'acheteur_absent',         -- acheteur ne s'est pas présenté
  'code_incorrect',          -- acheteur présente un mauvais code
  'refus_remise',            -- acheteur refuse de valider après remise
  -- Commun
  'autre'
);

create type statut_litige     as enum ('ouvert', 'en_cours', 'resolu', 'annule');
create type resolution_litige as enum (
  'en_faveur_vendeur', 'en_faveur_acheteur', 'partage', 'annule'
);
create type statut_signalement as enum ('en_attente', 'traite', 'rejete');
create type cible_signalement  as enum ('annonce', 'utilisateur', 'message');


-- ============================================================
-- 3. TABLES
-- ============================================================

-- ------------------------------------------------------------
-- categories
-- ------------------------------------------------------------
create table categories (
  id         uuid          primary key default uuid_generate_v4(),
  nom        text          not null,
  icone      text          not null,           -- nom icône Lucide
  ordre      int           not null default 0,
  is_active  boolean       not null default true,

  constraint categories_nom_unique unique (nom)
);

comment on table categories is 'Catégories des annonces Niqo';


-- ------------------------------------------------------------
-- users (extension de auth.users Supabase)
-- ------------------------------------------------------------
create table users (
  id               uuid          primary key references auth.users(id) on delete cascade,
  email            text          not null unique,
  prenom           text          not null,
  nom              text          not null,
  telephone_enc    text,                        -- chiffré Supabase Vault (RGPD)
  pays             pays_code     not null,
  ville            text          not null,
  quartier         text,
  auth_provider    auth_provider not null default 'email',
  note_vendeur     numeric(3,2)  not null default 0 check (note_vendeur between 0 and 5),
  note_acheteur    numeric(3,2)  not null default 0 check (note_acheteur between 0 and 5),
  nb_ventes        int           not null default 0,
  nb_achats        int           not null default 0,
  score_abus       int           not null default 0,
  avatar_url       text,
  is_active        boolean       not null default true,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

comment on column users.telephone_enc  is 'Chiffré via Supabase Vault — jamais exposé en clair';
comment on column users.score_abus     is 'Incrémenté par trigger après litige perdu. ≥3 → is_active=false auto';
comment on column users.is_active      is 'false = compte suspendu, ne peut plus publier ni acheter';


-- ------------------------------------------------------------
-- annonces
-- ------------------------------------------------------------
create table annonces (
  id            uuid            primary key default uuid_generate_v4(),
  vendeur_id    uuid            not null references users(id) on delete cascade,
  categorie_id  uuid            not null references categories(id),
  titre         text            not null check (char_length(titre) between 3 and 50),  -- CDC F02 : max 50 chars
  description   text            not null check (char_length(description) between 10 and 2000),
  prix          numeric(12, 0)  not null check (prix > 0),
  prix_negocie  numeric(12, 0)  check (prix_negocie > 0),
  photos        text[]          not null default '{}' check (array_length(photos, 1) between 1 and 5),
  etat          etat_objet      not null,
  statut        statut_annonce  not null default 'active',
  pays          pays_code       not null,       -- hérité de users.pays (immuable — segmentation CI/CG)
  ville         text            not null,
  quartier      text,           -- COALESCE(saisi, users.quartier) — peut différer du profil
  nb_vues       int             not null default 0,
  expires_at    timestamptz     not null,       -- = created_at + 60j (calculé à l'INSERT)
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now()
);

comment on column annonces.expires_at    is 'Calculé à l''INSERT : created_at + 60 days. Modèle Leboncoin.';
comment on column annonces.prix_negocie  is 'Prix final après négociation. Null si pas de négociation.';
comment on column annonces.pays          is 'Hérité de users.pays à l''INSERT — immuable (segmentation CI/CG).';
comment on column annonces.ville         is 'COALESCE(saisi par vendeur, users.ville) — peut différer du profil.';


-- ------------------------------------------------------------
-- conversations
-- ------------------------------------------------------------
create table conversations (
  id                    uuid           primary key default uuid_generate_v4(),
  annonce_id            uuid           not null references annonces(id) on delete cascade,
  acheteur_id           uuid           not null references users(id),
  vendeur_id            uuid           not null references users(id),
  statut                statut_conv    not null default 'ouverte',
  last_message_preview  text,          -- dénormalisé pour éviter jointures coûteuses
  last_message_at       timestamptz,
  created_at            timestamptz    not null default now(),

  constraint conversations_unique unique (annonce_id, acheteur_id)  -- 1 conversation par paire
);

comment on table conversations is
  'Reste accessible et active après paiement — acheteur et vendeur coordonnent la remise via la conversation.';


-- ------------------------------------------------------------
-- messages
-- ------------------------------------------------------------
create table messages (
  id               uuid          primary key default uuid_generate_v4(),
  conversation_id  uuid          not null references conversations(id) on delete cascade,
  expediteur_id    uuid          not null references users(id),
  contenu          text          not null check (char_length(contenu) > 0),
  type             type_message  not null default 'texte',
  offre_montant    numeric(12,0) check (offre_montant > 0),  -- renseigné si type='offre_prix'
  is_read          boolean       not null default false,
  is_deleted       boolean       not null default false,      -- suppression logique
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

comment on column messages.is_deleted    is 'Suppression logique — conservé pour les litiges';
comment on column messages.offre_montant is 'Renseigné uniquement si type=offre_prix. Null sinon.';


-- ------------------------------------------------------------
-- transactions
-- ------------------------------------------------------------
create table transactions (
  id                    uuid                primary key default uuid_generate_v4(),
  annonce_id            uuid                not null references annonces(id),
  acheteur_id           uuid                not null references users(id),
  vendeur_id            uuid                not null references users(id),
  conversation_id       uuid                not null references conversations(id),
  pays                  pays_code           not null,  -- hérité de annonces.pays
  montant               numeric(12,0)       not null check (montant > 0),
  commission_montant    numeric(12,0)       not null,  -- 5% de montant, calculé à l'INSERT
  code_hash             text                not null,  -- bcrypt hash du code 6 chars
  statut                statut_transaction  not null default 'en_attente',
  expires_at            timestamptz         not null,  -- code expire 48h après création
  extension_used        boolean             not null default false,  -- +24h acheteur, max 1 fois
  -- [v1.5] Preuve de remise physique
  remise_confirmee_at   timestamptz,                   -- vendeur tape "J'ai remis l'article" → 22A
  remise_photo_url      text,                          -- photo preuve optionnelle (Supabase Storage)

  -- [v1.6] PawaPay API v2 — 3 UUIDs distincts (générés par Niqo, stockés AVANT appel API)
  -- ⚠️ pawapay_deposit_id OBLIGATOIRE pour POST /v2/refunds (référence le dépôt original)
  pawapay_deposit_id              text    unique,      -- UUID Niqo → POST /v2/deposits (paiement acheteur)
  pawapay_payout_id               text    unique,      -- UUID Niqo → POST /v2/payouts  (virement vendeur)
  pawapay_refund_id               text    unique,      -- UUID Niqo → POST /v2/refunds  (remboursement acheteur)

  -- IDs retournés par l'opérateur Mobile Money (visibles dans SMS reçus par l'utilisateur)
  pawapay_deposit_provider_tx_id  text,                -- callback deposit : providerTransactionId
  pawapay_payout_provider_tx_id   text,                -- callback payout  : providerTransactionId

  -- [v1.6] Wave CI uniquement — flow redirection (authType=REDIRECT_AUTH)
  wave_redirect_url               text,                -- authorizationUrl → redirige acheteur vers Wave

  -- [v1.6] Montant en string pour PawaPay (XOF = 0 décimales, pas de décimales autorisées)
  montant_str                     text generated always as (montant::text) stored,

  created_at            timestamptz         not null default now(),
  updated_at            timestamptz         not null default now()
);

comment on column transactions.code_hash                    is 'bcrypt du code 6 chars. Jamais exposé en clair via API.';
comment on column transactions.expires_at                   is 'Code expire 48h après création. Extension +24h acheteur (1 fois max).';
comment on column transactions.remise_confirmee_at          is '[v1.5] Timestamp J''ai remis l''article (Screen 22A). Preuve anti-fraude si litige.';
comment on column transactions.remise_photo_url             is '[v1.5] Photo preuve de remise (optionnelle). Stockée dans Supabase Storage.';
comment on column transactions.commission_montant           is '5% de montant, calculé à l''INSERT.';
comment on column transactions.extension_used              is 'Acheteur peut prolonger de +24h une seule fois (unilatéral, vendeur notifié).';
comment on column transactions.pawapay_deposit_id           is '[v1.6] UUID généré par Niqo AVANT POST /v2/deposits. REQUIS pour POST /v2/refunds. Stocker avant d''appeler PawaPay.';
comment on column transactions.pawapay_payout_id            is '[v1.6] UUID généré par Niqo AVANT POST /v2/payouts. Stocker avant d''appeler PawaPay.';
comment on column transactions.pawapay_refund_id            is '[v1.6] UUID généré par Niqo AVANT POST /v2/refunds. Stocker avant d''appeler PawaPay.';
comment on column transactions.pawapay_deposit_provider_tx_id is '[v1.6] providerTransactionId du callback deposit — ID visible dans le SMS Orange/MTN de l''acheteur.';
comment on column transactions.pawapay_payout_provider_tx_id  is '[v1.6] providerTransactionId du callback payout — ID visible dans le SMS du vendeur.';
comment on column transactions.wave_redirect_url            is '[v1.6] authorizationUrl Wave CI uniquement (authType=REDIRECT_AUTH). Url vers laquelle rediriger l''acheteur.';
comment on column transactions.montant_str                  is '[v1.6] Colonne générée : montant en string pour PawaPay. XOF = 0 décimales (MOOV_BEN, ORANGE_CIV etc.).';


-- ------------------------------------------------------------
-- avis
-- ------------------------------------------------------------
create table avis (
  id              uuid          primary key default uuid_generate_v4(),
  transaction_id  uuid          not null references transactions(id),
  auteur_id       uuid          not null references users(id),
  cible_id        uuid          not null references users(id),
  note            int           not null check (note between 1 and 5),
  commentaire     text          check (char_length(commentaire) <= 500),
  role_auteur     role_type     not null,  -- vendeur | acheteur
  created_at      timestamptz   not null default now(),

  constraint avis_unique_par_transaction_auteur unique (transaction_id, auteur_id)
);

comment on table avis is '1 avis max par auteur par transaction. Trigger recalcule note_vendeur / note_acheteur sur users.';


-- ------------------------------------------------------------
-- litiges
-- ------------------------------------------------------------
create table litiges (
  id               uuid               primary key default uuid_generate_v4(),
  transaction_id   uuid               not null references transactions(id),

  -- [4][5] Qui a ouvert le litige (v1.5)
  initiateur_id    uuid               not null references users(id),
  type_initiateur  role_type          not null,  -- 'acheteur' | 'vendeur'

  admin_id         uuid               references users(id),   -- null jusqu'à prise en charge

  motif            motif_litige       not null,
  description      text               check (char_length(description) <= 1000),
  preuves          text[]             not null default '{}',  -- URLs Supabase Storage

  statut           statut_litige      not null default 'ouvert',
  resolution       resolution_litige,

  -- [7][8] Décision admin (v1.5)
  resolu_par       uuid               references users(id),   -- admin_id décisionnaire
  resolu_at        timestamptz,                               -- horodatage décision

  appeal_used               boolean    not null default false,
  demandeur_repondu_at      timestamptz,
  partie_adverse_repondu_at timestamptz,

  created_at       timestamptz        not null default now(),
  updated_at       timestamptz        not null default now(),

  constraint litiges_unique_par_transaction unique (transaction_id)  -- 1 litige par transaction
);

comment on column litiges.initiateur_id   is '[v1.5] Qui a ouvert le litige. Permet de déterminer le rôle sans jointure.';
comment on column litiges.type_initiateur is '[v1.5] acheteur | vendeur. Redondant mais utile pour les requêtes admin rapides.';
comment on column litiges.resolu_par      is '[v1.5] Admin qui a statué. Null si auto-résolu par cron.';
comment on column litiges.resolu_at       is '[v1.5] Horodatage de la décision. Distinct de updated_at.';

comment on table litiges is
  'Conditions ouverture litige :
   — Acheteur : vendeur_absent | article_non_conforme | article_endommage
   — Vendeur  : acheteur_absent | code_incorrect | refus_remise
   Litige IMPOSSIBLE après code validé (transaction.statut = complete).
   Litige ouvert → transaction.statut = en_litige → remboursement auto suspendu.';


-- ------------------------------------------------------------
-- signalements
-- ------------------------------------------------------------
create table signalements (
  id            uuid               primary key default uuid_generate_v4(),
  target_type   cible_signalement  not null,
  target_id     uuid               not null,
  signaleur_id  uuid               not null references users(id),
  motif         text               not null,
  description   text,
  statut        statut_signalement not null default 'en_attente',
  created_at    timestamptz        not null default now(),
  updated_at    timestamptz        not null default now()
);

comment on table signalements is 'Distinct des litiges. Pas d''escrow impliqué. Alimente score_abus via trigger.';


-- ============================================================
-- 4. INDEX
-- ============================================================

-- Recherche principale : annonces par pays + statut
create index idx_annonces_pays_statut
  on annonces (pays)
  where statut = 'active';

-- Expiration Cron
create index idx_annonces_expires_at
  on annonces (expires_at)
  where statut = 'active';

-- Recherche par catégorie + pays
create index idx_annonces_categorie_pays
  on annonces (categorie_id, pays, statut);

-- Recherche par ville + quartier
create index idx_annonces_localisation
  on annonces (pays, ville, quartier, statut);

-- Conversations d'un utilisateur
create index idx_conversations_acheteur on conversations (acheteur_id);
create index idx_conversations_vendeur  on conversations (vendeur_id);

-- Messages d'une conversation
create index idx_messages_conversation
  on messages (conversation_id, created_at desc);

-- Transactions actives (Cron code expiration)
-- [v1.5-12] Exclut explicitement 'en_litige' et 'echoue' du partial index
create index idx_transactions_expires_at
  on transactions (expires_at)
  where statut in ('escrow', 'code_envoye');  -- 'en_litige' et 'echoue' exclus intentionnellement

-- [v1.6] PawaPay — lookup par depositId pour webhooks (idempotence)
create index idx_transactions_deposit_id   on transactions (pawapay_deposit_id)  where pawapay_deposit_id  is not null;
create index idx_transactions_payout_id    on transactions (pawapay_payout_id)   where pawapay_payout_id   is not null;
create index idx_transactions_refund_id    on transactions (pawapay_refund_id)   where pawapay_refund_id   is not null;

-- [v1.6] Réconciliation — transactions en attente depuis plus de 15 minutes
create index idx_transactions_reconciliation
  on transactions (created_at)
  where statut = 'en_attente';

-- Signalements en attente
create index idx_signalements_target
  on signalements (target_type, target_id, statut)
  where statut = 'en_attente';

-- Avis par cible (calcul note)
create index idx_avis_cible on avis (cible_id, role_auteur);

-- Transactions d'un utilisateur
create index idx_transactions_acheteur on transactions (acheteur_id, statut);
create index idx_transactions_vendeur  on transactions (vendeur_id, statut);

-- Jointures
create index idx_avis_transaction    on avis     (transaction_id);
create index idx_litiges_transaction on litiges  (transaction_id);

-- Signalements d'un utilisateur
create index idx_signalements_signaleur on signalements (signaleur_id);

-- Litiges en attente de réponse (auto-décision cron)
create index idx_litiges_auto_decision
  on litiges (created_at)
  where statut in ('ouvert', 'en_cours') and resolu_at is null;

-- [v1.5] Litiges par initiateur (dashboard admin)
create index idx_litiges_initiateur
  on litiges (initiateur_id, type_initiateur, statut);

-- [v1.5] Transactions avec remise confirmée (protection vendeur)
create index idx_transactions_remise
  on transactions (remise_confirmee_at)
  where remise_confirmee_at is not null and statut = 'en_litige';


-- ============================================================
-- 5. TRIGGERS
-- ============================================================

-- ------------------------------------------------------------
-- 5.1 Annonces — calculer expires_at + pays/ville à l'INSERT
-- ------------------------------------------------------------
create or replace function fn_annonces_before_insert()
returns trigger language plpgsql as $$
declare
  v_vendeur users%rowtype;
begin
  select * into v_vendeur from users where id = NEW.vendeur_id;

  -- pays toujours hérité du profil (segmentation CI/CG immuable)
  NEW.pays := v_vendeur.pays;

  -- ville/quartier : COALESCE(saisi, profil)
  NEW.ville    := COALESCE(NULLIF(TRIM(NEW.ville), ''),    v_vendeur.ville);
  NEW.quartier := COALESCE(NULLIF(TRIM(NEW.quartier), ''), v_vendeur.quartier);

  -- expires_at : 60 jours (modèle Leboncoin)
  NEW.expires_at := now() + interval '60 days';
  NEW.nb_vues    := 0;

  return NEW;
end;
$$;

create trigger tg_annonces_before_insert
  before insert on annonces
  for each row execute function fn_annonces_before_insert();


-- ------------------------------------------------------------
-- 5.2 updated_at auto (toutes les tables)
-- ------------------------------------------------------------
create or replace function fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger tg_annonces_updated_at     before update on annonces     for each row execute function fn_set_updated_at();
create trigger tg_transactions_updated_at before update on transactions for each row execute function fn_set_updated_at();
create trigger tg_messages_updated_at     before update on messages     for each row execute function fn_set_updated_at();
create trigger tg_litiges_updated_at      before update on litiges      for each row execute function fn_set_updated_at();
create trigger tg_users_updated_at        before update on users        for each row execute function fn_set_updated_at();
create trigger tg_signalements_updated_at before update on signalements for each row execute function fn_set_updated_at();


-- ------------------------------------------------------------
-- 5.3 Transactions — commission + expires_at + depositId à l'INSERT
-- [v1.6] Le pawapay_deposit_id est généré ICI et stocké en BDD
--        AVANT que l'Edge Function appelle PawaPay.
--        Pattern PawaPay : toujours stocker l'ID avant l'appel API
--        pour pouvoir réconcilier en cas d'erreur réseau.
-- ------------------------------------------------------------
create or replace function fn_transactions_before_insert()
returns trigger language plpgsql as $$
declare
  v_annonce annonces%rowtype;
begin
  select * into v_annonce from annonces where id = NEW.annonce_id;

  NEW.pays               := v_annonce.pays;
  NEW.commission_montant := round(NEW.montant * 0.05);
  NEW.expires_at         := now() + interval '48 hours';

  -- [v1.6] Générer pawapay_deposit_id maintenant si pas fourni
  -- L'Edge Function utilisera cet UUID pour POST /v2/deposits
  -- En cas d'erreur réseau, Niqo peut GET /v2/deposits/{pawapay_deposit_id} pour réconcilier
  if NEW.pawapay_deposit_id is null then
    NEW.pawapay_deposit_id := uuid_generate_v4()::text;
  end if;

  return NEW;
end;
$$;

create trigger tg_transactions_before_insert
  before insert on transactions
  for each row execute function fn_transactions_before_insert();


-- ------------------------------------------------------------
-- 5.4 Avis — recalcul note_vendeur / note_acheteur sur users
-- ------------------------------------------------------------
create or replace function fn_avis_after_insert()
returns trigger language plpgsql as $$
begin
  if NEW.role_auteur = 'acheteur' then
    update users set
      note_vendeur = (
        select round(avg(note)::numeric, 2)
        from avis
        where cible_id = NEW.cible_id and role_auteur = 'acheteur'
      )
    where id = NEW.cible_id;
  else
    update users set
      note_acheteur = (
        select round(avg(note)::numeric, 2)
        from avis
        where cible_id = NEW.cible_id and role_auteur = 'vendeur'
      )
    where id = NEW.cible_id;
  end if;
  return NEW;
end;
$$;

create trigger tg_avis_after_insert
  after insert on avis
  for each row execute function fn_avis_after_insert();


-- ------------------------------------------------------------
-- 5.5 Transactions — completion : nb_ventes/nb_achats + payout
-- [9] v1.5 : pg_notify pour virement IMMÉDIAT (plus de délai 24h)
-- ------------------------------------------------------------
create or replace function fn_transactions_on_complete()
returns trigger language plpgsql as $$
begin
  if NEW.statut = 'complete' and OLD.statut != 'complete' then
    -- Incrémenter compteurs
    update users set nb_ventes = nb_ventes + 1 where id = NEW.vendeur_id;
    update users set nb_achats = nb_achats + 1 where id = NEW.acheteur_id;

    -- Marquer l'annonce vendue
    update annonces
    set statut = 'vendue', updated_at = now()
    where id = NEW.annonce_id;

    -- [v1.5] Déclencher Edge Function PawaPay → virement immédiat au vendeur
    -- L'Edge Function écoute ce channel et initie le payout
    perform pg_notify('payout_ready', NEW.id::text);
  end if;
  return NEW;
end;
$$;

create trigger tg_transactions_on_complete
  after update on transactions
  for each row execute function fn_transactions_on_complete();


-- ------------------------------------------------------------
-- [v1.6] 5.6bis — Webhooks PawaPay — traitement des callbacks
-- Ces fonctions sont appelées par les Edge Functions Supabase
-- qui reçoivent les callbacks de PawaPay.
--
-- PATTERN PawaPay :
--   1. Callback deposit  → COMPLETED  → statut escrow
--   2. Callback deposit  → FAILED     → statut echoue + notif acheteur
--   3. Callback payout   → COMPLETED  → confirmation virement vendeur
--   4. Callback refund   → COMPLETED  → confirmation remboursement acheteur
--
-- Idempotence : chaque fonction vérifie le statut avant UPDATE
-- pour éviter les doublons si le callback est reçu plusieurs fois.
-- ------------------------------------------------------------

-- Callback deposit COMPLETED → escrow (argent dans compte PawaPay Niqo)
create or replace function fn_deposit_webhook(
  p_deposit_id             text,
  p_status                 text,   -- 'COMPLETED' | 'FAILED'
  p_provider_transaction_id text   -- ID opérateur (SMS acheteur)
) returns text language plpgsql as $$
declare
  v_tx transactions%rowtype;
begin
  select * into v_tx
  from transactions
  where pawapay_deposit_id = p_deposit_id;

  if not found then
    return 'NOT_FOUND';
  end if;

  -- Idempotence : skip si déjà traité
  if v_tx.statut != 'en_attente' then
    return 'ALREADY_PROCESSED:' || v_tx.statut;
  end if;

  if p_status = 'COMPLETED' then
    update transactions set
      statut                          = 'escrow',
      pawapay_deposit_provider_tx_id  = p_provider_transaction_id,
      updated_at                      = now()
    where id = v_tx.id;

    -- Générer le code 6 chars (fait dans l'Edge Function, pas ici)
    -- pg_notify pour que l'Edge Function génère + envoie le code
    perform pg_notify('deposit_completed', v_tx.id::text);
    return 'OK:escrow';

  elsif p_status = 'FAILED' then
    update transactions set
      statut     = 'echoue',
      updated_at = now()
    where id = v_tx.id;

    perform pg_notify('deposit_failed', v_tx.id::text);
    return 'OK:echoue';
  end if;

  return 'UNKNOWN_STATUS:' || p_status;
end;
$$;

comment on function fn_deposit_webhook is
  '[v1.6] Traite le callback PawaPay /v2/deposits.
   COMPLETED → statut=escrow + pg_notify deposit_completed (Edge Function génère le code).
   FAILED    → statut=echoue + pg_notify deposit_failed (Edge Function notifie acheteur).
   Idempotent — safe si appelée plusieurs fois avec le même depositId.';


-- Callback payout COMPLETED → confirmation (le virement vendeur est bien reçu)
create or replace function fn_payout_webhook(
  p_payout_id              text,
  p_status                 text,   -- 'COMPLETED' | 'FAILED'
  p_provider_transaction_id text
) returns text language plpgsql as $$
declare
  v_tx transactions%rowtype;
begin
  select * into v_tx
  from transactions
  where pawapay_payout_id = p_payout_id;

  if not found then return 'NOT_FOUND'; end if;

  if p_status = 'COMPLETED' then
    update transactions set
      pawapay_payout_provider_tx_id = p_provider_transaction_id,
      updated_at                    = now()
    where id = v_tx.id;
    -- statut reste 'complete' (déjà mis à jour par fn_transactions_on_complete)
    perform pg_notify('payout_completed', v_tx.id::text);
    return 'OK:payout_confirmed';

  elsif p_status = 'FAILED' then
    -- Payout échoué : remettre en escrow pour retry manuel par admin
    update transactions set
      statut     = 'escrow',
      updated_at = now()
    where id = v_tx.id and statut = 'complete';
    perform pg_notify('payout_failed', v_tx.id::text);
    return 'OK:payout_failed_reverted_to_escrow';
  end if;

  return 'UNKNOWN_STATUS:' || p_status;
end;
$$;

comment on function fn_payout_webhook is
  '[v1.6] Traite le callback PawaPay /v2/payouts.
   COMPLETED → confirme le virement, stocke providerTransactionId.
   FAILED    → revert statut=escrow pour retry admin.
   Idempotent.';


-- Callback refund COMPLETED → confirmation remboursement acheteur
create or replace function fn_refund_webhook(
  p_refund_id text,
  p_status    text    -- 'COMPLETED' | 'FAILED'
) returns text language plpgsql as $$
declare
  v_tx transactions%rowtype;
begin
  select * into v_tx
  from transactions
  where pawapay_refund_id = p_refund_id;

  if not found then return 'NOT_FOUND'; end if;

  if p_status = 'COMPLETED' then
    update transactions set
      statut     = 'rembourse',
      updated_at = now()
    where id = v_tx.id
      and statut in ('expire', 'en_litige', 'echoue');
    perform pg_notify('refund_completed', v_tx.id::text);
    return 'OK:rembourse';

  elsif p_status = 'FAILED' then
    -- Refund échoué : alerter admin (cas rare, traitement manuel)
    perform pg_notify('refund_failed', v_tx.id::text);
    return 'OK:refund_failed_needs_attention';
  end if;

  return 'UNKNOWN_STATUS:' || p_status;
end;
$$;

comment on function fn_refund_webhook is
  '[v1.6] Traite le callback PawaPay /v2/refunds.
   COMPLETED → statut=rembourse.
   FAILED    → pg_notify refund_failed pour traitement admin manuel.
   Idempotent.';




-- ------------------------------------------------------------
-- 5.6 Litiges — score_abus + suspension auto si score ≥ 3
-- ------------------------------------------------------------
create or replace function fn_litiges_after_update()
returns trigger language plpgsql as $$
declare
  v_perdant uuid;
begin
  if NEW.statut = 'resolu' and OLD.statut != 'resolu' then

    -- Le perdant se déduit de la RÉSOLUTION, pas de l'initiateur.
    -- transactions.acheteur_id / vendeur_id = source de vérité des rôles.
    if NEW.resolution = 'en_faveur_vendeur' then
      -- vendeur gagne → acheteur a perdu
      select acheteur_id into v_perdant
      from transactions where id = NEW.transaction_id;
    elsif NEW.resolution = 'en_faveur_acheteur' then
      -- acheteur gagne → vendeur a perdu
      select vendeur_id into v_perdant
      from transactions where id = NEW.transaction_id;
    end if;

    if v_perdant is not null then
      update users
      set
        score_abus = score_abus + 1,
        is_active  = case when score_abus + 1 >= 3 then false else is_active end
      where id = v_perdant;
    end if;

    -- Remettre la transaction en 'rembourse' ou 'complete' selon la résolution
    update transactions
    set
      statut     = case
                     when NEW.resolution = 'en_faveur_acheteur' then 'rembourse'
                     when NEW.resolution = 'en_faveur_vendeur'  then 'complete'
                     else statut
                   end,
      updated_at = now()
    where id = NEW.transaction_id
      and statut = 'en_litige';

  end if;
  return NEW;
end;
$$;

create trigger tg_litiges_after_update
  after update on litiges
  for each row execute function fn_litiges_after_update();


-- ------------------------------------------------------------
-- [10] 5.7 Litiges — à l'INSERT : transaction → 'en_litige'
--           Suspend le remboursement auto
-- ------------------------------------------------------------
create or replace function fn_litige_on_insert()
returns trigger language plpgsql as $$
begin
  -- Passer la transaction en 'en_litige' pour suspendre le remboursement auto
  update transactions
  set
    statut     = 'en_litige',
    updated_at = now()
  where id = NEW.transaction_id
    and statut in ('escrow', 'code_envoye');  -- seulement si pas encore validée

  return NEW;
end;
$$;

create trigger tg_litige_on_insert
  after insert on litiges
  for each row execute function fn_litige_on_insert();


-- ============================================================
-- 6. RLS POLICIES
-- ============================================================

alter table users          enable row level security;
alter table annonces       enable row level security;
alter table conversations  enable row level security;
alter table messages       enable row level security;
alter table transactions   enable row level security;
alter table avis           enable row level security;
alter table litiges        enable row level security;
alter table signalements   enable row level security;

-- Users : chaque utilisateur voit uniquement son propre profil
create policy "users_own_profile" on users
  for all using (auth.uid() = id);

-- Annonces : lecture publique (actives uniquement), écriture propriétaire
create policy "annonces_read_active" on annonces
  for select using (statut = 'active');

create policy "annonces_owner_all" on annonces
  for all using (auth.uid() = vendeur_id);

-- Conversations : acheteur ou vendeur seulement
create policy "conversations_participants" on conversations
  for all using (auth.uid() = acheteur_id or auth.uid() = vendeur_id);

-- Messages : participants de la conversation
create policy "messages_participants" on messages
  for all using (
    exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and (c.acheteur_id = auth.uid() or c.vendeur_id = auth.uid())
    )
  );

-- Transactions : acheteur ou vendeur de la transaction
create policy "transactions_participants" on transactions
  for all using (auth.uid() = acheteur_id or auth.uid() = vendeur_id);

-- Avis : auteur ou cible
create policy "avis_participants" on avis
  for all using (auth.uid() = auteur_id or auth.uid() = cible_id);

-- Litiges : initiateur ou partie adverse (vendeur ou acheteur de la transaction)
create policy "litiges_participants" on litiges
  for all using (
    auth.uid() = initiateur_id
    or exists (
      select 1 from transactions t
      where t.id = litiges.transaction_id
        and (t.acheteur_id = auth.uid() or t.vendeur_id = auth.uid())
    )
  );

-- Signalements : signaleur uniquement
create policy "signalements_signaleur" on signalements
  for all using (auth.uid() = signaleur_id);


-- ============================================================
-- 7. pg_cron JOBS
-- ============================================================

-- ------------------------------------------------------------
-- 7.1 Expiration annonces — chaque nuit à 02:00 UTC
-- ------------------------------------------------------------
select cron.schedule(
  'expire-annonces',
  '0 2 * * *',
  $$
    update annonces
    set statut = 'expiree', updated_at = now()
    where statut = 'active'
      and expires_at < now();
  $$
);


-- ------------------------------------------------------------
-- [12] 7.2 Expiration codes transaction — toutes les 15 minutes
--     v1.5 : NE PAS expirer les transactions en_litige
-- ------------------------------------------------------------
select cron.schedule(
  'expire-codes-transaction',
  '*/15 * * * *',
  $$
    update transactions
    set statut = 'expire', updated_at = now()
    where statut in ('escrow', 'code_envoye')  -- 'en_litige' EXCLU
      and expires_at < now();
    -- Note : remboursement PawaPay déclenché par Edge Function
    --        sur changement de statut → 'expire'
  $$
);


-- ------------------------------------------------------------
-- 7.3 Notation automatique — 15 jours sans réponse
-- ------------------------------------------------------------
select cron.schedule(
  'auto-notation',
  '0 3 * * *',
  $$
    insert into avis (transaction_id, auteur_id, cible_id, note, commentaire, role_auteur)
    select t.id, t.acheteur_id, t.vendeur_id, 3, 'Note automatique — absence de retour', 'acheteur'
    from transactions t
    where t.statut = 'complete'
      and t.updated_at < now() - interval '15 days'
      and not exists (select 1 from avis a where a.transaction_id = t.id and a.auteur_id = t.acheteur_id);

    insert into avis (transaction_id, auteur_id, cible_id, note, commentaire, role_auteur)
    select t.id, t.vendeur_id, t.acheteur_id, 3, 'Note automatique — absence de retour', 'vendeur'
    from transactions t
    where t.statut = 'complete'
      and t.updated_at < now() - interval '15 days'
      and not exists (select 1 from avis a where a.transaction_id = t.id and a.auteur_id = t.vendeur_id);
  $$
);


-- ------------------------------------------------------------
-- [v1.6] 7.5 Réconciliation PawaPay — toutes les 15 minutes
--        Pattern recommandé par PawaPay docs.
--        Vérifie les transactions bloquées en 'en_attente' depuis > 15 min
--        (callback non reçu, erreur réseau, downtime opérateur).
--        L'Edge Function interroge GET /v2/deposits/{pawapay_deposit_id}
--        et appelle fn_deposit_webhook selon le statut retourné.
-- ------------------------------------------------------------
select cron.schedule(
  'reconciliation-pawapay',
  '*/15 * * * *',
  $$
    -- Notifie l'Edge Function de réconcilier les transactions bloquées
    -- L'Edge Function appellera GET /v2/deposits/{pawapay_deposit_id}
    -- et appelera fn_deposit_webhook avec le statut réel
    select pg_notify(
      'reconciliation_needed',
      row_to_json(t)::text
    )
    from transactions t
    where t.statut = 'en_attente'
      and t.created_at < now() - interval '15 minutes'
      and t.pawapay_deposit_id is not null;
  $$
);


--     v1.5 : gestion correcte vendeur/acheteur via type_initiateur
-- ------------------------------------------------------------
select cron.schedule(
  'auto-decision-litiges',
  '0 * * * *',
  $$ select fn_auto_decision_litiges(); $$
);


-- ============================================================
-- 8. DONNÉES INITIALES — catégories
-- ============================================================

insert into categories (nom, icone, ordre) values
  ('Téléphones & Accessoires', 'smartphone',  1),
  ('Mode & Vêtements',         'shirt',        2),
  ('Électronique',             'monitor',      3),
  ('Maison & Électroménager',  'home',         4),
  ('Véhicules',                'car',          5),
  ('Sports & Loisirs',         'dumbbell',     6),
  ('Livres & Formation',       'book-open',    7),
  ('Enfants & Bébé',           'baby',         8),
  ('Autres',                   'package',      9);


-- ============================================================
-- 9. FONCTION PROLONGATION ANNONCE (modèle Leboncoin — 28j)
-- ============================================================
create or replace function fn_prolonger_annonce(p_annonce_id uuid, p_vendeur_id uuid)
returns jsonb language plpgsql as $$
declare
  v_annonce  annonces%rowtype;
  v_deadline timestamptz;
begin
  select * into v_annonce from annonces where id = p_annonce_id;

  if v_annonce.vendeur_id != p_vendeur_id then
    return jsonb_build_object('success', false, 'error', 'not_owner');
  end if;

  if v_annonce.statut != 'expiree' then
    return jsonb_build_object('success', false, 'error', 'not_expired');
  end if;

  v_deadline := v_annonce.expires_at + interval '28 days';
  if now() > v_deadline then
    return jsonb_build_object('success', false, 'error', 'window_closed', 'deadline', v_deadline);
  end if;

  update annonces
  set statut = 'active', expires_at = now() + interval '60 days', updated_at = now()
  where id = p_annonce_id;

  return jsonb_build_object('success', true, 'new_expires_at', now() + interval '60 days');
end;
$$;

comment on function fn_prolonger_annonce is
  'CDC 2.6 — prolongation Leboncoin : fenêtre 28j après expiration, remet expires_at à now()+60j';


-- ============================================================
-- [11] 10. FONCTION AUTO-DÉCISION LITIGE (v1.5)
--     Corrections v1.5 :
--     — Ne touche pas aux transactions en_litige (remboursement suspendu)
--     — Utilise type_initiateur pour déterminer la résolution correcte
--     — Utilise resolu_par = null (auto) et resolu_at = now()
-- ============================================================
create or replace function fn_auto_decision_litiges()
returns int language plpgsql as $$
declare
  v_litige   litiges%rowtype;
  v_count    int := 0;
  v_deadline timestamptz;
  v_resolution resolution_litige;
begin
  for v_litige in
    select * from litiges
    where statut in ('ouvert', 'en_cours')
      and created_at < now() - interval '48 hours'
      and resolu_at is null
  loop
    v_deadline := v_litige.created_at + interval '48 hours';

    -- Cas 1 : demandeur n'a pas répondu → annule le litige
    if v_litige.demandeur_repondu_at is null
    or v_litige.demandeur_repondu_at > v_deadline then

      update litiges set
        statut     = 'annule',
        resolution = 'annule',
        resolu_par = null,        -- auto, pas d'admin
        resolu_at  = now(),
        updated_at = now()
      where id = v_litige.id;

      v_count := v_count + 1;

    -- Cas 2 : partie adverse n'a pas répondu, demandeur a répondu
    -- → en faveur de l'initiateur
    elsif (v_litige.partie_adverse_repondu_at is null
       or  v_litige.partie_adverse_repondu_at > v_deadline)
      and v_litige.demandeur_repondu_at <= v_deadline then

      -- La résolution dépend du type_initiateur
      v_resolution := case v_litige.type_initiateur
        when 'acheteur' then 'en_faveur_acheteur'::resolution_litige
        when 'vendeur'  then 'en_faveur_vendeur'::resolution_litige
      end;

      update litiges set
        statut     = 'resolu',
        resolution = v_resolution,
        resolu_par = null,        -- auto, pas d'admin
        resolu_at  = now(),
        updated_at = now()
      where id = v_litige.id;
      -- Note : tg_litiges_after_update met à jour transactions et score_abus

      v_count := v_count + 1;

    end if;
  end loop;

  return v_count;
end;
$$;

comment on function fn_auto_decision_litiges is
  'v1.5 — CDC 2.8 : auto-décision après 48h.
   Demandeur silencieux → annule.
   Partie adverse silencieuse → en faveur de l''initiateur (type_initiateur).
   resolu_par = null pour distinguer auto-résolution de décision admin.
   Appelée par cron toutes les heures.';


-- ============================================================
-- FIN — niqo_schema_v1.6.sql
-- v1.1 : BUG-01..08, WARN-01..10
-- v1.2 : catégories, fn_prolonger_annonce, index composites
-- v1.3 : demandeur/partie_adverse_repondu_at, fn_auto_decision_litiges, cron horaire
-- v1.4 : lieu annonce COALESCE(saisi, profil)
-- v1.4b: titre max 50 chars (CDC F02)
-- v1.5 : remise_confirmee_at, remise_photo_url, statut en_litige,
--         initiateur_id, type_initiateur, resolu_par, resolu_at,
--         pg_notify payout immédiat, fn_litige_on_insert,
--         fn_auto_decision_litiges v2, cron skip en_litige,
--         role_principal SUPPRIMÉ
-- v1.6 : PawaPay API v2 — deposit/payout/refund IDs distincts,
--         statut echoue, wave_redirect_url, montant_str,
--         fn_deposit/payout/refund_webhook, cron réconciliation 15min
-- ============================================================
