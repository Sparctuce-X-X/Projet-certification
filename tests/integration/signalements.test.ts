/**
 * Tests intégration end-to-end — Module Signalements (F08).
 *
 * Couvre via PostgREST (RLS gateway + triggers DB + RPCs SECURITY DEFINER) :
 *   1. submit_report happy path (target=annonce) → success=true
 *   2. submit_report : auto-signalement (target=utilisateur, target_id=auth.uid) → cannot_report_self
 *   3. submit_report : 2e call sur même cible → already_reported (UNIQUE)
 *   4. submit_report sur message target → success + auto-fill description (mig 27)
 *   5. RLS SELECT : Alice signaleur voit ses signalements, Bob ne voit pas le signalement contre lui
 *   6. RLS INSERT : forge signaleur_id=autre → PostgrestError (RLS WITH CHECK)
 *   7. is_my_account_active : suspendre Alice via service_role → submit_report bloqué
 *      (via INSERT direct car submit_report ne check pas is_active — c'est la RLS qui catch)
 *   8. create_signalement_post_rdv happy : Alice sur RDV passé confirmé → success
 *   9. create_signalement_post_rdv : Carol non-participant → not_participant
 *  10. tg_signalement_check_threshold : service_role mark traite → score_abus++ sur cible
 *  11. admin_treat_signalement : non-admin (Alice) → PostgrestError ADMIN_REQUIRED
 *  12. admin_revert_annonce_to_active : Diana sur ann en_cours → success + statut=active
 *  13. get_my_rdv_signalement_status : Alice signaleur → has_signalement=true,
 *      Bob participant non-signaleur → has_signalement=false (anti-leak mig 98)
 *
 * Cf. docs/backend/signalements.md pour le module complet.
 * Migs couvertes : 25, 26, 27, 28, 56, 57, 74, 91, 95, 96, 98, 103.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, createTestUser, cleanupUsers } from "./helpers/supabase";

interface Setup {
  alice: { client: SupabaseClient; userId: string };
  bob: { client: SupabaseClient; userId: string };
  carol: { client: SupabaseClient; userId: string };
  diana: { client: SupabaseClient; userId: string }; // admin
  categorieNormale: string;
  annonceActiveId: string; // ann1 — test signal annonce direct
  annonceEnCoursId: string; // ann2 — test rdv_post + revert
  convId: string; // conv Alice↔Bob avec RDV passé confirmé (sur ann2)
  bobMsgId: string; // message de Bob dans la conv (target=message)
}

async function getSetup(): Promise<Setup> {
  const ts = Date.now();

  const alice = await createTestUser({
    email: `alice-sig-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "SigBuyer",
    pays: "CI",
    ville: "Abidjan",
  });
  const bob = await createTestUser({
    email: `bob-sig-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "SigSeller",
    pays: "CI",
    ville: "Abidjan",
  });
  const carol = await createTestUser({
    email: `carol-sig-${ts}@niqo.test`,
    prenom: "Carol",
    nom: "SigTiers",
    pays: "CI",
    ville: "Abidjan",
  });
  const diana = await createTestUser({
    email: `diana-sig-${ts}@niqo.test`,
    prenom: "Diana",
    nom: "SigAdmin",
    pays: "CI",
    ville: "Abidjan",
    isAdmin: true,
  });

  const admin = adminClient();
  const { data: cat, error: catErr } = await admin
    .from("categories")
    .select("id, nom")
    .neq("nom", "Immobilier")
    .eq("is_active", true)
    .order("ordre", { ascending: true })
    .limit(1)
    .single<{ id: string; nom: string }>();
  if (catErr || !cat) throw catErr ?? new Error("categorie setup failed");

  // Bob crée 2 annonces (active + en_cours)
  const { data: ann1, error: ann1Err } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      categorie_id: cat.id,
      titre: `iPhone signal test ${ts}`,
      description: "Test signal annonce direct. Mig 25-26-27.",
      prix: 250000,
      photos: ["sig-p1.jpg"],
      pays: "CI",
      ville: "Abidjan",
      etat: "bon",
      statut: "active",
    })
    .select("id")
    .single<{ id: string }>();
  if (ann1Err || !ann1) throw ann1Err ?? new Error("ann1 setup failed");

  const { data: ann2, error: ann2Err } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      categorie_id: cat.id,
      titre: `Samsung signal test ${ts}`,
      description: "Test signal rdv_post + revert. Mig 91-95.",
      prix: 350000,
      photos: ["sig-p2.jpg"],
      pays: "CI",
      ville: "Abidjan",
      etat: "bon",
      statut: "active",
    })
    .select("id")
    .single<{ id: string }>();
  if (ann2Err || !ann2) throw ann2Err ?? new Error("ann2 setup failed");

  // Force ann2 en_cours (RLS owner_update exige active — bypass via service_role)
  await admin.from("annonces").update({ statut: "en_cours" }).eq("id", ann2.id);

  // Conv Alice↔Bob sur ann2 — créée via RPC pour respecter constraint puis
  // patchée par service_role pour set rdv_date + rdv_confirme_at dans le passé
  const { data: convResp, error: convErr } = await alice.client.rpc(
    "get_or_create_conversation",
    { p_annonce_id: ann2.id },
  );
  // ann2 est en_cours → get_or_create accepte
  if (convErr) throw convErr;
  const convId = (convResp as { conversation?: { id: string } }).conversation
    ?.id;
  if (!convId) throw new Error("conv setup failed: no id returned");

  // Patch RDV (service_role bypass REVOKE UPDATE conversations mig 74)
  const past2d = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  const past3d = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
  await admin
    .from("conversations")
    .update({
      rdv_date: past2d,
      rdv_confirme_at: past3d,
      rdv_lieu: "Cocody Centre commercial",
    })
    .eq("id", convId);

  // Bob envoie 1 message texte (cible 'message' pour test 4)
  const { data: msg, error: msgErr } = await admin
    .from("messages")
    .insert({
      conversation_id: convId,
      expediteur_id: bob.userId,
      contenu: "Salut Alice, oui dispo a Cocody",
      type: "texte",
    })
    .select("id")
    .single<{ id: string }>();
  if (msgErr || !msg) throw msgErr ?? new Error("msg setup failed");

  return {
    alice,
    bob,
    carol,
    diana,
    categorieNormale: cat.id,
    annonceActiveId: ann1.id,
    annonceEnCoursId: ann2.id,
    convId,
    bobMsgId: msg.id,
  };
}

let setup: Setup;
const cleanup: string[] = [];

beforeAll(async () => {
  setup = await getSetup();
  cleanup.push(
    setup.alice.userId,
    setup.bob.userId,
    setup.carol.userId,
    setup.diana.userId,
  );
});

afterAll(async () => {
  await cleanupUsers(cleanup);
});

describe("Signalements — RPCs + triggers + RLS (mig 25→103)", () => {
  it("1. submit_report happy path (Alice → annonce Bob) → success=true", async () => {
    const { data, error } = await setup.alice.client.rpc("submit_report", {
      p_target_type: "annonce",
      p_target_id: setup.annonceActiveId,
      p_motif: "Arnaque suspectee",
    });

    expect(error).toBeNull();
    const result = data as { success: boolean };
    expect(result.success).toBe(true);
  });

  it("2. submit_report : auto-signalement (target=utilisateur, target_id=auth.uid) → cannot_report_self", async () => {
    const { data, error } = await setup.alice.client.rpc("submit_report", {
      p_target_type: "utilisateur",
      p_target_id: setup.alice.userId,
      p_motif: "Self",
    });

    expect(error).toBeNull();
    const result = data as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("cannot_report_self");
  });

  it("3. submit_report : 2e call sur même cible → already_reported", async () => {
    // Test 1 a déjà signalé Alice→annonce Bob. Retry → UNIQUE bloque.
    const { data, error } = await setup.alice.client.rpc("submit_report", {
      p_target_type: "annonce",
      p_target_id: setup.annonceActiveId,
      p_motif: "Re-signal",
    });

    expect(error).toBeNull();
    const result = data as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("already_reported");
  });

  it("4. submit_report sur message target → success + auto-fill description (mig 27)", async () => {
    const { data, error } = await setup.carol.client.rpc("submit_report", {
      p_target_type: "message",
      p_target_id: setup.bobMsgId,
      p_motif: "Harcelement",
      // p_description: null → auto-fill devrait poser "[Message] Salut Alice..."
    });

    expect(error).toBeNull();
    const result = data as { success: boolean };
    expect(result.success).toBe(true);

    // Vérif côté admin que la description a été auto-remplie
    const admin = adminClient();
    const { data: sig } = await admin
      .from("signalements")
      .select("description")
      .eq("target_type", "message")
      .eq("target_id", setup.bobMsgId)
      .eq("signaleur_id", setup.carol.userId)
      .single<{ description: string }>();
    expect(sig?.description).toMatch(/^\[Message\]/);
  });

  it("5. RLS SELECT : Alice signaleur voit ses signalements, Bob ne voit pas le signalement contre lui", async () => {
    // Alice voit son signalement annonce (test 1)
    const { data: aliceView } = await setup.alice.client
      .from("signalements")
      .select("id")
      .eq("target_type", "annonce")
      .eq("target_id", setup.annonceActiveId)
      .returns<{ id: string }[]>();
    expect(aliceView!.length).toBeGreaterThanOrEqual(1);

    // Bob (cible) ne voit AUCUN signalement (policy signalements_select_own filtre signaleur_id)
    const { data: bobView } = await setup.bob.client
      .from("signalements")
      .select("id")
      .eq("target_type", "annonce")
      .eq("target_id", setup.annonceActiveId)
      .returns<{ id: string }[]>();
    expect(bobView!.length).toBe(0);
  });

  it("6. RLS INSERT : forge signaleur_id=Alice depuis Carol → bloqué", async () => {
    const { error } = await setup.carol.client.from("signalements").insert({
      target_type: "utilisateur",
      target_id: setup.bob.userId,
      signaleur_id: setup.alice.userId, // FORGE
      motif: "Forged",
    });

    expect(error).not.toBeNull();
    // RLS WITH CHECK violation → code 42501 ou message contient "row-level security"
    expect(
      error?.message.toLowerCase().includes("row-level security") ||
        error?.code === "42501",
    ).toBe(true);
  });

  it("7. is_my_account_active : suspendre Alice → INSERT signalement direct bloqué (mig 74)", async () => {
    const admin = adminClient();

    // Suspend Alice
    await admin
      .from("users")
      .update({ is_active: false })
      .eq("id", setup.alice.userId);

    // Alice tente INSERT direct (submit_report ne check pas is_active mais la RLS si)
    const { error } = await setup.alice.client.from("signalements").insert({
      target_type: "utilisateur",
      target_id: setup.diana.userId,
      signaleur_id: setup.alice.userId,
      motif: "After suspend",
    });

    expect(error).not.toBeNull();
    expect(
      error?.message.toLowerCase().includes("row-level security") ||
        error?.code === "42501",
    ).toBe(true);

    // Restore Alice
    await admin
      .from("users")
      .update({ is_active: true })
      .eq("id", setup.alice.userId);
  });

  it("8. create_signalement_post_rdv happy : Alice sur RDV passé confirmé → success + role acheteur", async () => {
    const { data, error } = await setup.alice.client.rpc(
      "create_signalement_post_rdv",
      {
        p_conversation_id: setup.convId,
        p_motif_categorie: "no_show",
        p_description: null,
      },
    );

    expect(error).toBeNull();
    const result = data as { success: boolean };
    expect(result.success).toBe(true);

    // Vérif snapshot + role_signaleur côté admin
    const admin = adminClient();
    const { data: sig } = await admin
      .from("signalements")
      .select("rdv_snapshot, role_signaleur, motif_categorie")
      .eq("target_type", "rdv_post")
      .eq("target_id", setup.convId)
      .eq("signaleur_id", setup.alice.userId)
      .single<{
        rdv_snapshot: Record<string, unknown>;
        role_signaleur: string;
        motif_categorie: string;
      }>();
    expect(sig?.rdv_snapshot).toBeTruthy();
    expect(sig?.rdv_snapshot.conversation_id).toBe(setup.convId);
    expect(sig?.role_signaleur).toBe("acheteur");
    expect(sig?.motif_categorie).toBe("no_show");
  });

  it("9. create_signalement_post_rdv : Carol non-participant → not_participant", async () => {
    const { data, error } = await setup.carol.client.rpc(
      "create_signalement_post_rdv",
      {
        p_conversation_id: setup.convId,
        p_motif_categorie: "no_show",
      },
    );

    expect(error).toBeNull();
    const result = data as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("not_participant");
  });

  it("10. tg_signalement_check_threshold : mark traite via admin → score_abus Bob++", async () => {
    const admin = adminClient();

    // Reset Bob.score_abus à un baseline
    await admin
      .from("users")
      .update({ score_abus: 0, is_active: true })
      .eq("id", setup.bob.userId);

    // Récupère le signalement annonce Bob (test 1) en_attente
    const { data: sig } = await admin
      .from("signalements")
      .select("id")
      .eq("target_type", "annonce")
      .eq("target_id", setup.annonceActiveId)
      .eq("signaleur_id", setup.alice.userId)
      .single<{ id: string }>();

    // Admin (service_role) UPDATE statut → 'traite' (simule action admin Dashboard)
    await admin
      .from("signalements")
      .update({ statut: "traite" })
      .eq("id", sig!.id);

    // Vérif score_abus Bob > 0 (le trigger a fire)
    const { data: bob } = await admin
      .from("users")
      .select("score_abus")
      .eq("id", setup.bob.userId)
      .single<{ score_abus: number }>();

    expect(bob!.score_abus).toBeGreaterThanOrEqual(1);
  });

  it("11. admin_treat_signalement : non-admin → ADMIN_REQUIRED (raise)", async () => {
    // Récupère un signalement encore en_attente
    const admin = adminClient();
    const { data: sig } = await admin
      .from("signalements")
      .select("id")
      .eq("statut", "en_attente")
      .limit(1)
      .single<{ id: string }>();

    if (!sig) {
      // Si aucun en_attente, on en crée un quickly
      await setup.diana.client.rpc("submit_report", {
        p_target_type: "utilisateur",
        p_target_id: setup.carol.userId,
        p_motif: "Test admin gate",
      });
      const { data: sig2 } = await admin
        .from("signalements")
        .select("id")
        .eq("statut", "en_attente")
        .limit(1)
        .single<{ id: string }>();
      sig!.id = sig2!.id;
    }

    // Alice (non-admin) tente admin_treat_signalement → raise
    const { error } = await setup.alice.client.rpc("admin_treat_signalement", {
      p_signalement_id: sig!.id,
      p_action: "traite",
    });

    expect(error).not.toBeNull();
    expect(error?.message.toUpperCase()).toContain("ADMIN_REQUIRED");
  });

  it("12. admin_revert_annonce_to_active : Diana sur ann en_cours → success + statut=active", async () => {
    const admin = adminClient();

    // Setup : reset ann2 en en_cours (peut avoir été suspendue par triggers précédents)
    await admin
      .from("annonces")
      .update({ statut: "en_cours" })
      .eq("id", setup.annonceEnCoursId);

    const { data, error } = await setup.diana.client.rpc(
      "admin_revert_annonce_to_active",
      { p_annonce_id: setup.annonceEnCoursId },
    );

    expect(error).toBeNull();
    const result = data as { success: boolean };
    expect(result.success).toBe(true);

    // Vérif statut effectif
    const { data: ann } = await admin
      .from("annonces")
      .select("statut")
      .eq("id", setup.annonceEnCoursId)
      .single<{ statut: string }>();
    expect(ann!.statut).toBe("active");

    // Vérif audit log posé (mig 103)
    const { data: audit } = await admin
      .from("audit_log_admin")
      .select("id")
      .eq("action", "annonce_reverted_active")
      .eq("admin_id", setup.diana.userId)
      .eq("target_id", setup.annonceEnCoursId)
      .returns<{ id: string }[]>();
    expect(audit!.length).toBeGreaterThanOrEqual(1);
  });

  it("13. get_my_rdv_signalement_status : anti-leak (Alice signaleur OK, Bob participant non-signaleur → false)", async () => {
    // Alice (signaleur dans test 8) voit son verdict
    const { data: aliceData, error: aliceErr } = await setup.alice.client.rpc(
      "get_my_rdv_signalement_status",
      { p_conversation_id: setup.convId },
    );
    expect(aliceErr).toBeNull();
    const aliceResult = aliceData as { has_signalement: boolean };
    expect(aliceResult.has_signalement).toBe(true);

    // Bob (autre partie, non-signaleur sur cette conv) → has_signalement:false (anti-leak)
    const { data: bobData, error: bobErr } = await setup.bob.client.rpc(
      "get_my_rdv_signalement_status",
      { p_conversation_id: setup.convId },
    );
    expect(bobErr).toBeNull();
    const bobResult = bobData as { has_signalement: boolean };
    expect(bobResult.has_signalement).toBe(false);

    // Carol (tiers non-participant) → has_signalement:false (gate participant)
    const { data: carolData, error: carolErr } = await setup.carol.client.rpc(
      "get_my_rdv_signalement_status",
      { p_conversation_id: setup.convId },
    );
    expect(carolErr).toBeNull();
    const carolResult = carolData as { has_signalement: boolean };
    expect(carolResult.has_signalement).toBe(false);
  });
});
