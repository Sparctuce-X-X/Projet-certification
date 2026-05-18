-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 117 — Seed mots_interdits : 42 patterns d'arnaques marketplace
--
-- CONTEXTE
--   Couche 1 de la modération automatique v4.0 : étendre la blocklist
--   `mots_interdits` (mig 29) avec des patterns ciblés sur les arnaques
--   spécifiques au marketplace C2C francophone (CI/CG).
--
--   Niqo ne gère pas le paiement (modèle hors-transaction v4.0). Tout pattern
--   demandant un paiement à l'avance, un code OTP, ou redirigeant hors-plateforme
--   est une arnaque par construction.
--
-- ARCHITECTURE
--   Réutilisation intégrale de l'infra mig 29 — uniquement des INSERT :
--   - Table `mots_interdits` (mot, categorie)
--   - Fonction `fn_check_forbidden_words` (substring case-insensitive)
--   - Triggers `tg_annonces_content_filter` + `tg_messages_content_filter`
--   → Les nouveaux patterns sont automatiquement appliqués sur les 2 surfaces
--     (annonces titre+description et messages) sans modification de code.
--
-- PATTERNS AJOUTÉS (42)
--   - arnaques_otp        (13) — demande de code de vérification SMS / OTP
--   - arnaques_avance     (17) — pré-paiement Mobile Money / Wave / cash
--   - arnaques_frais      (04) — frais fictifs (douane, déblocage, activation)
--   - arnaques_liens      (08) — URLs raccourcies + redirects wa.me/telegram.me
--
-- DÉCISIONS DE SCOPE (faux positifs)
--   ❌ Pas d'ALTER TABLE : substring match suffit pour ces patterns
--   ❌ Pas de regex : reporté en étape 2 (OpenAI Moderation) pour les cas gris
--      type 'caution'/'whatsapp'/'frais livraison' qui nécessitent du contexte
--   ❌ Pas de pattern email/téléphone : risque faux positifs élevé sur diaspora
--      et business pro légitime
--   ❌ Pas 'envoie code' (matcherait 'code postal/wifi/promo')
--   ❌ Pas 'frais de transfert' (legit en cession véhicule "carte grise")
--   ❌ Pas bare 't.me/' (matcherait 'petit.me/...') — utilise 'telegram.me/'
--   ❌ Pas 'wave avance'/'mtn avance' (matcherait "comment avance ton projet?")
--      → remplacé par 'wave à l''avance'/'mtn à l''avance' (sans ambiguïté)
--
--   Chaque entrée a été validée comme phrase n'apparaissant JAMAIS dans un
--   contexte marketplace légitime (zéro raison qu'un acheteur/vendeur honnête
--   demande un OTP, paye à l'avance avant RDV, ou redirige hors-plateforme).
--
-- Idempotente (`on conflict (mot) do nothing`). Pas de DDL = pas d'ALTER.
-- Cf. CLAUDE.md §Migrations Supabase, mig 29 (infra), mig 105 (RLS).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.mots_interdits (mot, categorie) values
  -- ── arnaques_otp (13) ──────────────────────────────────────────────────
  -- Un acheteur/vendeur ne demande JAMAIS de code OTP. C'est exclusivement
  -- une tentative de prise de contrôle de compte (banque, Mobile Money,
  -- WhatsApp, Niqo lui-même). Patterns ciblent les phrasings exacts utilisés
  -- par les brouteurs CI/CG.
  ('code reçu par sms',           'arnaques_otp'),
  ('code par sms',                'arnaques_otp'),
  ('code à 6 chiffres',           'arnaques_otp'),
  ('code à 6 chiffre',            'arnaques_otp'),  -- typo variant
  ('code de validation',          'arnaques_otp'),
  ('code de vérification',        'arnaques_otp'),
  ('code de confirmation',        'arnaques_otp'),
  ('code que tu as reçu',         'arnaques_otp'),
  ('code que vous avez reçu',     'arnaques_otp'),
  ('code que tu vas recevoir',    'arnaques_otp'),
  ('code que vous allez recevoir','arnaques_otp'),
  ('sms de validation',           'arnaques_otp'),
  ('sms de vérification',         'arnaques_otp'),

  -- ── arnaques_avance (17) ───────────────────────────────────────────────
  -- Niqo v4.0 = modèle hors-transaction. L'utilisateur paye en direct
  -- (cash ou Mobile Money entre eux) lors du RDV physique. Toute demande
  -- de paiement avant le RDV est par définition une arnaque marketplace.
  -- "à l'avance" + verbe = phrasing canonique. "d'abord" + verbe = variante.
  -- Brand+"à l'avance" = phrasing fréquent CI/CG sur Mobile Money.
  ('paiement à l''avance',        'arnaques_avance'),
  ('payement à l''avance',        'arnaques_avance'),  -- orthographe alt
  ('payer à l''avance',           'arnaques_avance'),
  ('paie à l''avance',            'arnaques_avance'),
  ('paye à l''avance',            'arnaques_avance'),
  ('payez à l''avance',           'arnaques_avance'),
  ('envoie d''abord',             'arnaques_avance'),
  ('envoyez d''abord',            'arnaques_avance'),
  ('paye d''abord',               'arnaques_avance'),
  ('payez d''abord',              'arnaques_avance'),
  ('transfère d''abord',          'arnaques_avance'),
  ('transférez d''abord',         'arnaques_avance'),
  ('mobile money à l''avance',    'arnaques_avance'),
  ('wave à l''avance',            'arnaques_avance'),
  ('orange money à l''avance',    'arnaques_avance'),
  ('mtn à l''avance',             'arnaques_avance'),
  ('moov à l''avance',            'arnaques_avance'),

  -- ── arnaques_frais (4) ─────────────────────────────────────────────────
  -- Pattern brouteur classique : faire payer des "frais" fictifs avant
  -- une transaction qui n'aura jamais lieu. Aucun frais de douane sur
  -- une transaction locale Abidjan↔Abidjan ou Brazzaville↔Brazzaville.
  -- Liste réduite à 4 patterns 100% sans ambiguïté (drop 'frais de transit',
  -- 'frais de transfert', 'frais bancaire' qui ont des cas légitimes
  -- en cession véhicule / banque).
  ('frais de douane',             'arnaques_frais'),
  ('frais de déblocage',          'arnaques_frais'),
  ('frais d''activation',         'arnaques_frais'),
  ('frais de transfert international', 'arnaques_frais'),

  -- ── arnaques_liens (8) ─────────────────────────────────────────────────
  -- URLs raccourcies = quasi 100% phishing/malware sur marketplace C2C.
  -- wa.me/telegram.me = redirect hors-plateforme (Niqo perd la conversation,
  -- l'utilisateur perd la trace + la protection en cas de litige).
  -- Drop 't.me/' (matcherait 'petit.me/'), 't.co/' (matcherait 'petit.co/').
  -- 'telegram.me/' est le canonique alternatif de Telegram.
  ('bit.ly/',                     'arnaques_liens'),
  ('tinyurl.com/',                'arnaques_liens'),
  ('cutt.ly/',                    'arnaques_liens'),
  ('short.io/',                   'arnaques_liens'),
  ('rebrand.ly/',                 'arnaques_liens'),
  ('ow.ly/',                      'arnaques_liens'),
  ('wa.me/',                      'arnaques_liens'),
  ('telegram.me/',                'arnaques_liens')

on conflict (mot) do nothing;
