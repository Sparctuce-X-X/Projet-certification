// Edge Function — pawapay-webhook
//
// Reçoit les callbacks PawaPay v2 (statut paiement deposit final).
// Update paiements_niqo.statut → completed | failed selon le payload.
//
// **Sécurité** :
//
//   1. Vérification du callback (Option B — double-check via API) :
//      PawaPay v2 utilise des signatures RFC-9421 (ECDSA P-256/P-384,
//      RSA-PSS SHA-512, RSA-PKCS1-v1_5 SHA-256) — voir docs.pawapay.io/v2/docs/signatures.
//      Implémenter RFC-9421 proprement en Deno = ~200 lignes + lib externe.
//      Pour MVP, on utilise une stratégie defense-in-depth alternative :
//      à chaque callback, on appelle GET /v2/deposits/{depositId} avec
//      notre PAWAPAY_API_KEY (Bearer auth, secret côté serveur).
//      Un attaquant ne peut pas forger une réponse de l'API officielle
//      PawaPay (TLS + DNS + cert chain). Si le statut renvoyé par l'API
//      matche le payload du callback → on accepte. Sinon → on ignore.
//
//      ⚠ TODO Phase 2 prod : implémenter RFC-9421 avec lib Deno
//      (ou WebCrypto natif) + activer signed callbacks dans Dashboard
//      PawaPay (Settings → API tokens → Signed callbacks). Defense en
//      profondeur double.
//
//   2. Idempotence + anti-replay :
//      - Un paiement en statut terminal (`completed` ou `failed`) ne peut
//        PAS être rétrogradé. Évite qu'un webhook FAILED reçu en désordre
//        après un COMPLETED ne casse un paiement valide.
//      - Un webhook qui réaffirme l'état actuel (idem statut) est no-op.
//
//   3. Logs prod-safe :
//      - On ne log PAS le payload complet (peut contenir des metadata sensibles).
//      - Seulement depositId + status + transition.
//
// **Mode mock côté init-deposit (PAWAPAY_MOCK=true)** : ce webhook n'est
// JAMAIS appelé (l'init insert direct en completed). Cette fonction sert
// uniquement au mode réel sandbox/prod PawaPay.
//
// Déploiement : config.toml → verify_jwt = false (PawaPay appelle sans JWT).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException, captureMessage } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAWAPAY_API_URL = Deno.env.get("PAWAPAY_API_URL") ?? "";
const PAWAPAY_API_KEY = Deno.env.get("PAWAPAY_API_KEY") ?? "";

// Format payload PawaPay v2 (https://docs.pawapay.io/v2/api-reference/deposits/deposit-callback)
// Le payload contient EXACTEMENT UN des 3 IDs : depositId, payoutId, refundId.
// Niqo n'utilise que les deposits — payouts/refunds sont ignorés silencieusement
// (mais on doit retourner 200 sinon PawaPay retry indéfiniment).
interface PawaPayWebhookPayload {
  depositId?: string;
  payoutId?: string;
  refundId?: string;
  status: "ACCEPTED" | "COMPLETED" | "FAILED" | "REJECTED" | "PROCESSING";
  amount?: string;
  currency?: string;
  failureReason?: { failureCode: string; failureMessage: string };
  metadata?: Array<{ fieldName: string; fieldValue: string }>;
  created?: string;
  receivedByPayer?: string;
}

// Format réponse GET /v2/deposits/{depositId}
// Statuts API : ACCEPTED, PROCESSING, IN_RECONCILIATION, COMPLETED (final), FAILED (final)
interface DepositStatusResponse {
  status: "FOUND" | "NOT_FOUND";
  data?: {
    depositId: string;
    status:
      | "ACCEPTED"
      | "PROCESSING"
      | "IN_RECONCILIATION"
      | "COMPLETED"
      | "FAILED";
    amount?: string;
    currency?: string;
    failureReason?: { failureCode: string; failureMessage: string };
  };
}

