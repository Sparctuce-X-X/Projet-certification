// Edge Function — generate-compta-pdf
//
// Génère un PDF comptable à la demande de l'admin depuis /admin/kpis (V1
// manuel, pas de cron — cf. mig 115 §Choix conscient).
//
// FLOW
//   1. Verify caller is admin (forward user JWT, gate via users.is_admin)
//   2. Fetch paiements completed sur la période + pays filter
//   3. Build PDF avec pdf-lib (header Niqo + RDB, table paiements 25/page,
//      footer totaux XOF/XAF/EUR)
//   4. Upload PDF dans Storage `compta-reports/<uuid>.pdf`
//   5. Call RPC `create_compta_report` (mig 115) → insert metadata + audit log
//   6. Return { report_id, storage_path, signed_url }
//
// AUTH
//   Authorization: Bearer <user_jwt> (admin) — forwardé par supabase-js invoke
//   La RPC `create_compta_report` (SECURITY DEFINER) gate via auth.uid().
//
// SECRETS REQUIS (Supabase Edge Functions Secrets)
//   - SUPABASE_URL                (auto)
//   - SUPABASE_ANON_KEY           (auto)
//   - SUPABASE_SERVICE_ROLE_KEY   (auto)
//
// BUCKET REQUIS
//   `compta-reports` — privé, RLS admin SELECT only (à créer côté dashboard).
//
// LIMITES
//   - Pas de pagination CSV-like : on charge tous les paiements en mémoire.
//     OK jusqu'à ~10k paiements (~80 KB de PDF). À l'échelle 100k+, ajouter
//     pagination DB (curseur) — V2.
//   - Pas de retry : si l'upload Storage fail, l'admin clique relancer.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { captureException } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";
import {
  NIQO_LEGAL_NAME,
  NIQO_RDB_TIN,
  NIQO_LEGAL_FORM,
  NIQO_GOVERNING_LAW,
  NIQO_HQ_ADDRESS,
  NIQO_CAPITAL,
  NIQO_SUPPORT_EMAIL,
} from "../_shared/niqo-legal.ts";
import { formatParisDateTime } from "../_shared/date-format.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET = "compta-reports";
const EUR_RATE = 655.957;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // apikey est requis : supabase-js l'envoie systématiquement depuis le browser
  // (ajouté par createBrowserClient @supabase/ssr). Sans, le browser rejette
  // le preflight CORS → "Failed to send a request".
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

interface RequestBody {
  periode_debut: string; // ISO timestamp
  periode_fin: string;
  pays?: "CI" | "CG" | null; // null = ALL
}

interface PaiementRow {
  id: string;
  completed_at: string;
  type: string;
  montant_fcfa: number;
  user_pays: "CI" | "CG";
  user_label: string;
  pawapay_deposit_id: string | null;
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function jsonError(code: string, status: number, hint?: string) {
  return new Response(JSON.stringify({ error: code, hint }), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  console.log("[generate-compta-pdf] req received", {
    method: req.method,
    url: req.url,
    hasAuth: !!req.headers.get("authorization"),
  });

  // CORS preflight (browser admin invoke depuis Vercel → Supabase Edge)
  if (req.method === "OPTIONS") {
    console.log("[generate-compta-pdf] OPTIONS preflight handled");
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonError("METHOD_NOT_ALLOWED", 405);
  }

  try {
    return await handleRequest(req);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const stack = (e as Error).stack ?? "";
    console.error("[generate-compta-pdf] UNCAUGHT", msg, stack);
    return jsonError("UNCAUGHT", 500, msg);
  }
});

async function handleRequest(req: Request): Promise<Response> {

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  const { periode_debut, periode_fin, pays } = body;
  if (!periode_debut || !periode_fin) {
    return jsonError("MISSING_PERIODE", 400);
  }
  if (pays && pays !== "CI" && pays !== "CG") {
    return jsonError("INVALID_PAYS", 400);
  }

  const periodeDebut = new Date(periode_debut);
  const periodeFin = new Date(periode_fin);
  if (
    isNaN(periodeDebut.getTime()) ||
    isNaN(periodeFin.getTime()) ||
    periodeFin <= periodeDebut
  ) {
    return jsonError("INVALID_WINDOW", 400);
  }

  // ── Auth : forward user JWT ─────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError("UNAUTHORIZED", 401);
  }

