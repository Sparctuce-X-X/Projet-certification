# Environnement technique & implémentation — Niqo

> **Cible RNCP CDA** — Bloc 1 (développer une application sécurisée) + Bloc 2 (concevoir et développer une application multi-couches).
> **Date** — 2026-05-19. **Version app** — 1.0.0 (6) iOS LIVE App Store, rebuild 1.0.1 en cours iOS + Android closed testing.
> **Source de vérité produit** — [CAHIER_DES_CHARGES.md](./CAHIER_DES_CHARGES.md) (v5.0).
> **Source opérationnelle** — [CLAUDE.md](../CLAUDE.md) (root).

Ce document décrit **comment** Niqo est construit : choix de stack, services, organisation du code, patterns d'implémentation transverses, exemples concrets référencés au code source. Il complète [methodologie-uml.md](./methodologie-uml.md) (le **quoi**, modélisation) et [tests-et-deploiement.md](./tests-et-deploiement.md) (la **livraison**, qualité + CI/CD).

---

## 1. Contexte et objectif RNCP

Le RNCP CDA (code 31678) évalue trois blocs de compétences. Ce document adresse :

| Bloc | Compétence évaluée | Section de ce doc |
|---|---|---|
| **Bloc 1** | Développer une application sécurisée (front + back, OWASP, RGPD) | §10, §11 |
| **Bloc 2** | Concevoir et développer une application multi-couches répartie | §2-§9 |
| Bloc 3 | Préparer le déploiement | hors-scope → [tests-et-deploiement.md](./tests-et-deploiement.md) |

L'évaluation porte sur la **cohérence** entre les choix techniques et les contraintes produit (marché africain francophone, réseau instable, devices entry-level, modèle hors transaction). Chaque choix de cette doc est tracé à une contrainte explicite.

---

## 2. Vue d'ensemble — architecture 3-tiers répartie

```
┌─────────────────────────────────────────────────────────────────────┐
│ Tier 1 — Présentation                                               │
├─────────────────────────────────────────────────────────────────────┤
│  Mobile (Expo SDK 54 + React Native 0.81.5 + Expo Router 6)         │
│  Admin web (Next.js 16.2 — App Router + RSC + Server Actions)       │
│  Page publique (Next.js 16.2 — niqo.africa/a/[id], /support, /legal)│
└─────────────────────────────────────────────────────────────────────┘
                              ↕ HTTPS + JWT (Supabase Auth)
┌─────────────────────────────────────────────────────────────────────┐
│ Tier 2 — Logique métier                                             │
├─────────────────────────────────────────────────────────────────────┤
│  Supabase Auth (OAuth Google/Apple + Email/password, PKCE)          │
│  PostgREST (REST auto-généré sur les tables avec RLS)               │
│  Realtime (WebSocket — chat live F04)                               │
│  RPCs SQL (~40 — opérations transactionnelles complexes)            │
│  Triggers (~20 — invariants métier auto, cascades)                  │
│  Edge Functions Deno (13 — webhooks, modération, push, PDF, email)  │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ SQL natif (pas d'ORM)
┌─────────────────────────────────────────────────────────────────────┐
│ Tier 3 — Persistance                                                │
├─────────────────────────────────────────────────────────────────────┤
│  PostgreSQL 15 (managed Supabase, RLS sur toutes les tables)        │
│  Supabase Storage (3 buckets : avatars · annonces-photos · cni)     │
│  Supabase Vault (chiffrement applicatif `users.telephone`)          │
│  pg_net (HTTP sortant async — appels Edge Functions depuis trigger) │
│  pg_cron (planificateur — 10 crons : expiration, digest, scrub)     │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ HTTP/Webhook
┌─────────────────────────────────────────────────────────────────────┐
│ Services tiers                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  PawaPay (Mobile Money — boosts + KYC, webhooks HMAC signés)        │
│  OpenAI Moderation API (texte annonces + messages)                  │
│  AWS Rekognition (DetectModerationLabels — photos annonces + CNI)   │
│  Resend (emails transactionnels — KYC, alertes digest, welcome)     │
│  Sentry (3 projets — mobile · edge · admin)                         │
│  Expo Push (notifications iOS via APNs / Android via FCM)           │
│  EAS Build + EAS Update (binaires + OTA JS)                         │
└─────────────────────────────────────────────────────────────────────┘
```

**Choix structurants justifiés :**

| Choix | Raison | Alternative écartée |
|---|---|---|
| **Codebase mobile unique** (React Native + Expo) | 2 stores avec 1 équipe (Phase 1 = 1 dev mobile) | Natif iOS/Android (×2 effort) |
| **Supabase managé** | Auth + DB + Storage + Realtime + Functions dans un seul SaaS, RLS DB-side = sécurité par défaut | Stack DIY (Postgres + Auth0 + S3 + Pusher → coûts ops × 4) |
| **Pas d'ORM** | SQL natif → triggers et RLS visibles d'un coup d'œil ; pas de magie ; les migrations sont auditables | Prisma / Drizzle (couche d'indirection qui masque la sécurité DB) |
| **Edge Functions Deno** | Sandbox sécurisée, secrets isolés, déploiement atomique | Serveur Node permanent (coûts + ops + cold start négligeables sur les usages) |
| **Next.js 16 App Router** pour l'admin | RSC = auth gate côté serveur, pas de hydration JS pour les KPIs | SPA React + REST (auth gate côté client = fuite par défaut) |
| **Mobile + Web partagent Supabase** | Une seule base d'auth, RLS unique, pas de duplication des règles métier | API gateway custom (autre couche à sécuriser) |

---

## 3. Stack mobile — Expo + React Native

### 3.1 Versions et fichiers de config

Inventaire extrait de [package.json](../package.json) :

