/**
 * Tests intégration end-to-end — Module Admin KPIs v2 (mig 111-116).
 *
 * Stratégie 100% NUMBER ACCURACY :
 *   - Capture BASELINE des KPIs critiques (revenue, signups) avant fixture
 *   - Insert fixture déterministe (montants connus)
 *   - Capture AFTER + assert delta EXACT (pas de range >=)
 *
 * Couvre :
 *   - admin_kpis_liquidity / activation / revenue / alerts : shape + filter pays
 *   - Gates : non-admin → ADMIN_REQUIRED, INVALID_PAYS, INVALID_DATASET
 *   - Filtre pays : delta CI vs CG exact
 *   - Funnel cohorte stricte (numérateur ≤ dénominateur)
 *   - Cross-pays leak : total_xaf=0 quand filtre CI
 *   - Export CSV : header, SHA256, RFC 4180 escape (virgules + quotes), pays exclude
 *   - create_compta_report : insert + audit log + metadata exact
 *
 * Cf. docs/backend/admin_kpis.md.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, cleanupUsers, createTestUser } from "./helpers/supabase";

interface Setup {
  admin: { client: SupabaseClient; userId: string };
  aliceCi: { client: SupabaseClient; userId: string };
  bobCg: { client: SupabaseClient; userId: string };
  /** Annonce active Alice (CI) — titre avec virgule pour CSV escape test */
  annonceCi: string;
  /** Annonce active Alice (CI) — titre avec quotes pour CSV escape test */
  annonceCiQuoted: string;
  /** Annonce active Bob (CG) */
  annonceCg: string;
  /** Paiement boost completed Alice 1000 FCFA */
  paiementCiBoost: string;
  /** Paiement verification completed Alice 1000 FCFA */
  paiementCiVerif: string;
  /** Paiement verification completed Bob CG 1000 FCFA */
  paiementCgVerif: string;
  /** Baseline (avant insert paiements) — sert pour tests delta */
  baselineCi: number;
  baselineCg: number;
}

