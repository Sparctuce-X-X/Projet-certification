// Edge Function — send-alert-digest
//
// Appelée quotidiennement par le cron `niqo-alert-digest` (mig 108) via pg_net.
// Récupère le summary 24h via RPC `get_alert_digest_24h`, évalue les seuils,
// et envoie un email récap aux recipients actifs si quelque chose mérite
// l'attention. Sinon skip silencieusement.
//
// RÈGLES DE DÉCLENCHEMENT (en ordre de priorité)
//   - errors > 0                           → email "alertes"
//   - warnings ≥ 5                         → email "alertes"
//   - total = 0 (pas d'activité 24h)       → email "silence cron suspecté"
//   - sinon                                → skip
//
// Force daily via env `ALERT_FORCE_DAILY=true` : envoie même si rien à signaler
// (mode "rapport de routine"). Off par défaut.
//
// AUTH
//   Header Authorization: Bearer ${NIQO_INTERNAL_KEY} (même secret que send-push).
//   Le cron pg_net injecte ce key via vault.decrypted_secrets/service_role_key.
//
// SECRETS REQUIS (Supabase Edge Functions Secrets)
//   - NIQO_INTERNAL_KEY    : déjà set pour send-push-notification
//   - RESEND_API_KEY       : à set (même valeur que côté Vercel landing/)
//   - ALERT_EMAIL_FROM     : optionnel, default "Niqo <bonjour@niqo.africa>"
//   - ALERT_FORCE_DAILY    : optionnel, "true" pour forcer envoi quotidien

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException, captureMessage } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ALERT_EMAIL_FROM = Deno.env.get("ALERT_EMAIL_FROM") ?? "Niqo <bonjour@niqo.africa>";
const ALERT_FORCE_DAILY = Deno.env.get("ALERT_FORCE_DAILY") === "true";

function getAcceptedAdminKeys(): string[] {
  const keys: string[] = [];
  const internalKey = Deno.env.get("NIQO_INTERNAL_KEY");
  if (internalKey) keys.push(internalKey);
  return keys;
}

interface ModuleSummary {
  module: string;
  total: number;
  error_count: number;
  warning_count: number;
  info_count: number;
}

interface TopError {
  event_type: string;
  module: string;
  cnt: number;
}