```jsonc
{
  "expo": "~54.0.33",              // SDK 54 (publié oct 2025, support iOS 15+ / Android 7+)
  "react": "19.1.0",
  "react-native": "0.81.5",         // Hermes JS engine activé par défaut
  "expo-router": "~6.0.23",         // File-based routing, typedRoutes activé
  "nativewind": "^4.2.3",           // Tailwind v3.4 compilé pour RN
  "react-native-reanimated": "~4.1.1",  // sur react-native-worklets 0.5
  "react-native-gesture-handler": "~2.28.0",
  "react-native-keyboard-controller": "1.18.5", // ajouté 1.0.1 — fix clavier iOS
  "@supabase/supabase-js": "^2.105.0",
  "@sentry/react-native": "~7.2.0", // ⚠ désactivé temporairement post-launch
  "expo-secure-store": "~15.0.8",   // Keychain iOS / Keystore Android
  "expo-image": "~3.0.11",          // Cache disk + memory, format AVIF/WebP
  "expo-notifications": "~0.32.17", // Expo Push (APNs + FCM)
  "lucide-react-native": "^1.11.0"  // Icônes SVG
}
```

| Fichier | Rôle |
|---|---|
| [app.json](../app.json) | Manifest Expo — bundle ID, version, plugins natifs, permissions iOS/Android, deep link scheme `niqo://` |
| [eas.json](../eas.json) | EAS Build — 4 profils (`development`, `development-simulator`, `preview`, `production`), `appVersionSource: "remote"` (auto-increment buildNumber) |
| [metro.config.js](../metro.config.js) | Bundler Metro avec `withNativeWind` |
| [babel.config.js](../babel.config.js) | preset-expo + `nativewind/babel` + `react-native-worklets/plugin` (⚠ pas `reanimated/plugin`, breaking change RN 0.81) |
| [tailwind.config.ts](../tailwind.config.ts) | Tokens design system — palette Niqo, typo (Space Grotesk / Inter / JetBrains Mono), spacing |
| [tsconfig.json](../tsconfig.json) | TS strict, paths `@/*` |

### 3.2 Routing — Expo Router file-based

Le routing copie la convention Next.js : chaque fichier sous [app/](../app/) est une route.

```
app/
├── _layout.tsx                # Root layout — fonts, providers, gates globaux
├── index.tsx                  # Splash animé (redirect /home après font load)
├── home.tsx                   # Feed annonces (route publique, browse-first)
├── search.tsx                 # Recherche + filtres
├── messages.tsx               # Liste conversations
├── sell.tsx                   # Wizard création annonce (5 steps)
├── profile.tsx                # Profil utilisateur courant
├── country-picker.tsx         # Premier lancement — choix CI/CG
├── announce/[id].tsx          # Détail annonce
├── auth/                      # Sign in/up (Google, Apple, Email)
├── legal/                     # Pages CGU/CGV/Confidentialité (mobile in-app)
├── messages/[conversationId].tsx
├── profile/blocked-users.tsx  # F15 — liste users bloqués
└── u/[id].tsx                 # Profil public d'un autre user
```

**Pourquoi file-based plutôt que React Navigation programmatique** — la **structure du code = la structure de l'app**, donc la modification d'un parcours = un mv/rm de fichier (revue visible en code review). Les `typedRoutes` génèrent des types TS pour les chemins, donc `<Link href="/announce/[id]" params={{ id }} />` est typé.

### 3.3 Root layout — [app/_layout.tsx](../app/_layout.tsx)

```tsx
// app/_layout.tsx — root layout chargé une seule fois au boot de l'app
function RootLayout() {
  // 1. Chargement parallèle des 3 polices Google Fonts via expo-google-fonts
  const [spaceGroteskLoaded] = useSpaceGroteskFonts({ SpaceGrotesk_500Medium });
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_600SemiBold });
  const [jetBrainsMonoLoaded] = useJetBrainsMonoFonts({ JetBrainsMono_500Medium });

  const fontsLoaded = spaceGroteskLoaded && interLoaded && jetBrainsMonoLoaded;

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null; // Évite le FOUT (Flash of Unstyled Text)

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>                    {/* react-native-keyboard-controller */}
        <SafeAreaProvider>
          <AuthProvider>                    {/* Context global — session Supabase */}
            <Stack screenOptions={{ headerShown: false }} />
            <AuthGate />                    {/* Redirige les routes protégées */}
            <ProfileCompletionGate />       {/* Force complete-profile après OAuth */}
            <PushNotificationGate />        {/* Demande permission push une fois */}
          </AuthProvider>
          <StatusBar style="light" />
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);     // Error boundary + breadcrumbs nav
```

Décomposition :