  // Client RPC : JWT user (pour gate is_admin via auth.uid())
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Client privilégié : read paiements + upload Storage
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify admin
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) {
    return jsonError("UNAUTHORIZED", 401);
  }
  const { data: userRow, error: userErr } = await adminClient
    .from("users")
    .select("is_admin, prenom, nom")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (userErr || !userRow?.is_admin) {
    console.warn("[generate-compta-pdf] ADMIN_REQUIRED", {
      userErr: userErr?.message,
      isAdmin: userRow?.is_admin,
    });
    return jsonError("ADMIN_REQUIRED", 403);
  }
  console.log("[generate-compta-pdf] admin verified", { userId: userData.user.id });
  const adminLabel =
    `${userRow.prenom ?? ""} ${userRow.nom ?? ""}`.trim() ||
    userData.user.email ||
    "Admin";

  // ── Fetch paiements ─────────────────────────────────────────────────────
  let query = adminClient
    .from("paiements_niqo")
    .select(
      "id, completed_at, type, montant_fcfa, pawapay_deposit_id, user_id, users!inner(pays, prenom, nom)",
    )
    .eq("statut", "completed")
    .gte("completed_at", periode_debut)
    .lt("completed_at", periode_fin)
    .order("completed_at", { ascending: true });

  if (pays === "CI" || pays === "CG") {
    query = query.eq("users.pays", pays);
  }

  const { data: rawPaiements, error: fetchErr } = await query;
  if (fetchErr) {
    console.error("[generate-compta-pdf] FETCH_FAILED", fetchErr.code, fetchErr.message);
    captureException(fetchErr, {
      tags: { step: "fetch-paiements" },
    }, "generate-compta-pdf");
    return jsonError("FETCH_FAILED", 500, fetchErr.message);
  }
  console.log("[generate-compta-pdf] paiements fetched", { count: rawPaiements?.length ?? 0 });

  const paiements: PaiementRow[] = (rawPaiements ?? []).map((p) => {
    // Supabase typing : FK inner join → array even when unique. Cast.
    const u = (p.users as unknown as { pays: "CI" | "CG"; prenom: string | null; nom: string | null });
    return {
      id: p.id,
      completed_at: p.completed_at,
      type: p.type,
      montant_fcfa: p.montant_fcfa,
      user_pays: u.pays,
      user_label: `${u.prenom ?? ""} ${u.nom ?? ""}`.trim() || "—",
      pawapay_deposit_id: p.pawapay_deposit_id,
    };
  });

  const totalFcfa = paiements.reduce((s, p) => s + p.montant_fcfa, 0);
  const totalXof = paiements
    .filter((p) => p.user_pays === "CI")
    .reduce((s, p) => s + p.montant_fcfa, 0);
  const totalXaf = paiements
    .filter((p) => p.user_pays === "CG")
    .reduce((s, p) => s + p.montant_fcfa, 0);

  // ── Build PDF ───────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595; // A4 portrait
  const pageHeight = 842;
  const margin = 40;
  const lineHeight = 14;
  const headerHeight = 130;
  const footerHeight = 30;
  const tableHeaderY = pageHeight - margin - headerHeight - 10;
  const rowsPerPage = 25;

  function fmtDate(iso: string): string {
    return formatParisDateTime(iso);
  }

  function fmtMoney(n: number): string {
    // toLocaleString("fr-FR") utilise NARROW NO-BREAK SPACE (U+202F) comme
    // séparateur de milliers — pas dans WinAnsi → pdf-lib crashe.
    // On utilise un séparateur ASCII manuel.
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  // Sanitize defensive : strip tout caractère hors CP1252 (WinAnsi) qui pourrait
  // surgir d'un user_label exotique (emoji, alphabet non-latin, etc.).
  // On preserve les accents français (é è à ô ç) qui sont dans CP1252.
  function safe(s: string): string {
    return s
      .replace(/[  ]/g, " ")     // narrow nbsp + nbsp → space
      .replace(/[→←]/g, "->")    // arrows → ASCII
      .replace(/[…]/g, "...")          // ellipsis → ASCII
      .replace(/[≈]/g, "~")            // ~= → ~
      .replace(/[^\x00-\xFF]/g, "?");      // anything else outside Latin-1 → ?
  }

  function devise(p: "CI" | "CG"): string {
    return p === "CI" ? "XOF" : "XAF";
  }

  function drawHeader(page: ReturnType<typeof pdfDoc.addPage>, pageNum: number, totalPages: number) {
    const top = pageHeight - margin;
    const gray = rgb(0.4, 0.4, 0.4);

    page.drawText("RAPPORT COMPTABLE NIQO", {
      x: margin,
      y: top,
      size: 16,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    // Mentions légales NIQO LTD (source : _shared/niqo-legal.ts → certif RDB Rwanda)
    // Bloc obligatoire pour valeur juridique du document (Law 007/2021 art. 13).
    // safe() strip les caractères hors Latin-1 (em dash U+2014 → "-" préalable).
    page.drawText(NIQO_LEGAL_NAME, {
      x: margin,
      y: top - 18,
      size: 10,
      font: fontBold,
    });
    page.drawText(
      safe(`TIN ${NIQO_RDB_TIN} · ${NIQO_LEGAL_FORM.replace("—", "-")}`),
      { x: margin, y: top - 30, size: 8, font: fontRegular, color: gray },
    );
    page.drawText(safe(NIQO_HQ_ADDRESS), {
      x: margin, y: top - 40, size: 8, font: fontRegular, color: gray,
    });
    page.drawText(
      safe(`Capital social : ${NIQO_CAPITAL} · Contact : ${NIQO_SUPPORT_EMAIL}`),
      { x: margin, y: top - 50, size: 8, font: fontRegular, color: gray },
    );
    page.drawText(safe(`Loi applicable : ${NIQO_GOVERNING_LAW}`), {
      x: margin, y: top - 60, size: 8, font: fontRegular, color: gray,
    });

    // Métadonnées rapport
    page.drawText(
      `Periode : ${fmtDate(periode_debut)} -> ${fmtDate(periode_fin)}`,
      { x: margin, y: top - 78, size: 10, font: fontRegular },
    );
    page.drawText(
      `Pays : ${pays ?? "ALL (CI + CG)"}`,
      { x: margin, y: top - 92, size: 10, font: fontRegular },
    );
    page.drawText(
      safe(`Genere par : ${adminLabel} le ${fmtDate(new Date().toISOString())}`),
      { x: margin, y: top - 106, size: 9, font: fontRegular, color: gray },
    );

    page.drawText(`Page ${pageNum} / ${totalPages}`, {
      x: pageWidth - margin - 60,
      y: top,
      size: 9,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4),
    });

    // Table header row
    const yHead = tableHeaderY;
    page.drawText("Date", { x: margin, y: yHead, size: 9, font: fontBold });
    page.drawText("Type", { x: margin + 105, y: yHead, size: 9, font: fontBold });
    page.drawText("Pays", { x: margin + 170, y: yHead, size: 9, font: fontBold });
    page.drawText("Devise", { x: margin + 200, y: yHead, size: 9, font: fontBold });
    page.drawText("Montant", { x: margin + 245, y: yHead, size: 9, font: fontBold });
    page.drawText("Utilisateur", { x: margin + 305, y: yHead, size: 9, font: fontBold });
    page.drawText("Deposit ID", { x: margin + 410, y: yHead, size: 9, font: fontBold });

    page.drawLine({
      start: { x: margin, y: yHead - 4 },
      end: { x: pageWidth - margin, y: yHead - 4 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
  }

  function drawFooter(page: ReturnType<typeof pdfDoc.addPage>) {
    page.drawText(
      "Document genere automatiquement - Confidentiel, usage comptable interne.",
      {
        x: margin,
        y: footerHeight,
        size: 8,
        font: fontRegular,
        color: rgb(0.5, 0.5, 0.5),
      },
    );
  }

  const totalPages = Math.max(1, Math.ceil(paiements.length / rowsPerPage)) + 1; // +1 totals page

  for (let pageIdx = 0; pageIdx < totalPages - 1; pageIdx++) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeader(page, pageIdx + 1, totalPages);
    drawFooter(page);

    const startRow = pageIdx * rowsPerPage;
    const endRow = Math.min(startRow + rowsPerPage, paiements.length);
    let y = tableHeaderY - 20;

    for (let i = startRow; i < endRow; i++) {
      const p = paiements[i];
      page.drawText(fmtDate(p.completed_at), { x: margin, y, size: 8, font: fontRegular });
      page.drawText(p.type, { x: margin + 105, y, size: 8, font: fontRegular });
      page.drawText(p.user_pays, { x: margin + 170, y, size: 8, font: fontRegular });
      page.drawText(devise(p.user_pays), { x: margin + 200, y, size: 8, font: fontRegular });
      page.drawText(fmtMoney(p.montant_fcfa), {
        x: margin + 245, y, size: 8, font: fontRegular,
      });
      const userTrunc = p.user_label.length > 18 ? p.user_label.slice(0, 18) + "..." : p.user_label;
      page.drawText(safe(userTrunc), { x: margin + 305, y, size: 8, font: fontRegular });
      const depositTrunc = (p.pawapay_deposit_id ?? "").slice(0, 22);
      page.drawText(safe(depositTrunc), {
        x: margin + 410, y, size: 8, font: fontRegular, color: rgb(0.4, 0.4, 0.4),
      });
      y -= lineHeight;
    }

    if (paiements.length === 0 && pageIdx === 0) {
      page.drawText("Aucune transaction sur la période / pays sélectionnés.", {
        x: margin,
        y: tableHeaderY - 30,
        size: 10,
        font: fontRegular,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  }

  // ── Page totaux ──────────────────────────────────────────────────────────
  const totalsPage = pdfDoc.addPage([pageWidth, pageHeight]);
  drawHeader(totalsPage, totalPages, totalPages);
  drawFooter(totalsPage);

  const yT = tableHeaderY - 40;
  totalsPage.drawText("SYNTHÈSE", { x: margin, y: yT, size: 13, font: fontBold });

  const totalEur = totalFcfa / EUR_RATE;
  const xofEur = totalXof / EUR_RATE;
  const xafEur = totalXaf / EUR_RATE;

  const lines = [
    `Total transactions       : ${paiements.length}`,
    `Total XOF (CI)           : ${fmtMoney(totalXof)} XOF  (~${xofEur.toFixed(2)} EUR)`,
    `Total XAF (CG)           : ${fmtMoney(totalXaf)} XAF  (~${xafEur.toFixed(2)} EUR)`,
    `Total FCFA combiné       : ${fmtMoney(totalFcfa)} FCFA`,
    `Total EUR équivalent     : ${totalEur.toFixed(2)} EUR  (taux 1 EUR = ${EUR_RATE} FCFA)`,
  ];

  let yLine = yT - 30;
  for (const line of lines) {
    totalsPage.drawText(safe(line), { x: margin, y: yLine, size: 10, font: fontRegular });
    yLine -= 18;
  }

  // Breakdown par type
  const verifCount = paiements.filter((p) => p.type === "verification").length;
  const verifSum = paiements.filter((p) => p.type === "verification").reduce((s, p) => s + p.montant_fcfa, 0);
  const boost7Count = paiements.filter((p) => p.type === "boost" && p.montant_fcfa === 1000).length;
  const boost7Sum = paiements.filter((p) => p.type === "boost" && p.montant_fcfa === 1000).reduce((s, p) => s + p.montant_fcfa, 0);
  const boost30Count = paiements.filter((p) => p.type === "boost" && p.montant_fcfa === 3000).length;
  const boost30Sum = paiements.filter((p) => p.type === "boost" && p.montant_fcfa === 3000).reduce((s, p) => s + p.montant_fcfa, 0);

  yLine -= 10;
  totalsPage.drawText("BREAKDOWN PAR TYPE", { x: margin, y: yLine, size: 11, font: fontBold });
  yLine -= 20;
  const breakdown = [
    `KYC Vérification         : ${verifCount} × 1 000 = ${fmtMoney(verifSum)} FCFA`,
    `Boost 7 jours            : ${boost7Count} × 1 000 = ${fmtMoney(boost7Sum)} FCFA`,
    `Boost 30 jours           : ${boost30Count} × 3 000 = ${fmtMoney(boost30Sum)} FCFA`,
  ];
  for (const line of breakdown) {
    totalsPage.drawText(safe(line), { x: margin, y: yLine, size: 10, font: fontRegular });
    yLine -= 18;
  }

  // ── Save + upload ───────────────────────────────────────────────────────
  console.log("[generate-compta-pdf] PDF built", { nbPaiements: paiements.length });
  const pdfBytes = await pdfDoc.save();
  console.log("[generate-compta-pdf] pdfBytes ready", { bytes: pdfBytes.length });
  const reportUuid = crypto.randomUUID();
  const storagePath = `${reportUuid}.pdf`;

  const { error: uploadErr } = await adminClient.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadErr) {
    console.error("[generate-compta-pdf] UPLOAD_FAILED", uploadErr.message, {
      bucket: BUCKET,
      hint: "Vérifie que le bucket 'compta-reports' existe (Dashboard Supabase → Storage → New bucket → privé)",
    });
    captureException(uploadErr, {
      tags: { step: "upload-storage" },
    }, "generate-compta-pdf");
    return jsonError("UPLOAD_FAILED", 500, uploadErr.message);
  }
  console.log("[generate-compta-pdf] uploaded to Storage", { storagePath });

  // ── Insert metadata via RPC (forward user JWT pour audit log) ───────────
  const { data: reportId, error: insertErr } = await userClient.rpc(
    "create_compta_report",
    {
      p_periode_debut: periode_debut,
      p_periode_fin: periode_fin,
      p_pays: pays ?? "ALL",
      p_storage_path: storagePath,
      p_total_fcfa: totalFcfa,
      p_total_xof: totalXof,
      p_total_xaf: totalXaf,
      p_nb_paiements: paiements.length,
      p_bytes: pdfBytes.length,
    },
  );
  if (insertErr) {
    console.error("[generate-compta-pdf] INSERT_FAILED", insertErr.code, insertErr.message);
    captureException(insertErr, {
      tags: { step: "insert-report" },
    }, "generate-compta-pdf");
    // Rollback Storage : best-effort
    await adminClient.storage.from(BUCKET).remove([storagePath]);
    return jsonError("INSERT_FAILED", 500, insertErr.message);
  }
  console.log("[generate-compta-pdf] report inserted", { reportId });

  // ── Signed URL pour download immédiat (24h) ─────────────────────────────
  const { data: signed } = await adminClient.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24);

  logEvent(adminClient, "generate-compta-pdf", "compta.generated", "info", {
    report_id: reportId,
    nb_paiements: paiements.length,
    bytes: pdfBytes.length,
    pays: pays ?? "ALL",
  });

  return jsonOk({
    report_id: reportId,
    storage_path: storagePath,
    signed_url: signed?.signedUrl ?? null,
    nb_paiements: paiements.length,
    total_fcfa: totalFcfa,
    total_xof: totalXof,
    total_xaf: totalXaf,
    bytes: pdfBytes.length,
  });
}