interface DigestSummary {
  window_hours: number;
  total: number;
  totals_by_severity: Record<string, number>;
  by_module: ModuleSummary[];
  top_errors: TopError[];
  generated_at: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Auth NIQO_INTERNAL_KEY ──────────────────────────────────────────────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const accepted = getAcceptedAdminKeys();
  if (!token || accepted.length === 0 || !anyConstantTimeMatch(token, accepted)) {
    return new Response("Unauthorized", { status: 403 });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Récupère le summary via RPC ─────────────────────────────────────────
  const { data: digest, error: rpcError } = await adminClient.rpc(
    "get_alert_digest_24h",
  );
  if (rpcError) {
    console.error("[alert-digest] rpc failed", rpcError);
    captureException(rpcError, { tags: { step: "rpc" } }, "send-alert-digest");
    return jsonError("RPC_FAILED", 500);
  }
  const summary = digest as DigestSummary;

  // ── Évalue les seuils ───────────────────────────────────────────────────
  const totals = summary.totals_by_severity ?? {};
  const errorCount = totals.error ?? 0;
  const warningCount = totals.warning ?? 0;
  const totalEvents = summary.total ?? 0;

  let reason: "errors" | "warnings" | "silence" | "force_daily" | null = null;
  if (errorCount > 0) reason = "errors";
  else if (warningCount >= 5) reason = "warnings";
  else if (totalEvents === 0) reason = "silence";
  else if (ALERT_FORCE_DAILY) reason = "force_daily";

  if (reason === null) {
    console.log("[alert-digest] no threshold met, skipping", {
      totalEvents,
      errorCount,
      warningCount,
    });
    logEvent(adminClient, "send-alert-digest", "alert.skipped", "info", {
      total: totalEvents,
      errors: errorCount,
      warnings: warningCount,
      reason: "no_threshold_met",
    });
    return jsonOk({ sent: 0, skipped: true, reason: "no_threshold_met" });
  }

  // ── Recipients actifs ───────────────────────────────────────────────────
  const { data: recipients, error: recipientsError } = await adminClient
    .from("niqo_alert_recipients")
    .select("email, label")
    .eq("active", true);

  if (recipientsError) {
    console.error("[alert-digest] recipients fetch failed", recipientsError);
    captureException(recipientsError, {
      tags: { step: "fetch-recipients" },
    }, "send-alert-digest");
    return jsonError("RECIPIENTS_FETCH_FAILED", 500);
  }

  if (!recipients || recipients.length === 0) {
    console.log("[alert-digest] no active recipients, skipping send");
    logEvent(adminClient, "send-alert-digest", "alert.skipped", "warning", {
      reason: "no_recipients",
      trigger_reason: reason,
    });
    return jsonOk({ sent: 0, skipped: true, reason: "no_recipients" });
  }

  // ── Resend ──────────────────────────────────────────────────────────────
  if (!RESEND_API_KEY) {
    console.error("[alert-digest] RESEND_API_KEY not configured");
    captureMessage(
      "RESEND_API_KEY missing — alert digest cannot send",
      { level: "error", tags: { step: "config" } },
      "send-alert-digest",
    );
    return jsonError("RESEND_NOT_CONFIGURED", 503);
  }

  const subject = buildSubject(reason, errorCount, warningCount);
  const html = buildHtml(reason, summary);
  const text = buildText(reason, summary);

  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: ALERT_EMAIL_FROM,
          to: [r.email],
          reply_to: "support@niqo.africa",
          subject,
          html,
          text,
          tags: [{ name: "category", value: "alert-digest" }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error("[alert-digest] resend non-2xx", res.status, body.slice(0, 200));
        failed++;
        continue;
      }
      sent++;
    } catch (e) {
      console.error("[alert-digest] resend threw", e);
      failed++;
    }
  }

  logEvent(adminClient, "send-alert-digest", "alert.sent", "info", {
    trigger_reason: reason,
    sent,
    failed,
    recipients_count: recipients.length,
    errors_24h: errorCount,
    warnings_24h: warningCount,
    total_24h: totalEvents,
  });

  return jsonOk({ sent, failed, reason });
});

// ── Email builders ───────────────────────────────────────────────────────────

function buildSubject(
  reason: string,
  errors: number,
  warnings: number,
): string {
  if (reason === "errors") {
    return `[Niqo] ⚠ ${errors} erreur${errors > 1 ? "s" : ""} en 24h`;
  }
  if (reason === "warnings") {
    return `[Niqo] ⚠ ${warnings} warnings en 24h`;
  }
  if (reason === "silence") {
    return "[Niqo] ⚠ Aucune activité 24h — vérifier les crons";
  }
  return "[Niqo] Digest quotidien d'observabilité";
}

function buildText(reason: string, s: DigestSummary): string {
  const lines: string[] = [];
  lines.push(`Niqo — Digest 24h (généré ${s.generated_at})`);
  lines.push("");
  if (reason === "silence") {
    lines.push(
      "ALERTE : aucun event remonté dans niqo_event_log sur les 24 dernières heures.",
    );
    lines.push(
      "Cela peut indiquer un cron pg_cron cassé, des Edge Functions non déployées,",
    );
    lines.push("ou simplement aucune activité utilisateur.");
    return lines.join("\n");
  }
  lines.push(`Total: ${s.total} events`);
  const totals = s.totals_by_severity ?? {};
  lines.push(
    `Severities — error: ${totals.error ?? 0}, warning: ${totals.warning ?? 0}, info: ${totals.info ?? 0}`,
  );
  lines.push("");
  lines.push("Par module:");
  for (const m of s.by_module) {
    lines.push(
      `  ${m.module}: total ${m.total}, errors ${m.error_count}, warnings ${m.warning_count}`,
    );
  }
  if (s.top_errors && s.top_errors.length > 0) {
    lines.push("");
    lines.push("Top erreurs:");
    for (const e of s.top_errors) {
      lines.push(`  ${e.event_type} (${e.module}) — ${e.cnt}x`);
    }
  }
  lines.push("");
  lines.push("Dashboard: https://niqo.africa/admin/observability");
  return lines.join("\n");
}