type PaiementStatut = "pending" | "completed" | "failed";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!PAWAPAY_API_KEY) {
    console.error(
      "[pawapay-webhook] PAWAPAY_API_KEY not configured — cannot verify callbacks. " +
        "Set it in Supabase Dashboard → Edge Functions → Secrets."
    );
    captureMessage(
      "PAWAPAY_API_KEY missing — webhook cannot verify callbacks",
      { level: "error", tags: { step: "config" } },
      "pawapay-webhook",
    );
    return new Response("Webhook not configured", { status: 503 });
  }

  const rawBody = await req.text();

  // ── Parse payload ───────────────────────────────────────────────────────
  let payload: PawaPayWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Niqo n'utilise QUE les deposits. Payouts/refunds ignorés silencieusement
  // → return 200 OK pour empêcher PawaPay de retry indéfiniment.
  if (payload.payoutId) {
    console.log("[pawapay-webhook] payout ignored", payload.payoutId);
    return new Response("OK", { status: 200 });
  }
  if (payload.refundId) {
    console.log("[pawapay-webhook] refund ignored", payload.refundId);
    return new Response("OK", { status: 200 });
  }

  if (!payload.depositId || !payload.status) {
    return new Response("Missing depositId or status", { status: 400 });
  }

  // Client service_role créé tôt pour permettre logEvent dans tous les chemins
  // d'erreur (notamment le mismatch verify_deposit_status ci-dessous).
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Vérification : double-check via PawaPay API ─────────────────────────
  // L'attaquant ne peut pas forger une réponse de api.pawapay.io.
  const verification = await verifyDepositStatus(payload.depositId, payload.status);
  if (!verification.valid) {
    console.warn("[pawapay-webhook] callback REJECTED — status mismatch with API", {
      depositId: payload.depositId,
      payloadStatus: payload.status,
      apiStatus: verification.apiStatus ?? "unreachable",
    });
    // Signal fort : soit fraude (callback forgé), soit dérive sandbox PawaPay.
    // On capture en warning pour visibilité dans Sentry — un volume anormal
    // doit déclencher une investigation.
    captureMessage(
      "Webhook rejected — status mismatch with PawaPay API",
      {
        level: "warning",
        tags: {
          step: "verify-mismatch",
          payload_status: payload.status,
          api_status: verification.apiStatus ?? "unreachable",
        },
        extra: { depositId: payload.depositId },
      },
      "pawapay-webhook",
    );
    logEvent(adminClient, "pawapay-webhook", "webhook.rejected", "warning", {
      payload_status: payload.status,
      api_status: verification.apiStatus ?? "unreachable",
      reason: "verify-mismatch",
    });
    // 200 pour ne pas faire retry PawaPay indéfiniment sur un callback malicieux.
    // Le vrai callback légitime arrivera plus tard (ou pas) avec le bon statut.
    return new Response("OK", { status: 200 });
  }

  // Map PawaPay status → notre enum
  const statutMap: Record<string, PaiementStatut> = {
    COMPLETED: "completed",
    FAILED: "failed",
    REJECTED: "failed",
    ACCEPTED: "pending",
    PROCESSING: "pending",
  };
  const newStatut = statutMap[payload.status];
  if (!newStatut) {
    console.log("[pawapay-webhook] unknown status ignored", payload.status);
    return new Response("OK", { status: 200 });
  }

  // ── Idempotence + transition unidirectionnelle ──────────────────────────
  // (adminClient déjà créé plus haut pour permettre logEvent dans verify-mismatch)

  const { data: current, error: fetchError } = await adminClient
    .from("paiements_niqo")
    .select("id, statut")
    .eq("pawapay_deposit_id", payload.depositId)
    .maybeSingle();

  if (fetchError) {
    console.error("[pawapay-webhook] fetch error", fetchError.code);
    captureException(fetchError, {
      tags: { step: "fetch-paiement" },
      extra: { depositId: payload.depositId },
    }, "pawapay-webhook");
    logEvent(adminClient, "pawapay-webhook", "webhook.db_error", "error", {
      step: "fetch-paiement",
      error_code: fetchError.code ?? null,
    });
    return new Response("DB error", { status: 500 });
  }
  if (!current) {
    console.log("[pawapay-webhook] unknown depositId", payload.depositId);
    return new Response("OK", { status: 200 });
  }

  const currentStatut = current.statut as PaiementStatut;

  // Idempotent : déjà dans le bon état → no-op
  if (currentStatut === newStatut) {
    console.log("[pawapay-webhook] noop already in state", {
      depositId: payload.depositId,
      statut: currentStatut,
    });
    return new Response("OK", { status: 200 });
  }

  // Anti-rétrogradation : un état terminal ne change plus.
  if (currentStatut === "completed" || currentStatut === "failed") {
    console.warn("[pawapay-webhook] rejected terminal state transition", {
      depositId: payload.depositId,
      currentStatut,
      attempted: newStatut,
    });
    return new Response("OK", { status: 200 });
  }

  // ── Update (currentStatut = pending → newStatut) ────────────────────────
  const updates: Record<string, unknown> = {
    statut: newStatut,
    pawapay_metadata: payload,
  };
  if (newStatut === "completed") {
    updates.completed_at = new Date().toISOString();
  }

  const { error: updateError } = await adminClient
    .from("paiements_niqo")
    .update(updates)
    .eq("id", current.id)
    .eq("statut", "pending"); // double-guard race

  if (updateError) {
    console.error("[pawapay-webhook] update error", updateError.code);
    captureException(updateError, {
      tags: { step: "update-paiement", new_statut: newStatut },
      extra: { depositId: payload.depositId, paiement_id: current.id },
    }, "pawapay-webhook");
    logEvent(adminClient, "pawapay-webhook", "webhook.db_error", "error", {
      step: "update-paiement",
      error_code: updateError.code ?? null,
      attempted_statut: newStatut,
    });
    return new Response("DB error", { status: 500 });
  }

  console.log("[pawapay-webhook] updated", {
    depositId: payload.depositId,
    from: currentStatut,
    to: newStatut,
  });

  // Event log : transition réussie. Compteurs dashboard (completed vs failed
  // ratio par jour, vélocité d'encaissement, etc.).
  logEvent(
    adminClient,
    "pawapay-webhook",
    newStatut === "completed" ? "webhook.completed" : "webhook.failed",
    "info",
    {
      from: currentStatut,
      to: newStatut,
      payload_status: payload.status,
    },
  );

  return new Response("OK", { status: 200 });
});