async function setupKpisFixtures(): Promise<Setup> {
  const ts = Date.now();
  const sb = adminClient();

  const admin = await createTestUser({
    email: `dom-kpi-${ts}@niqo.test`,
    prenom: "Dom",
    nom: "Admin",
    pays: "CI",
    ville: "Abidjan",
    isAdmin: true,
  });

  // Capture baseline AVANT toute insertion fixture (CI + CG)
  const { data: baselineRaw } = await admin.client.rpc("admin_kpis_revenue", {
    p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    p_to: new Date().toISOString(),
    p_pays: null,
  });
  const baseline = (baselineRaw as { revenue: { total_xof_period: number; total_xaf_period: number } }).revenue;
  const baselineCi = baseline.total_xof_period;
  const baselineCg = baseline.total_xaf_period;

  const aliceCi = await createTestUser({
    email: `alice-kpi-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "Kpi",
    pays: "CI",
    ville: "Abidjan",
  });
  const bobCg = await createTestUser({
    email: `bob-kpi-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "Kpi",
    pays: "CG",
    ville: "Brazzaville",
  });

  // Force telephone sur Alice + Bob (le helper createTestUser ne le set pas).
  // Sert au test "export users CI : SHA256 hash téléphones" (sinon NULL → ""
  // et l'assertion regex /[0-9a-f]{64}/ ne match jamais).
  await sb.from("users").update({ telephone: `+225070${ts.toString().slice(-7)}` }).eq("id", aliceCi.userId);
  await sb.from("users").update({ telephone: `+242060${ts.toString().slice(-7)}` }).eq("id", bobCg.userId);

  const { data: catRow } = await sb
    .from("categories")
    .select("id")
    .order("ordre", { ascending: true })
    .limit(1)
    .single();
  const categorieId = (catRow as { id: string }).id;

  // 2 annonces Alice CI — une normale, une avec titre piégeux (CSV escape)
  const { data: aCi, error: errACi } = await sb
    .from("annonces")
    .insert({
      vendeur_id: aliceCi.userId,
      titre: `Annonce CI normale ${ts}`,
      description: "Test KPI fixture normale",
      prix: 50000,
      ville: "Abidjan",
      pays: "CI",
      etat: "bon",
      statut: "active",
      expires_at: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
      categorie_id: categorieId,
      nb_vues: 100,
    })
    .select("id")
    .single();
  if (errACi) throw new Error(`insert annonce CI normale failed: ${errACi.code} ${errACi.message}`);
  if (!aCi) throw new Error(`insert annonce CI normale returned null (no error)`);
  const annonceCi = (aCi as { id: string }).id;

  const { data: aCiQ, error: errACiQ } = await sb
    .from("annonces")
    .insert({
      vendeur_id: aliceCi.userId,
      titre: `Test "guillemets", virgule ${ts}`,
      description: "CSV escape RFC 4180",
      prix: 30000,
      ville: "Abidjan",
      pays: "CI",
      etat: "bon",
      statut: "active",
      expires_at: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
      categorie_id: categorieId,
      nb_vues: 30,
    })
    .select("id")
    .single();
  if (errACiQ) throw new Error(`insert annonce CI quoted failed: ${errACiQ.code} ${errACiQ.message}`);
  if (!aCiQ) throw new Error(`insert annonce CI quoted returned null`);
  const annonceCiQuoted = (aCiQ as { id: string }).id;

  // 1 annonce Bob CG
  const { data: aCg, error: errACg } = await sb
    .from("annonces")
    .insert({
      vendeur_id: bobCg.userId,
      titre: `Annonce CG ${ts}`,
      description: "Test KPI CG",
      prix: 30000,
      ville: "Brazzaville",
      pays: "CG",
      etat: "bon",
      statut: "active",
      expires_at: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
      categorie_id: categorieId,
      nb_vues: 50,
    })
    .select("id")
    .single();
  if (errACg) throw new Error(`insert annonce CG failed: ${errACg.code} ${errACg.message}`);
  if (!aCg) throw new Error(`insert annonce CG returned null`);
  const annonceCg = (aCg as { id: string }).id;

  // Paiements (montants fixes pour tests delta)
  const { data: pCiBoost } = await sb
    .from("paiements_niqo")
    .insert({
      user_id: aliceCi.userId,
      type: "boost",
      target_id: annonceCi,
      montant_fcfa: 1000,
      statut: "completed",
      completed_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  const paiementCiBoost = (pCiBoost as { id: string }).id;

  const { data: pCiVerif } = await sb
    .from("paiements_niqo")
    .insert({
      user_id: aliceCi.userId,
      type: "verification",
      target_id: null,
      montant_fcfa: 1000,
      statut: "completed",
      completed_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  const paiementCiVerif = (pCiVerif as { id: string }).id;

  const { data: pCgVerif } = await sb
    .from("paiements_niqo")
    .insert({
      user_id: bobCg.userId,
      type: "verification",
      target_id: null,
      montant_fcfa: 1000,
      statut: "completed",
      completed_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  const paiementCgVerif = (pCgVerif as { id: string }).id;

  return {
    admin,
    aliceCi,
    bobCg,
    annonceCi,
    annonceCiQuoted,
    annonceCg,
    paiementCiBoost,
    paiementCiVerif,
    paiementCgVerif,
    baselineCi,
    baselineCg,
  };
}

describe("Admin KPIs v2 — mig 111-116 — 100% accuracy", () => {
  let setup: Setup;

  beforeAll(async () => {
    setup = await setupKpisFixtures();
  });

  afterAll(async () => {
    await cleanupUsers([
      setup.admin.userId,
      setup.aliceCi.userId,
      setup.bobCg.userId,
    ]);
  });

  // ── Gates ──────────────────────────────────────────────────────────────

  it("liquidity non-admin → ADMIN_REQUIRED", async () => {
    const { error } = await setup.aliceCi.client.rpc("admin_kpis_liquidity", {
      p_from: null,
      p_to: null,
      p_pays: null,
    });
    expect(error?.message).toMatch(/ADMIN_REQUIRED/i);
  });

  it("activation non-admin → ADMIN_REQUIRED", async () => {
    const { error } = await setup.bobCg.client.rpc("admin_kpis_activation", {
      p_from: null,
      p_to: null,
      p_pays: null,
    });
    expect(error?.message).toMatch(/ADMIN_REQUIRED/i);
  });

  it("revenue INVALID_PAYS → exception", async () => {
    const { error } = await setup.admin.client.rpc("admin_kpis_revenue", {
      p_from: null,
      p_to: null,
      p_pays: "XX",
    });
    expect(error?.message).toMatch(/INVALID_PAYS/i);
  });

  it("alerts INVALID_PAYS → exception", async () => {
    const { error } = await setup.admin.client.rpc("admin_kpis_alerts", {
      p_pays: "FR",
    });
    expect(error?.message).toMatch(/INVALID_PAYS/i);
  });

  // ── Delta exact (baseline → +fixture) ──────────────────────────────────

  it("revenue : delta CI exact = +2000 FCFA (Alice boost 1k + Alice verif 1k)", async () => {
    const { data, error } = await setup.admin.client.rpc("admin_kpis_revenue", {
      p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      p_to: new Date().toISOString(),
      p_pays: null,
    });
    expect(error).toBeNull();
    const r = (data as { revenue: { total_xof_period: number; total_xaf_period: number } }).revenue;
    expect(r.total_xof_period - setup.baselineCi).toBe(2000);
    expect(r.total_xaf_period - setup.baselineCg).toBe(1000);
  });

  it("revenue : filtre CI → total_xaf inclut SEULEMENT CG baseline (cross-pays exclude strict)", async () => {
    const { data, error } = await setup.admin.client.rpc("admin_kpis_revenue", {
      p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      p_to: new Date().toISOString(),
      p_pays: "CI",
    });
    expect(error).toBeNull();
    const r = (data as { revenue: { total_xof_period: number; total_xaf_period: number; total_fcfa_period: number } }).revenue;
    // Filtre CI : total_xaf=0 systématiquement (pas de paiement CG dedans).
    expect(r.total_xaf_period).toBe(0);
    // total_fcfa = total_xof (puisque XAF=0)
    expect(r.total_fcfa_period).toBe(r.total_xof_period);
  });

  it("revenue : filtre CG → total_xof = 0 (cross-pays exclude strict)", async () => {
    const { data } = await setup.admin.client.rpc("admin_kpis_revenue", {
      p_from: null,
      p_to: null,
      p_pays: "CG",
    });
    const r = (data as { revenue: { total_xof_period: number } }).revenue;
    expect(r.total_xof_period).toBe(0);
  });

  it("revenue : sum(CI) + sum(CG) = sum(ALL) sur même fenêtre (invariant pays)", async () => {
    const win = {
      p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      p_to: new Date().toISOString(),
    };
    const [{ data: ci }, { data: cg }, { data: all }] = await Promise.all([
      setup.admin.client.rpc("admin_kpis_revenue", { ...win, p_pays: "CI" }),
      setup.admin.client.rpc("admin_kpis_revenue", { ...win, p_pays: "CG" }),
      setup.admin.client.rpc("admin_kpis_revenue", { ...win, p_pays: null }),
    ]);
    const ciSum = (ci as { revenue: { total_fcfa_period: number } }).revenue.total_fcfa_period;
    const cgSum = (cg as { revenue: { total_fcfa_period: number } }).revenue.total_fcfa_period;
    const allSum = (all as { revenue: { total_fcfa_period: number } }).revenue.total_fcfa_period;
    expect(ciSum + cgSum).toBe(allSum);
  });

  // ── Funnel invariant cohorte stricte ──────────────────────────────────

  it("activation funnel cohorte stricte : numérateur ≤ dénominateur (ratios ≤ 100%)", async () => {
    const { data } = await setup.admin.client.rpc("admin_kpis_activation", {
      p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      p_to: new Date().toISOString(),
      p_pays: null,
    });
    const f = (data as {
      activation_funnel: {
        signed_up: number;
        published_first_annonce: number;
        proposed_first_rdv: number;
        completed_first_rdv: number;
        signup_to_publish_pct: number | null;
        publish_to_rdv_pct: number | null;
      };
    }).activation_funnel;
    expect(f.published_first_annonce).toBeLessThanOrEqual(f.signed_up);
    expect(f.proposed_first_rdv).toBeLessThanOrEqual(f.published_first_annonce);
    // Ratios bornés à 100%
    if (f.signup_to_publish_pct !== null) expect(f.signup_to_publish_pct).toBeLessThanOrEqual(100);
    if (f.publish_to_rdv_pct !== null) expect(f.publish_to_rdv_pct).toBeLessThanOrEqual(100);
  });

  // ── ARPU invariant fenêtre ────────────────────────────────────────────

  it("ARPU alltime invariant à la fenêtre (KPI stable)", async () => {
    const [{ data: r7 }, { data: r30 }] = await Promise.all([
      setup.admin.client.rpc("admin_kpis_revenue", {
        p_from: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
        p_to: new Date().toISOString(),
        p_pays: "CI",
      }),
      setup.admin.client.rpc("admin_kpis_revenue", {
        p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        p_to: new Date().toISOString(),
        p_pays: "CI",
      }),
    ]);
    const arpu7 = (r7 as { arpu: { eur_alltime: number | null } }).arpu.eur_alltime;
    const arpu30 = (r30 as { arpu: { eur_alltime: number | null } }).arpu.eur_alltime;
    expect(arpu7).toBe(arpu30);
  });

  // ── AlertBand (mig 116) ────────────────────────────────────────────────

  it("alerts : retourne shape attendue avec 4 compteurs + total", async () => {
    const { data, error } = await setup.admin.client.rpc("admin_kpis_alerts", {
      p_pays: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      signalements_pending_24h_plus: expect.any(Number),
      kyc_pending_48h_plus: expect.any(Number),
      suspended_30d: expect.any(Number),
      boosts_stuck_pending: expect.any(Number),
      total: expect.any(Number),
    });
    const a = data as {
      signalements_pending_24h_plus: number;
      kyc_pending_48h_plus: number;
      suspended_30d: number;
      boosts_stuck_pending: number;
      total: number;
    };
    // Invariant : total = somme des 4
    expect(a.total).toBe(
      a.signalements_pending_24h_plus +
        a.kyc_pending_48h_plus +
        a.suspended_30d +
        a.boosts_stuck_pending,
    );
  });

  it("alerts non-admin → ADMIN_REQUIRED", async () => {
    const { error } = await setup.aliceCi.client.rpc("admin_kpis_alerts", {
      p_pays: null,
    });
    expect(error?.message).toMatch(/ADMIN_REQUIRED/i);
  });

  // ── Export CSV : escape + filter strict ────────────────────────────────

  it("export paiements CI : contient nos paiements + XOF, pas CG", async () => {
    const { data, error } = await setup.admin.client.rpc("admin_export_dataset", {
      p_dataset: "paiements",
      p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      p_to: new Date().toISOString(),
      p_pays: "CI",
    });
    expect(error).toBeNull();
    const csv = data as string;
    expect(csv).toContain(setup.paiementCiBoost);
    expect(csv).toContain(setup.paiementCiVerif);
    expect(csv).toContain("XOF");
    // Strict : pas notre paiement CG
    expect(csv).not.toContain(setup.paiementCgVerif);
  });

  it("export annonces CI : CSV escape RFC 4180 sur titre avec guillemets/virgule", async () => {
    const { data, error } = await setup.admin.client.rpc("admin_export_dataset", {
      p_dataset: "annonces",
      p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      p_to: new Date().toISOString(),
      p_pays: "CI",
    });
    expect(error).toBeNull();
    const csv = data as string;
    // Notre annonce CI normale doit être dedans
    expect(csv).toContain("Annonce CI normale");
    // Annonce avec guillemets : escape RFC 4180 (" → "")
    expect(csv).toMatch(/""guillemets""/);
    // Pas de leak CG
    expect(csv).not.toContain(setup.annonceCg);
  });

  it("export users CI : SHA256 hash téléphones, aucun +225 en clair", async () => {
    const { data, error } = await setup.admin.client.rpc("admin_export_dataset", {
      p_dataset: "users",
      p_from: null,
      p_to: null,
      p_pays: "CI",
    });
    expect(error).toBeNull();
    const csv = data as string;
    // Pas de leak téléphone CI en clair
    expect(csv).not.toMatch(/\+225\d{10}/);
    // Au moins 1 hash hex 64 chars
    expect(csv).toMatch(/"[0-9a-f]{64}"/);
  });

  it("export INVALID_DATASET → exception", async () => {
    const { error } = await setup.admin.client.rpc("admin_export_dataset", {
      p_dataset: "inconnu",
      p_from: null,
      p_to: null,
      p_pays: null,
    });
    expect(error?.message).toMatch(/INVALID_DATASET/i);
  });

  // ── create_compta_report ──────────────────────────────────────────────

  it("create_compta_report : insert + audit log exact", async () => {
    const storagePath = `vitest-${Date.now()}.pdf`;
    const { data: reportId, error } = await setup.admin.client.rpc(
      "create_compta_report",
      {
        p_periode_debut: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        p_periode_fin: new Date().toISOString(),
        p_pays: "CI",
        p_storage_path: storagePath,
        p_total_fcfa: 1234,
        p_total_xof: 1234,
        p_total_xaf: 0,
        p_nb_paiements: 7,
        p_bytes: 99999,
      },
    );
    expect(error).toBeNull();
    expect(reportId).toMatch(/^[0-9a-f-]{36}$/);

    const sb = adminClient();
    const { data: row } = await sb
      .from("admin_compta_reports")
      .select("total_fcfa, nb_paiements, bytes, generated_by, pays")
      .eq("id", reportId)
      .maybeSingle();
    // Tous les fields exact
    expect(row).toEqual({
      total_fcfa: 1234,
      nb_paiements: 7,
      bytes: 99999,
      generated_by: setup.admin.userId,
      pays: "CI",
    });

    const { count } = await sb
      .from("audit_log_admin")
      .select("*", { count: "exact", head: true })
      .eq("action", "compta_pdf_generated")
      .eq("target_id", reportId);
    expect(count).toBe(1);
  });

  it("create_compta_report : INVALID_PAYS rejeté", async () => {
    const { error } = await setup.admin.client.rpc("create_compta_report", {
      p_periode_debut: new Date(Date.now() - 86400000).toISOString(),
      p_periode_fin: new Date().toISOString(),
      p_pays: "XX",
      p_storage_path: "x.pdf",
      p_total_fcfa: 0,
      p_total_xof: 0,
      p_total_xaf: 0,
      p_nb_paiements: 0,
      p_bytes: 0,
    });
    expect(error?.message).toMatch(/INVALID_PAYS/i);
  });

  it("create_compta_report : INVALID_WINDOW rejeté", async () => {
    const { error } = await setup.admin.client.rpc("create_compta_report", {
      p_periode_debut: new Date().toISOString(),
      p_periode_fin: new Date(Date.now() - 86400000).toISOString(),
      p_pays: "CI",
      p_storage_path: "x.pdf",
      p_total_fcfa: 0,
      p_total_xof: 0,
      p_total_xaf: 0,
      p_nb_paiements: 0,
      p_bytes: 0,
    });
    expect(error?.message).toMatch(/INVALID_WINDOW/i);
  });

  // ── Audit log export ──────────────────────────────────────────────────

  it("export laisse une trace audit_log_admin (export_<dataset>)", async () => {
    await setup.admin.client.rpc("admin_export_dataset", {
      p_dataset: "annonces",
      p_from: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      p_to: new Date().toISOString(),
      p_pays: "CI",
    });
    const sb = adminClient();
    const { data } = await sb
      .from("audit_log_admin")
      .select("action, target_type")
      .eq("action", "export_annonces")
      .eq("target_type", "annonces")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(data?.[0]).toMatchObject({
      action: "export_annonces",
      target_type: "annonces",
    });
  });
});