function buildHtml(reason: string, s: DigestSummary): string {
  const totals = s.totals_by_severity ?? {};
  const errCount = totals.error ?? 0;
  const warnCount = totals.warning ?? 0;
  const infoCount = totals.info ?? 0;

  const headerBg = reason === "errors"
    ? "#E24B4A"
    : reason === "warnings"
      ? "#F59E0B"
      : reason === "silence"
        ? "#6B7280"
        : "#1A1A1A";

  const headerText = reason === "errors"
    ? `${errCount} erreur${errCount > 1 ? "s" : ""} en 24h`
    : reason === "warnings"
      ? `${warnCount} warnings en 24h`
      : reason === "silence"
        ? "Aucune activité 24h — vérifier les crons"
        : "Digest quotidien Niqo";

  const moduleRows = s.by_module
    .map((m) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-family:monospace;font-size:13px;">${escapeHtml(m.module)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;">${m.total}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;color:#E24B4A;">${m.error_count}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;color:#F59E0B;">${m.warning_count}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;color:#6B7280;">${m.info_count}</td>
      </tr>
    `)
    .join("");

  const topErrorsRows = (s.top_errors ?? [])
    .map((e) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-family:monospace;font-size:13px;color:#E24B4A;">${escapeHtml(e.event_type)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-family:monospace;font-size:13px;">${escapeHtml(e.module)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;">${e.cnt}</td>
      </tr>
    `)
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1A1A;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#FFFFFF;">
    <tr>
      <td style="padding:24px 32px;background:${headerBg};color:#FFFFFF;">
        <h1 style="margin:0;font-size:20px;font-weight:700;">${escapeHtml(headerText)}</h1>
        <p style="margin:4px 0 0;font-size:13px;opacity:0.85;">Niqo — Digest observabilité 24h</p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 32px;">
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#374151;">
          <strong>${s.total}</strong> events au total — <span style="color:#E24B4A;">${errCount} erreurs</span>, <span style="color:#F59E0B;">${warnCount} warnings</span>, <span style="color:#6B7280;">${infoCount} info</span>.
        </p>

        ${s.by_module.length === 0 ? `
          <p style="padding:16px;background:#FEF3C7;border-radius:8px;font-size:14px;margin:0;">
            ⚠ Aucun event sur les 24 dernières heures. Vérifie que les crons tournent et que les Edge Functions sont déployées.
          </p>
        ` : `
        <h2 style="font-size:14px;font-weight:600;margin:24px 0 8px;color:#1A1A1A;">Par module</h2>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
          <thead>
            <tr style="background:#F3F4F6;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280;">Module</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#6B7280;">Total</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#6B7280;">Err</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#6B7280;">Warn</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#6B7280;">Info</th>
            </tr>
          </thead>
          <tbody>${moduleRows}</tbody>
        </table>
        `}

        ${(s.top_errors ?? []).length > 0 ? `
        <h2 style="font-size:14px;font-weight:600;margin:24px 0 8px;color:#1A1A1A;">Top erreurs</h2>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
          <thead>
            <tr style="background:#F3F4F6;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280;">Event type</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280;">Module</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#6B7280;">Cnt</th>
            </tr>
          </thead>
          <tbody>${topErrorsRows}</tbody>
        </table>
        ` : ""}

        <p style="margin:24px 0 0;font-size:13px;">
          <a href="https://niqo.africa/admin/observability" style="color:#D85A30;text-decoration:none;font-weight:600;">→ Voir le dashboard complet</a>
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 32px;background:#F9FAFB;border-top:1px solid #E5E7EB;font-size:11px;color:#6B7280;">
        Cet email a été généré automatiquement par le cron <code>niqo-alert-digest</code>.<br>
        Pour modifier les destinataires : <code>update public.niqo_alert_recipients ...</code> côté Supabase SQL Editor.
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Helpers HTTP ─────────────────────────────────────────────────────────────

function jsonOk(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, ...payload }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── Constant-time equals (anti timing attack sur NIQO_INTERNAL_KEY) ────────

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!;
  }
  return diff === 0;
}

function anyConstantTimeMatch(token: string, accepted: string[]): boolean {
  let matched = false;
  for (const candidate of accepted) {
    if (constantTimeEquals(token, candidate)) {
      matched = true;
    }
  }
  return matched;
}