// ── Double-check via PawaPay API ────────────────────────────────────────────
// Fetch GET /v2/deposits/{depositId} et compare le statut renvoyé par l'API
// officielle au statut du callback reçu. Si match → callback légitime.
//
// Mapping de tolérance :
//   - payload "REJECTED" ↔ api "FAILED" (REJECTED n'apparaît pas dans la liste
//     API, c'est un alias terminal côté callback)
//   - le reste matche directement (ACCEPTED, PROCESSING, COMPLETED, FAILED)
//   - api "IN_RECONCILIATION" ne devrait pas apparaître dans un callback final

async function verifyDepositStatus(
  depositId: string,
  payloadStatus: string
): Promise<{ valid: boolean; apiStatus?: string }> {
  const url = `${PAWAPAY_API_URL}/v2/deposits/${depositId}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAWAPAY_API_KEY}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      console.error(
        "[pawapay-webhook] verify status fetch failed",
        response.status,
        depositId
      );
      return { valid: false };
    }
    const json = (await response.json()) as DepositStatusResponse;
    if (json.status !== "FOUND" || !json.data) {
      console.warn(
        "[pawapay-webhook] deposit NOT_FOUND on PawaPay API",
        depositId
      );
      return { valid: false };
    }
    const apiStatus = json.data.status;

    // Match direct OU REJECTED (callback) ↔ FAILED (api)
    const matches =
      payloadStatus === apiStatus ||
      (payloadStatus === "REJECTED" && apiStatus === "FAILED");

    return { valid: matches, apiStatus };
  } catch (e) {
    console.error("[pawapay-webhook] verify status threw", e);
    captureException(e, {
      tags: { step: "verify-fetch" },
      extra: { depositId },
    }, "pawapay-webhook");
    return { valid: false };
  }
}
