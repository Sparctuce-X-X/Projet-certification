// Edge Function — pawapay-init-deposit
//
// Initie un paiement Mobile Money via PawaPay v2 (sandbox ou prod).
// Crée la row paiements_niqo en service_role (bypass RLS strict mig 43).
//
// **Mode mock activable** via env var `PAWAPAY_MOCK=true` :
//   - Insert la row directement avec statut='completed' (skip pending)
//   - Pas d'appel PawaPay réel
//   - Permet de tester le flow client end-to-end sans dépendre du sandbox
//   - **À désactiver en prod** (PAWAPAY_MOCK=false ou unset)
//
// Mode réel (PAWAPAY_MOCK !== "true") :
//   - Insert row pending
//   - POST PawaPay /v2/deposits avec deposit_id généré
//   - L'user paie sur son MMO, le webhook PawaPay update statut → completed
//
// Auth : JWT user passé via Authorization header (auto par client.functions.invoke).
// On vérifie l'user existe et qu'il appartient à lui-même (pas de spoofing).
//
// Déploiement :
//   supabase functions deploy pawapay-init-deposit
//   supabase secrets set PAWAPAY_MOCK=true                  # mode mock
//   supabase secrets set PAWAPAY_API_KEY=xxxxxxxx           # mode réel
//   supabase secrets set PAWAPAY_API_URL=https://api.sandbox.pawapay.cloud  # mode réel

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException, captureMessage } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PAWAPAY_MOCK = Deno.env.get("PAWAPAY_MOCK") === "true";
const PAWAPAY_API_KEY = Deno.env.get("PAWAPAY_API_KEY");
const PAWAPAY_API_URL =
  Deno.env.get("PAWAPAY_API_URL") ?? "https://api.sandbox.pawapay.cloud";

interface InitDepositRequest {
  type: "verification" | "boost" | "pro_subscription" | "vedette" | "unsuspend";
  montant_fcfa: number;
  phone_number: string; // E.164 format
  /** Provider MMO sélectionné par l'user (whitelisté côté serveur par pays) */
  mmo_provider: "ORANGE_CIV" | "MTN_MOMO_CIV" | "AIRTEL_COG" | "MTN_MOMO_COG";
  target_id?: string;
  /** Version CGV acceptée — trace légale renonciation droit rétractation 14j (format "N.M") */
  cgv_accepted_version: string;
}

/** Whitelist providers par pays — anti-spoofing (un user CI ne peut pas
 *  envoyer un provider CG, ou inversement). */
const PROVIDERS_BY_COUNTRY: Record<string, string[]> = {
  CI: ["ORANGE_CIV", "MTN_MOMO_CIV"],
  CG: ["AIRTEL_COG", "MTN_MOMO_COG"],
};