- **Trois polices Google Fonts auto-hébergées** via `@expo-google-fonts/*` — pas d'appel runtime à fonts.googleapis.com (offline-first + RGPD CNIL : éviter le tracking Google côté client).
- **Splash holdup** (`SplashScreen.preventAutoHideAsync()`) avant render → empêche le FOUT sur first frame.
- **3 gates globaux** rendus à côté du `<Stack>` — pattern de séparation : la navigation n'a pas à connaître la logique d'auth.
- **`Sentry.wrap()` autour de l'export** — capture les render errors React. Sur les Edge Functions et l'admin web, Sentry est actif ; sur mobile il est temporairement désactivé (manque `SENTRY_AUTH_TOKEN` côté EAS — task #18).

### 3.4 Auth gate — browse-first

Le marché africain n'a pas de culture du compte obligatoire. Niqo ouvre l'app **anonyme** sur Home, Search, AnnounceDetail. L'auth est déclenchée par 7 actions explicites :

| Action | Reason passé au gate |
|---|---|
| Vendre une annonce | `"sell"` |
| Lire ses messages | `"messages"` |
| Voir son profil | `"profile"` |
| Ajouter aux favoris | `"favorite"` |
| Recevoir des notifs | `"notifications"` |
| Contacter le vendeur | `"contact"` |
| Signaler | `"signaler"` |

Implémenté par [components/ui/AuthGate.tsx](../components/ui/AuthGate.tsx) — modal bottom-sheet plutôt qu'écran plein, pour ne pas casser le contexte de browse. Une fois loggué, l'action en attente est rejouée via [lib/pendingActions.ts](../lib/pendingActions.ts) (queue locale persistée AsyncStorage).

### 3.5 Stockage local — règle de séparation

```
expo-secure-store (Keychain iOS / Keystore Android, AES hardware-backed)
   → sessions Supabase (refresh_token, access_token)
   → fallback AsyncStorage si SecureStore plante (très vieux Android)

AsyncStorage (sandbox app, non chiffré)
   → préférences UI (pays choisi, dernière catégorie, theme)
   → file d'attente actions différées (lib/pendingActions.ts)
   → cache léger (compteurs unread last-seen)
```

Code exact dans [lib/supabase.ts:32-57](../lib/supabase.ts#L32-L57) (`SecureStoreAdapter`). Pourquoi cet adapter custom : SecureStore n'a pas d'API alignée sur l'interface `Storage` attendue par Supabase v2, et il faut le rendre **no-op en SSR** (Expo Router export web tente d'évaluer le module dans Node où `window` n'existe pas).

### 3.6 Polyfill Hermes — premier import critique

Hermes (le moteur JS de RN) ne ship pas `URL`/`Blob`. Supabase v2 les utilise. Donc :

```tsx
// lib/supabase.ts:1-3  — DOIT être la toute première ligne du module
import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";
```

Ce polyfill est **également** importé en tête de [app/_layout.tsx:3](../app/_layout.tsx#L3) — défense en profondeur, car l'ordre d'évaluation des modules en RN peut varier selon le bundler (Metro vs Babel transform).

---

## 4. Stack backend — Supabase

### 4.1 PostgreSQL 15 — schéma et migrations

**118 migrations** versionnées dans [supabase/migrations/](../supabase/migrations/), numérotation séquentielle, idempotentes (toutes commencent par `DROP IF EXISTS` / `CREATE OR REPLACE`). Index complet : [docs/migrations/INDEX.md](./migrations/INDEX.md).

Règle d'or — **DB incrémentale** : on ne crée pas une table avant que la feature soit codée côté mobile/admin. Un module = (mig N, ..., mig N+k) consécutives, jamais en bloc. La séquence chronologique du fichier raconte donc l'histoire produit (utile pour les évaluateurs RNCP qui suivent le développement linéaire).

### 4.2 RLS — sécurité par défaut

Toutes les tables ont **RLS activé** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`). Pattern type — table `annonces` :

```sql
-- Lecture : tout le monde voit les annonces actives non expirées
CREATE POLICY "annonces_select_public" ON public.annonces
  FOR SELECT
  USING (statut = 'active' AND expire_le > NOW());

-- Le propriétaire voit ses brouillons + expirées
CREATE POLICY "annonces_select_owner" ON public.annonces
  FOR SELECT
  USING (vendeur_id = auth.uid());

-- Écriture : seul le propriétaire
CREATE POLICY "annonces_update_owner" ON public.annonces
  FOR UPDATE
  USING (vendeur_id = auth.uid());
```

Conséquence : on **ne peut pas oublier** d'autoriser une lecture depuis le mobile. Si la requête est faite avec le JWT d'un user qui n'a pas de policy matching, PostgREST retourne 0 ligne (pas une erreur — sinon ce serait une fuite d'info).

### 4.3 RPCs SQL — opérations métier transactionnelles

Quand une opération nécessite plusieurs writes atomiques + des invariants métier, on l'écrit en RPC `SECURITY DEFINER` (s'exécute avec les droits du créateur, contourne RLS de façon contrôlée).

Exemple — création RDV F05 (mig 35) :

```sql
CREATE OR REPLACE FUNCTION public.propose_rdv(
  p_conversation_id uuid,
  p_date_rdv timestamptz,
  p_lieu text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp     -- ⚠ sinon search_path manipulable → CVE
AS $$
DECLARE
  v_rdv_id uuid;
  v_me uuid := auth.uid();
BEGIN
  -- Garde-fous : je dois être participant de la conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id
      AND (acheteur_id = v_me OR vendeur_id = v_me)
  ) THEN
    RAISE EXCEPTION 'NOT_A_PARTICIPANT' USING ERRCODE = 'P0001';
  END IF;

  -- Date doit être dans le futur (anti-fraude rétroactive)
  IF p_date_rdv <= NOW() THEN
    RAISE EXCEPTION 'RDV_DATE_PAST' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.rdvs (conversation_id, propose_par, date_rdv, lieu, statut)
  VALUES (p_conversation_id, v_me, p_date_rdv, p_lieu, 'propose')
  RETURNING id INTO v_rdv_id;

  -- Message système dans le chat (suit le pattern des autres events RDV)
  INSERT INTO public.messages (conversation_id, expediteur_id, contenu, type)
  VALUES (p_conversation_id, v_me, 'RDV proposé', 'systeme');

  RETURN v_rdv_id;
END $$;

-- Grant : tout user authentifié peut appeler, mais le check auth.uid() à l'intérieur garantit la sécurité
REVOKE ALL ON FUNCTION public.propose_rdv FROM public;
GRANT EXECUTE ON FUNCTION public.propose_rdv TO authenticated;
```

Pattern transverse :

1. `SECURITY DEFINER` + `SET search_path` (sinon vulnérable au search_path hijack)
2. Bloc de garde-fous métier (`RAISE EXCEPTION` avec code stable côté front)
3. Writes multiples dans la même transaction (atomicité)
4. `GRANT EXECUTE TO authenticated` (jamais `TO public`)

Côté mobile [lib/rdv.ts](../lib/rdv.ts) :

```ts
export async function proposeRdv(args: { conversationId: string; date: string; lieu: string }) {
  const { data, error } = await supabase.rpc("propose_rdv", {
    p_conversation_id: args.conversationId,
    p_date_rdv: args.date,
    p_lieu: args.lieu,
  });
  if (error) {
    // Mapping erreur Postgres → erreur métier UI
    if (error.message.includes("RDV_DATE_PAST")) throw new RdvDatePastError();
    if (error.message.includes("NOT_A_PARTICIPANT")) throw new NotAParticipantError();
    throw new Error(error.message);
  }
  return data as string;
}
```

### 4.4 Triggers — invariants métier auto

Quand un invariant doit être vrai **quoi qu'il arrive** (peu importe le chemin d'appel), on le pose en trigger DB. Exemple — F15 Block user (mig 130) :

```sql
-- Empêche d'INSERT un message si l'autre partie a bloqué l'expéditeur
CREATE OR REPLACE FUNCTION public.fn_messages_block_check()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_other uuid;
BEGIN
  -- Trouve l'autre participant
  SELECT CASE
    WHEN c.acheteur_id = NEW.expediteur_id THEN c.vendeur_id
    ELSE c.acheteur_id
  END INTO v_other
  FROM public.conversations c WHERE c.id = NEW.conversation_id;

  -- Bloque si l'autre a bloqué l'expéditeur
  IF EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE blocker_id = v_other AND blocked_id = NEW.expediteur_id
  ) THEN
    RAISE EXCEPTION 'BLOCKED_BY_RECIPIENT' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_messages_block_check
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_messages_block_check();
```

Pourquoi un trigger plutôt qu'une vérif côté mobile : un attaquant qui contourne le client (curl direct sur PostgREST avec son JWT) ne peut **pas** insérer un message si la cible l'a bloqué. La règle vit dans la couche la plus basse possible.

### 4.5 Edge Functions Deno — 13 fonctions

```
supabase/functions/
├── _shared/                          # Helpers communs (cors, sentry, types)
├── moderate-text/                    # OpenAI Moderation API — titre+desc annonce
├── moderate-image/                   # AWS Rekognition DetectModerationLabels — photos
├── moderate-message/                 # OpenAI Moderation API — messages chat (async via trigger)
├── pawapay-init-deposit/             # Init paiement Mobile Money (boost + KYC)
├── pawapay-webhook/                  # Webhook PawaPay → finalise statut paiement
├── send-push-notification/           # Expo Push (APNs + FCM)
├── send-admin-notification/          # Email Resend → admin (signalement, KYC en attente)
├── send-welcome-email/               # Email Resend → user (post-signup)
├── send-payment-confirmation/        # Email Resend → user (post-boost/KYC)
├── send-alert-digest/                # Cron daily → email admin digest événements
├── generate-compta-pdf/              # PDF rapport compta (admin)
├── purge-annonces-photos/            # Cron → suppression photos annonces expirées
└── sentry-test/                      # Endpoint test Sentry edge (debug only)
```

Pourquoi Deno plutôt que Node : sandbox par défaut (permissions explicites pour réseau/FS/env), pas de `node_modules` à shipper, cold start ~50ms, secrets isolés par fonction. Coûts Supabase : facturés à l'invocation, généreux en quota free tier pour le volume MVP.

Pattern d'une Edge Function — [supabase/functions/moderate-text/index.ts](../supabase/functions/moderate-text/index.ts) (extrait) :

```ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import * as Sentry from "https://deno.land/x/sentry@8.40.0/index.mjs";

Sentry.init({ dsn: Deno.env.get("SENTRY_DSN_EDGE"), environment: "production" });

serve(async (req) => {
  // CORS preflight + auth check
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  try {
    const { text } = await req.json();
    const resp = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: text }),
    });
    const result = await resp.json();
    const flagged = result.results[0].flagged;
    return new Response(JSON.stringify({ flagged, categories: result.results[0].categories }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    Sentry.captureException(err);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500 });
  }
});
```

Pattern transverse : init Sentry first, CORS + auth check, try/catch global → captureException, jamais d'echo du `err.message` au client (fuite info).

### 4.6 Realtime — chat F04

Le chat utilise Supabase Realtime (WebSocket multi-tenant sur `messages` filtré par `conversation_id`). Code mobile [lib/messages.ts](../lib/messages.ts) :

```ts
export function subscribeToConversation(conversationId: string, onMessage: (m: Message) => void) {
  const channel = supabase.channel(`conv:${conversationId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `conversation_id=eq.${conversationId}`,
    }, (payload) => onMessage(payload.new as Message))
    .subscribe();
  return () => supabase.removeChannel(channel);
}
```

Le filtre `conversation_id=eq.X` est **appliqué par Supabase mais également vérifié par RLS** — un user qui sniff le WS et tente de subscribe à une autre conv ne reçoit rien.

### 4.7 pg_cron + pg_net — orchestration interne

```sql
-- mig 65 : push notif via Edge Function depuis un trigger
CREATE OR REPLACE FUNCTION public.fn_notify_new_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key')),
    body := jsonb_build_object('user_id', NEW.recipient_id, 'message_id', NEW.id, 'type', 'new_message')
  );
  RETURN NEW;
END $$;
```

10 crons actifs (mig 109) : expiration auto annonces à 60j, scrub metadata PawaPay après 90j (RGPD), digest alertes admin quotidien à 09:00, purge photos annonces supprimées, etc.

---

## 5. Stack admin web — Next.js 16.2

### 5.1 Pourquoi Next.js 16 plutôt qu'une SPA

L'admin gère KYC (CNI + selfie) et signalements — données sensibles. Le **rendu serveur (RSC)** garantit qu'aucune donnée n'est envoyée au navigateur si l'user n'est pas admin. Avec une SPA classique, le bundle JS contient le code de l'admin et n'importe quel curieux peut l'auditer.

Stack précise :

| Couche | Choix |
|---|---|
| Framework | Next.js 16.2 (App Router, RSC, Turbopack) |
| React | 19.2 (Server Actions activées) |
| Styling | Tailwind v4 — variables CSS dans `globals.css`, pas de `tailwind.config.js` |
| Charts | Recharts v3.8 (KPIs admin) |
| Email | Resend (via Edge Functions, pas direct depuis Next.js) |
| Hébergement | Vercel (déployé Phase 1) |
| Auth | Supabase SSR via `@supabase/ssr` ([landing/src/lib/supabase/server.ts](../landing/src/lib/supabase/server.ts)) |

### 5.2 Auth gate côté serveur

```tsx
// landing/src/app/admin/(admin-protected)/layout.tsx (extrait)
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) redirect("/"); // ⚠ jamais d'info, juste redirect

  return <AdminSidebar>{children}</AdminSidebar>;
}
```

Le check `is_admin` se fait **avant** que le HTML soit généré. Un non-admin ne voit jamais le markup admin, même brièvement, et ne télécharge aucun JS lié à `/admin`.

### 5.3 Server Actions — mutations sans API REST custom

```tsx
// landing/src/app/admin/(admin-protected)/verifications/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

export async function approveVerification(verificationId: string) {
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("approve_verification", { p_id: verificationId });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/verifications");
}
```

Pas besoin d'écrire `/api/verifications/approve` puis un client `fetch` — Next.js sérialise l'action et la rejoue serveur-side. La RPC `approve_verification` (mig 49) fait le commit DB + envoie l'email Resend + flippe `users.is_verified = true`.

### 5.4 Pages publiques — annonce + support + légal

```
landing/src/app/
├── a/[id]/page.tsx           # Page publique d'une annonce — pour le partage social
├── support/page.tsx          # F14 — Required by Apple App Store (5 contacts + FAQ)
├── legal/                    # CGU, CGV, Confidentialité, Mentions, Charte, Cookies
└── (marketing)/page.tsx      # Landing niqo.africa
```

La page `/a/[id]` est SSR public → quand un user partage l'URL d'une annonce sur WhatsApp, le destinataire voit une preview Open Graph correcte (image + titre + prix) avant même de cliquer.

---

## 6. Services tiers — intégration et résilience

| Service | Usage | Pattern d'intégration | Gestion de panne |
|---|---|---|---|
| **PawaPay v2** | Encaissement boosts (1000/3000 FCFA) + KYC (1000 FCFA) | Edge `pawapay-init-deposit` → user redirigé app PawaPay → webhook signé HMAC SHA-256 → Edge `pawapay-webhook` met à jour `paiements.statut` | Si webhook timeout : cron retry 5 min, max 12 fois. Si fail définitif → paiement marqué `echoue`, user remboursé manuel admin |
| **OpenAI Moderation** | Texte annonces F02 + messages F04 | Edge `moderate-text` synchrone (création annonce) + `moderate-message` async via trigger (chat) | Si API down : annonce passe quand même (graceful degradation) + flag `moderation_status = 'pending'`, retry cron |
| **AWS Rekognition** | Photos annonces F02 + selfie KYC F07 | Edge `moderate-image` → `DetectModerationLabels` région `eu-west-1` (RGPD) | Idem OpenAI — passe en `pending` si fail |
| **Resend** | 4 templates (welcome, KYC validé, paiement confirmé, digest admin) | Edge Functions appelées par triggers DB | Erreur silencieuse côté Resend (l'absence d'email n'empêche pas l'action de réussir) |
| **Sentry × 3** | Errors temps réel — projets `niqo-mobile` · `niqo-edge` · `niqo-admin` | SDK officiel sur chaque surface, `Sentry.captureException` dans tous les catch | Si Sentry down → captureException silencieux, app continue |
| **Expo Push** | Notifs iOS (APNs auto) + Android (FCM Phase 2) | Edge `send-push-notification` → API Expo | Si push fail → fallback log `niqo_event_log`, retry cron 5 min |

### 6.1 Vérification de webhook — exemple PawaPay

```ts
// supabase/functions/pawapay-webhook/index.ts (extrait simplifié)
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

async function verifyHmac(rawBody: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get("PAWAPAY_WEBHOOK_SECRET")!;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(rawBody));
}

serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("X-PawaPay-Signature");
  if (!signature || !await verifyHmac(rawBody, signature)) {
    return new Response("invalid signature", { status: 401 });
  }
  // ... process payload
});
```

Pas de comparaison string naïve (timing attack) — `crypto.subtle.verify` est constant-time.

---

## 7. Organisation du code mobile — patterns

### 7.1 Découpage en 4 niveaux

```
app/                    Niveau 1 — Routes (file-based)
   └── un fichier = un écran, contient le screen-level state + composition

components/             Niveau 2 — Composants UI
   ├── ui/              Atomiques : Button, Input, Card, AuthGate, Modal
   ├── chat/            Feature-specific (RDV banner, message bubble, etc.)
   ├── home/            Feature-specific (AnnounceCard, FeedSkeleton)
   ├── sell/            Wizard 5 steps
   ├── payment/         Mobile Money flow
   ├── verification/    KYC F07
   ├── notation/        Stars + commentaire
   └── blocking/        F15 BlockUserSheet

lib/                    Niveau 3 — Logique métier
   ├── supabase.ts      Client unique + types
   ├── auth/            Provider + errors + password
   ├── annonces.ts      CRUD annonces, queries feed
   ├── rdv.ts           Propose/confirm/cancel RDV
   ├── notation.ts      Submit avis + queries notes
   ├── messages.ts      Realtime + send + mark read
   ├── verification.ts  KYC upload + status polling
   ├── boost.ts         Init paiement + poll status
   ├── blocking.ts      Block/unblock + queries
   ├── moderation.ts    Call moderate-text edge
   ├── push.ts          Permission + register token
   ├── hooks/           React hooks (useAuth, useBlockedUsers, useUnread)
   └── storage/         Upload helpers (compression image avant upload)

scripts/                Niveau 4 — Tooling (build, deploy, patch)
```

### 7.2 Règle — logique métier hors composants

Un composant **n'a pas le droit** d'appeler `supabase` directement. Il appelle une fonction de `lib/` qui encapsule :
- Mapping erreur Postgres → erreur métier typée
- Logging Sentry breadcrumbs
- Conversion `snake_case` DB → `camelCase` JS si nécessaire

Bénéfice : les tests d'intégration ([tests/integration/](../tests/integration/)) testent `lib/`, pas les écrans. Et les écrans sont mockables trivialement.

### 7.3 Imports absolus `@/`

```ts
// ✅ Bon
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";

// ❌ Mauvais
import { supabase } from "../../../lib/supabase";
```

Configuré dans [tsconfig.json](../tsconfig.json) :

```jsonc
{
  "compilerOptions": {
    "paths": { "@/*": ["./*"] }
  }
}
```

### 7.4 Pattern d'écran type

```tsx
// app/announce/[id].tsx (squelette type d'un écran qui charge des données)
export default function AnnounceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [annonce, setAnnonce] = useState<Annonce | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchAnnonce(id)
      .then((a) => mounted && setAnnonce(a))
      .catch((e) => mounted && setError(e))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [id]);

  if (loading) return <AnnounceDetailSkeleton />;
  if (error) return <ErrorState onRetry={() => /* refetch */} />;
  if (!annonce) return <NotFoundState />;

  return <AnnounceDetailContent annonce={annonce} />;
}
```

**3 états obligatoires** sur tout écran qui charge : `loading` · `error` · `empty/not-found`. C'est dans les conventions de code [CLAUDE.md §Conventions](../CLAUDE.md).

---

## 8. Patterns d'implémentation transverses

### 8.1 Auth provider — context unique

```tsx
// lib/auth/AuthProvider.tsx (extrait)
type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: PublicUser };

export const AuthContext = createContext<AuthState>({ status: "loading" });

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    // 1. Boot — récupère session persistée
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return setState({ status: "anonymous" });
      const profile = await fetchProfile(data.session.user.id);
      setState({ status: "authenticated", user: profile });
    });

    // 2. Listen aux events Supabase (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED)
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT" || !session) return setState({ status: "anonymous" });
      const profile = await fetchProfile(session.user.id);
      setState({ status: "authenticated", user: profile });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
```

Toute lecture de l'user passe par `useAuth()` (hook custom dans [lib/hooks/](../lib/hooks/)) — pas de `supabase.auth.getUser()` éparpillé dans 12 composants.

### 8.2 Réseau instable — `withTimeout`

```ts
// lib/supabase.ts:78-89
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    }),
  ]);
}

export const AUTH_TIMEOUT_MS = 15_000;

// Usage dans lib/auth/AuthProvider.tsx
const result = await withTimeout(
  supabase.auth.signInWithOAuth({ provider: "google" }),
  AUTH_TIMEOUT_MS,
  "signInWithOAuth"
);
```

Pourquoi : sur 4G CI/CG, Supabase peut hang silencieusement. 15s = "trust the user's patience but cap it". Sans timeout, l'écran d'auth reste loading indéfiniment.

### 8.3 Pending actions queue — UX après auth gate

```ts
// lib/pendingActions.ts (squelette)
type PendingAction =
  | { type: "favorite"; annonceId: string }
  | { type: "contact"; annonceId: string; vendeurId: string }
  | { type: "signaler"; targetType: "annonce" | "user"; targetId: string };

export async function enqueuePendingAction(action: PendingAction) {
  await AsyncStorage.setItem("niqo_pending_action", JSON.stringify(action));
}

export async function consumePendingAction(): Promise<PendingAction | null> {
  const raw = await AsyncStorage.getItem("niqo_pending_action");
  if (!raw) return null;
  await AsyncStorage.removeItem("niqo_pending_action");
  return JSON.parse(raw);
}
```

Flux : user clique "Contacter" → `enqueuePendingAction({ type: "contact", ... })` → AuthGate ouvre login → après auth success → `AuthProvider` détecte SIGNED_IN → `consumePendingAction()` → ouvre la conv. Sans cette queue, l'user perd son contexte après auth.

### 8.4 Cascades RGPD côté DB

Pattern de suppression compte (mig 73, RPC `delete_my_account`) :

```sql
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- auth.users delete cascade vers public.users via FK ON DELETE CASCADE,
  -- qui cascade ensuite vers annonces, messages, rdvs, avis, paiements,
  -- favorites, signalements, blocked_users.
  DELETE FROM auth.users WHERE id = v_me;
END $$;
```

Côté mobile [lib/supabase.ts:249-262](../lib/supabase.ts#L249-L262) : on purge **d'abord** les 3 buckets Storage (le trigger DB ne peut pas le faire, Supabase a un `protect_delete` qui bloque les `DELETE FROM storage.objects` en SQL), **puis** on appelle la RPC. Si le storage cleanup throw, on abort le delete : mieux vaut un compte vivant que des PII orphelines sur le CDN.

---

## 9. Implémentation par feature — extraits clés

| Feature | Fichiers front | Migrations / RPCs | Edge Functions | Pattern saillant |
|---|---|---|---|---|
| **F01 Auth** | `app/auth/*` · `lib/auth/AuthProvider.tsx` · `lib/supabase.ts` | mig 01-04 · `handle_new_user` trigger · `complete_my_profile` · `delete_my_account` | `send-welcome-email` | OAuth PKCE + SecureStore + telephone Vault |
| **F02 Annonce** | `app/sell.tsx` · `components/sell/*` · `lib/annonces.ts` | mig 05-12 · `create_annonce` · `delete_annonce_with_cleanup` | `moderate-text` · `moderate-image` | Wizard 5 steps + upload Storage paralléle + modération synchrone |
| **F03 Recherche** | `app/search.tsx` · `lib/annonces.ts` | Index trigram sur `titre` + index BTREE `(pays, statut, expire_le)` | — | Debounce 300ms côté front + cursor pagination |
| **F04 Chat** | `app/messages/[id].tsx` · `lib/messages.ts` | mig 21-30 · trigger `fn_notify_new_message` · trigger `fn_messages_block_check` · trigger `fn_moderate_message` | `moderate-message` (async via pg_net) · `send-push-notification` | Realtime WS + mots interdits DB + modération async + sons + groupement |
| **F05 RDV** | `components/chat/RdvBanner.tsx` · `lib/rdv.ts` | mig 35-36 · `propose_rdv` · `confirm_rdv` · `cancel_rdv` | — | Modèle Proposer→Confirmer, 4 états chat banner, anti-fraude rétroactif |
| **F06 Notation** | `components/notation/*` · `lib/notation.ts` | mig 37-38, 42, 70 · `submit_avis` · trigger `fn_update_user_notes` · cron auto 3/5 après 7j | — | Note auto si pas de réponse + symétrie ach↔ven |
| **F07 KYC** | `components/verification/*` · `lib/verification.ts` | mig 43-55, 72-75 · `init_verification` · `approve_verification` · bucket privé `cni-verifications` policy admin-only | `pawapay-init-deposit` · `pawapay-webhook` · `send-admin-notification` · `send-payment-confirmation` | Upload CNI + selfie + paiement 1000 FCFA + email Resend admin |
| **F08 Signalement** | `components/ui/ReportButton.tsx` · `lib/signalements.ts` | mig 56-57 · `create_signalement` · trigger `fn_auto_suspend_at_3` | `send-admin-notification` | Auto-suspend `is_active=false` à 3 signalements confirmés/30j |
| **F09 Boost** | `components/payment/*` · `lib/boost.ts` | mig 60-63 · `init_boost` · `confirm_boost_payment` · `fn_scrub_pawapay_metadata` (cron 90j RGPD) | `pawapay-init-deposit` · `pawapay-webhook` | Paiement PawaPay + badge Sponsorisé + tri prioritaire |
| **F10 Push** | `lib/push.ts` · `components/ui/PushNotificationGate.tsx` | mig 64-68 · table `device_tokens` · 10 triggers métier → pg_net → edge | `send-push-notification` | Token Expo registered au boot + 10 events business |
| **F11 Expiration** | — (cron pur) | mig 69 · cron daily `expire_old_annonces` | — | 60j + bouton prolongation 28j côté front |
| **F12 Dashboard** | `app/profile/dashboard.tsx` · `lib/dashboard.ts` | mig 58, 61 · `get_my_dashboard_stats` | — | RPC unique qui agrège vues/contacts/RDV/boosts/notes |
| **F13 Admin web** | `landing/src/app/admin/*` | mig 78-80 · `get_admin_kpis` · `get_admin_kpis_filtered(mois, annee)` | — | Next.js 16 RSC + Server Actions + Recharts |
| **F14 Support web** | `landing/src/app/support/page.tsx` | — | — | Required par Apple — 5 contacts email + 6 FAQ |
| **F15 Block** | `components/blocking/BlockUserSheet.tsx` · `app/profile/blocked-users.tsx` · `lib/blocking.ts` · `lib/hooks/useBlockedUsers.ts` | mig 129-132 · table `blocked_users` · 5 RPCs · trigger `fn_messages_block_check` · cascade signalement | — | Owner-scoped RLS + trigger anti-bypass + filter feed côté client |

Détail backend par module : voir [docs/backend/*.md](./backend/) (1 fichier par module avec inventaire tables + RPCs + triggers + RLS + crons + storage).

---

## 10. Sécurité — patterns d'implémentation transverses

> Bloc 1 RNCP — synthèse rapide. Détail RGPD : [docs/references/rgpd-audit.md](./references/rgpd-audit.md). Détail tests sécurité : [tests-et-deploiement.md §Sécurité](./tests-et-deploiement.md).

### 10.1 Stockage des secrets

| Niveau | Mécanisme | Exemple |
|---|---|---|
| Client mobile | SecureStore (Keychain iOS, Keystore Android, AES hardware) | Session Supabase (refresh_token) |
| Client mobile | `EXPO_PUBLIC_*` env vars (publiques par design) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Edge Function | Deno `Deno.env.get(...)` (secrets Supabase Dashboard) | `OPENAI_API_KEY`, `PAWAPAY_WEBHOOK_SECRET`, `RESEND_API_KEY` |
| DB | Supabase Vault (chiffrement applicatif) | `users.telephone` (bytea chiffré, accessible via RPC `get_my_phone`) |
| Admin web | Vercel env vars (chiffrées at-rest) | Service role pour les Server Actions |

**Jamais** committer la `service_role` key (bypass RLS). Le projet `.env.local` est gitignored, mais l'historique git est inspecté avant chaque push (cf. [docs/gotchas.md](./gotchas.md)).

### 10.2 RLS = défense en profondeur

Toutes les tables ont RLS + un test pgTAP qui vérifie qu'un user A ne peut pas accéder aux données de B. Exemple — `tests/sql/blocking.test.sql` :

```sql
SELECT plan(17);

-- Setup : 2 users Alice + Bob
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alice@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.com');

-- Alice bloque Bob
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT public.block_user('22222222-2222-2222-2222-222222222222');

-- Bob ne doit PAS pouvoir voir qui l'a bloqué
SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
SELECT is_empty(
  $$ SELECT * FROM public.blocked_users WHERE blocked_id = '22222222-2222-2222-2222-222222222222' $$,
  'Bob does not see who blocked him'
);
```

### 10.3 OWASP — couverture

| OWASP Top 10 (2021) | Niqo |
|---|---|
| **A01 Broken Access Control** | RLS sur 100% des tables + tests pgTAP par module |
| **A02 Cryptographic Failures** | TLS partout (Vercel + Supabase managé) · `users.telephone` Vault · session SecureStore |
| **A03 Injection** | Pas d'ORM dynamique : RPCs en SQL paramétré · pas de `string interpolation` SQL côté Edge Functions |
| **A04 Insecure Design** | Pattern "browse-first + auth gate" plutôt que "login d'abord" (moins d'incentive à créer faux comptes) |
| **A05 Security Misconfiguration** | Tous les buckets Storage en privé sauf `avatars` (policy SELECT public, INSERT owner) ; check pré-prod |
| **A06 Vulnerable Components** | `npm audit` mensuel · Dependabot configuré sur GitHub · CDC v5.0 §10 lock |
| **A07 Identification & Auth** | OAuth Google/Apple (PKCE) · password Email avec rate-limit Supabase · pas de reset password par SMS |
| **A08 Software & Data Integrity** | EAS Build = binaires signés Apple/Google · webhooks signés HMAC SHA-256 |
| **A09 Logging & Monitoring** | Sentry × 3 + `niqo_event_log` (mig 106-107) + alertes digest Resend |
| **A10 SSRF** | Pas de fetch arbitraire côté server (les Edge Functions appellent des URLs hardcodées : openai, rekognition, pawapay, resend) |

### 10.4 Audit `/cso` (2026-05-10)

Audit interne sécurité lancé via skill `/cso` qui a remonté 3 issues :

1. **Open redirect login** — `/auth/callback?redirect=...` acceptait n'importe quelle URL. **Fix** : whitelist `redirect` à `/^\/(?!\/)/` (path-relative only).
2. **RLS mots_interdits** — table publique en lecture, exposait la stratégie de modération. **Fix mig 105** : RLS `SELECT TO authenticated WHERE is_admin OR FALSE`.
3. **CI SHA-pin manquant** — `actions/checkout@v4` épinglé au tag mutable. **Fix** : épinglage SHA-256 dans `.github/workflows/*.yml`.

Détail : [tests-et-deploiement.md §Sécurité](./tests-et-deploiement.md).

---

## 11. Performance et accessibilité

### 11.1 Devices baseline

Tecno Spark 8C et Itel A56 — devices entry-level très répandus en CI/CG (RAM 2-3GB, écran 720x1600). Toute optim part de ces specs.

| Optim | Impact |
|---|---|
| `expo-image` avec cache disk + AVIF/WebP | Photos annonces chargent ~3× plus vite que `<Image>` natif |
| Compression image pré-upload via `expo-image-manipulator` (max 1920px, JPEG 80%) | Photo 5MB → ~400KB, upload 4G fiable |
| Cursor pagination Supabase (pas d'`OFFSET`) | Feed scroll infini constant en O(1) par page |
| `useMemo` sur les listes filtrées du chat | Évite re-render des 50+ messages à chaque keystroke |
| `<FlashList>` (Shopify) plutôt que `<FlatList>` sur le feed | Recycling optimisé pour scrolling long |
| Hermes JIT activé par défaut | Cold start ~1.2s sur Spark 8C |
| Police Inter `400/600` uniquement chargée (pas tout le family) | Bundle font 60KB vs 400KB |

### 11.2 Accessibilité

- Touch targets **44×44 px minimum** ([CLAUDE.md §Conventions](../CLAUDE.md))
- Contraste WCAG AA garanti par le design system ([docs/design-system.md](./design-system.md))
- `accessibilityLabel` sur les boutons icon-only (lucide-react-native)
- `accessibilityRole="button"` sur les pressables custom
- `<TextInput accessibilityHint>` sur les inputs ambigus du wizard sell

### 11.3 Offline et réseau intermittent

- Tous les flows critiques (signup, post annonce, send message) ont un état `error` + bouton `Réessayer`
- `pendingActions` queue persiste l'action si l'app crash entre login et action
- Auth `withTimeout(15s)` empêche le hang silencieux
- Images annonces cachées disque par `expo-image` → 2e visite offline ok pour les annonces vues

---

## 12. Mapping aux compétences RNCP CDA

### Bloc 1 — Développer une application sécurisée

| Compétence | Section / artefact |
|---|---|
| C1.1 Mettre en œuvre des environnements de dev | §3, §4, §5 (Expo + Supabase local + Next.js) |
| C1.2 Versionner avec gestionnaire SCM | git/GitHub, 132 migrations linéaires, `docs/migrations/INDEX.md` |
| C1.3 Développer des interfaces utilisateur | §3.2-§3.4, §7 (Expo Router + NativeWind + design system) |
| C1.4 Composants d'accès aux données | §4.2-§4.4 (RLS + RPCs + PostgREST), §7.2 (lib/ encapsule) |
| C1.5 Sécurité du dev | §10 entier (RLS, Vault, HMAC, OWASP, /cso audit) |
| C1.6 Déployer une application | → [tests-et-deploiement.md](./tests-et-deploiement.md) |

### Bloc 2 — Concevoir et développer une application multi-couches répartie

| Compétence | Section / artefact |
|---|---|
| C2.1 Analyser le besoin | → [CDC v5.0](./CAHIER_DES_CHARGES.md) §1-§4 |
| C2.2 Modéliser UML | → [methodologie-uml.md](./methodologie-uml.md) |
| C2.3 Concevoir BDD | §4.1-§4.2 + [docs/backend/*.md](./backend/) (1 doc par module avec inventaire tables/RPCs/triggers) |
| C2.4 Mettre en œuvre BDD | 132 migrations idempotentes + pgTAP |
| C2.5 Développer composants métier | §4.3-§4.4 (RPCs + triggers SQL), §6 (Edge Functions Deno), §7 (lib/ mobile) |
| C2.6 Multi-couches | §2 (3-tiers répartis + services tiers), §5 (RSC Next.js), §4.6 (Realtime) |

---

## 13. Choix techniques et limites assumées

### 13.1 Pourquoi pas...

| Alternative | Raison du rejet |
|---|---|
| **Flutter** | Écosystème natif RN plus mature pour Expo Push + RGPD (les SDK Sentry/Resend ont des binding RN officiels) |
| **GraphQL** | PostgREST suffit (auto-généré depuis le schéma SQL) + Realtime fait le push. Pas de besoin de query batching côté front. |
| **Prisma / Drizzle** | Couche d'indirection qui masquerait les triggers et RLS. Sur Niqo, le SQL natif est lisible et auditable directement. |
| **Vercel Postgres / Neon** | Supabase est le seul à offrir Auth + Storage + Realtime + Functions + RLS dans un seul SaaS managé à ce prix |
| **Firebase Auth + FCM** | Coût lock-in Google + RGPD CNIL (données utilisateurs hors UE) ; Supabase Auth = Postgres (audit local possible) |
| **App native iOS Swift + Android Kotlin** | 2 codebases pour 1 dev mobile = pas viable Phase 1 |
| **Stripe** | PawaPay couvre Mobile Money (MTN, Orange, Airtel, Wave) — Stripe ne couvre pas l'Afrique francophone subsaharienne en C2C |

### 13.2 Dette assumée

| Item | Plan |
|---|---|
| Sentry mobile désactivé temporaire | Restaurer post-launch (task #18) — manque `SENTRY_AUTH_TOKEN` sur EAS |
| FCM (push Android prod) non configuré | Phase 2 (currently push iOS uniquement via APNs auto) |
| Pas de tests unitaires Jest sur composants UI | Délibéré — coverage UI via tests manuels documentés ([docs/features/*-tests.md](./features/)) + Vitest sur lib/ |
| Pas de CDN images custom (Cloudinary…) | Supabase Storage CDN suffit Phase 1, à reconsidérer Phase 2 si bandwidth coûts dépassent 50€/mois |
| Distribution UE bloquée | DSA Trader info à compléter (task #40 Phase 2) |
| Audit avocat pack légal v1.1 en cours | Externe, ~2-3 semaines en parallèle |

---

## 14. Ressources et navigation

- **Spec produit** — [CAHIER_DES_CHARGES.md](./CAHIER_DES_CHARGES.md) (v5.0)
- **Modélisation UML** — [methodologie-uml.md](./methodologie-uml.md)
- **Tests & déploiement** — [tests-et-deploiement.md](./tests-et-deploiement.md)
- **Design system humain** — [design-system.md](./design-system.md)
- **Backend par module** — [docs/backend/](./backend/)
- **Inventaire migrations** — [docs/migrations/INDEX.md](./migrations/INDEX.md)
- **Audit RGPD** — [docs/references/rgpd-audit.md](./references/rgpd-audit.md)
- **Gotchas** — [docs/gotchas.md](./gotchas.md)
- **Checklist pré-prod** — [docs/pre-production-checklist.md](./pre-production-checklist.md)
- **App live** — https://apps.apple.com/app/niqo-annonces-afrique/id6769410032

---

*Document préparé pour le dossier RNCP CDA. Auteur : Dominique Huang. Niqo LTD (Rwanda, TIN 150644832).*