interface InitDepositResponse {
  paiementId: string;
  depositId: string;
  statut: "pending" | "completed" | "failed";
  paymentInstructions?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonError("METHOD_NOT_ALLOWED", 405);
  }

  // ── Auth user ────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonError("AUTH_REQUIRED", 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return jsonError("AUTH_INVALID", 401);

  // ── Parse + validation ──────────────────────────────────────────────────
  let body: InitDepositRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  if (
    !body.type ||
    !body.montant_fcfa ||
    !body.phone_number ||
    !body.mmo_provider ||
    body.montant_fcfa <= 0 ||
    body.montant_fcfa > 100_000
  ) {
    return jsonError("INVALID_PAYLOAD", 400);
  }

  if (!/^\+[0-9]{8,15}$/.test(body.phone_number)) {
    return jsonError("INVALID_PHONE_FORMAT", 400);
  }

  // ── Whitelist montant_fcfa par type — single source of truth des prix ──
  // Mirror du tarif côté DB (mig 63 RPC apply_boost) + lib/boost.ts.
  // Si la business price change, fix les 3 endroits ensemble.
  const ALLOWED_PRICES: Record<string, number[]> = {
    verification: [1000],
    boost: [1000, 3000],
    pro_subscription: [5000],
    vedette: [5000],
    unsuspend: [1000],
  };
  const allowed = ALLOWED_PRICES[body.type];
  if (!allowed || !allowed.includes(body.montant_fcfa)) {
    return jsonError("INVALID_PRICE_FOR_TYPE", 400);
  }

  // ── Consentement CGV obligatoire (droit rétractation 14j — Code Conso CI/CG) ─
  const cgv_accepted_version = body.cgv_accepted_version;
  if (!cgv_accepted_version || typeof cgv_accepted_version !== "string" || !cgv_accepted_version.match(/^\d+\.\d+$/)) {
    return jsonError("MISSING_CGV_CONSENT", 400, "L'acceptation des CGV est requise (format vX.Y)");
  }

  // ── target_id obligatoire pour les types qui ciblent une entité ────────
  // Pour 'boost', target_id = annonce_id (sinon le RPC apply_boost ne peut
  // pas vérifier que le paiement correspond à la bonne annonce, cf mig 63).
  if (body.type === "boost" && !body.target_id) {
    return jsonError("TARGET_ID_REQUIRED", 400);
  }

  // ── Service role client (bypass RLS pour insert paiements_niqo) ─────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // PawaPay v2 exige un depositId de 36 chars exactement (UUID v4 standard).
  // Pas de préfixe possible.
  const depositId = crypto.randomUUID();

  // ── MODE MOCK : insert completed direct ────────────────────────────────
  if (PAWAPAY_MOCK) {
    const { data: paiement, error } = await adminClient
      .from("paiements_niqo")
      .insert({
        user_id: user.id,
        type: body.type,
        target_id: body.target_id ?? null,
        montant_fcfa: body.montant_fcfa,
        statut: "completed",
        completed_at: new Date().toISOString(),
        pawapay_deposit_id: depositId,
        pawapay_metadata: {
          mock: true,
          phone: body.phone_number,
          ts: Date.now(),
        },
        cgv_accepted_version: cgv_accepted_version,
        cgv_accepted_at: new Date().toISOString(),
      })
      .select("id, pawapay_deposit_id, statut")
      .single();

    if (error) {
      console.error("[pawapay-init-deposit][mock] insert error", error);
      captureException(error, {
        tags: { step: "mock-insert", paiement_type: body.type },
        user: { id: user.id },
      }, "pawapay-init-deposit");
      return jsonError(error.message, 500);
    }

    logEvent(adminClient, "pawapay-init-deposit", "deposit.mock_completed", "info", {
      paiement_type: body.type,
      montant_fcfa: body.montant_fcfa,
      provider: body.mmo_provider,
    }, user.id);

    const response: InitDepositResponse = {
      paiementId: paiement.id,
      depositId: paiement.pawapay_deposit_id!,
      statut: paiement.statut as "completed",
      paymentInstructions: "Mode développement — paiement simulé instantané.",
    };
    return jsonOk(response);
  }

  // ── MODE RÉEL : insert pending + appel PawaPay ─────────────────────────
  if (!PAWAPAY_API_KEY) {
    console.error(
      "[pawapay-init-deposit] PAWAPAY_API_KEY missing (mode réel actif)"
    );
    captureMessage(
      "PAWAPAY_API_KEY missing in non-mock mode",
      { level: "error", tags: { step: "config" } },
      "pawapay-init-deposit",
    );
    return jsonError("PAWAPAY_NOT_CONFIGURED", 503);
  }

  // Récupérer le pays pour determiner currency + provider par défaut.
  // CI = XOF + Orange Money (provider le plus courant en Côte d'Ivoire)
  // CG = XAF + Airtel Money (le plus courant au Congo Brazzaville)
  const { data: userProfile } = await adminClient
    .from("users")
    .select("pays")
    .eq("id", user.id)
    .maybeSingle();

  // Currency selon pays user. Provider vient du body (sélecteur UI Step 5).
  // Whitelist anti-spoofing : un user CI ne peut pas envoyer un provider CG.
  const pays = userProfile?.pays ?? "CI";
  const currency = pays === "CG" ? "XAF" : "XOF";

  const allowedProviders = PROVIDERS_BY_COUNTRY[pays] ?? [];
  if (!allowedProviders.includes(body.mmo_provider)) {
    return jsonError("INVALID_PROVIDER_FOR_COUNTRY", 400);
  }
  const provider = body.mmo_provider;

  // 1. Insert paiement pending
  const { data: paiement, error: insertErr } = await adminClient
    .from("paiements_niqo")
    .insert({
      user_id: user.id,
      type: body.type,
      target_id: body.target_id ?? null,
      montant_fcfa: body.montant_fcfa,
      statut: "pending",
      pawapay_deposit_id: depositId,
      pawapay_metadata: {
        phone: body.phone_number,
        currency,
        provider: provider,
      },
      cgv_accepted_version: cgv_accepted_version,
      cgv_accepted_at: new Date().toISOString(),
    })
    .select("id, pawapay_deposit_id")
    .single();

  if (insertErr) {
    console.error("[pawapay-init-deposit] insert error", insertErr);
    captureException(insertErr, {
      tags: { step: "real-insert-pending", paiement_type: body.type },
      user: { id: user.id },
    }, "pawapay-init-deposit");
    return jsonError(insertErr.message, 500);
  }

  // 2. POST PawaPay /v2/deposits
  // Doc : https://docs.pawapay.io/v2/deposits
  try {
    const pawapayRes = await fetch(`${PAWAPAY_API_URL}/v2/deposits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAWAPAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        depositId: paiement.pawapay_deposit_id,
        amount: body.montant_fcfa.toString(),
        currency,
        payer: {
          type: "MMO",
          accountDetails: {
            phoneNumber: body.phone_number.replace("+", ""),
            provider: provider,
          },
        },
        // PawaPay exige alphanumeric + espaces uniquement (pas de ponctuation)
        customerMessage: `Niqo ${body.type}`,
        // Pas de metadata — le format PawaPay v2 diffère de la doc v1.
        // Le mapping deposit_id ↔ paiement.id se fait via pawapay_deposit_id en DB.
      }),
    });

    const pawapayData = await pawapayRes.json();

    // Log complet pour debug — on saura exactement ce que PawaPay répond
    console.log(
      "[pawapay-init-deposit] PawaPay sync response",
      JSON.stringify({
        httpStatus: pawapayRes.status,
        body: pawapayData,
      })
    );

    // PawaPay peut retourner HTTP 200 avec status REJECTED (validation soft)
    // → on traite ça comme un échec, pas un succès.
    if (
      !pawapayRes.ok ||
      pawapayData.status === "REJECTED" ||
      pawapayData.status === "FAILED"
    ) {
      await adminClient
        .from("paiements_niqo")
        .update({ statut: "failed", pawapay_metadata: pawapayData })
        .eq("id", paiement.id);
      console.error("[pawapay-init-deposit] PawaPay rejected", pawapayData);
      captureMessage(
        `PawaPay deposit rejected: ${pawapayData?.status ?? "unknown"}`,
        {
          level: "warning",
          tags: { step: "pawapay-rejected", paiement_type: body.type },
          extra: { pawapay_response: pawapayData, http_status: pawapayRes.status },
          user: { id: user.id },
        },
        "pawapay-init-deposit",
      );
      logEvent(adminClient, "pawapay-init-deposit", "deposit.rejected", "warning", {
        paiement_type: body.type,
        montant_fcfa: body.montant_fcfa,
        pawapay_status: pawapayData?.status ?? "unknown",
        http_status: pawapayRes.status,
      }, user.id);
      return jsonError(
        pawapayData.failureReason?.failureMessage ??
          pawapayData.errorMessage ??
          "PAWAPAY_INIT_FAILED",
        502
      );
    }

    // DUPLICATE_IGNORED : depositId déjà soumis. Ne crée pas de nouveau,
    // retourne le pending courant pour que le client poll dessus.
    if (pawapayData.status === "DUPLICATE_IGNORED") {
      console.warn(
        "[pawapay-init-deposit] Duplicate deposit, returning existing"
      );
    }

    // Cas nominal : ACCEPTED (paiement en cours, attente webhook)
    logEvent(adminClient, "pawapay-init-deposit", "deposit.pending", "info", {
      paiement_type: body.type,
      montant_fcfa: body.montant_fcfa,
      provider: provider,
      pawapay_status: pawapayData?.status ?? "ACCEPTED",
    }, user.id);

    const response: InitDepositResponse = {
      paiementId: paiement.id,
      depositId: paiement.pawapay_deposit_id!,
      statut: "pending",
      paymentInstructions:
        "Confirme la transaction sur ton téléphone. Tu vas recevoir une notification de ton opérateur Mobile Money.",
    };
    return jsonOk(response);
  } catch (e) {
    console.error("[pawapay-init-deposit] PawaPay fetch threw", e);
    captureException(e, {
      tags: { step: "pawapay-fetch", paiement_type: body.type },
      user: { id: user.id },
    }, "pawapay-init-deposit");
    logEvent(adminClient, "pawapay-init-deposit", "deposit.fetch_failed", "error", {
      paiement_type: body.type,
      montant_fcfa: body.montant_fcfa,
      message: (e as Error).message ?? "unknown",
    }, user.id);
    await adminClient
      .from("paiements_niqo")
      .update({ statut: "failed" })
      .eq("id", paiement.id);
    return jsonError("PAWAPAY_NETWORK_ERROR", 502);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonOk<T>(data: T): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function jsonError(code: string, status: number, detail?: string): Response {
  return new Response(JSON.stringify({ error: code, ...(detail ? { detail } : {}) }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
