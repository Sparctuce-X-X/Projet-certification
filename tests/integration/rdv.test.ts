/**
 * Tests intégration end-to-end — Module RDV (F05).
 *
 * Couvre :
 *   - Flow complet 2 sessions : Alice (acheteur) propose, Bob (vendeur) confirme
 *   - Trigger lifecycle : annonce active → en_cours après confirm
 *   - RLS annonces_buyer_select_via_conv (mig 41) : acheteur lit annonce en_cours
 *   - cancel_rdv revert annonce → active
 *   - cannot_self_confirm + not_participant cross-session
 *   - mark_annonce_vendue : exige RDV passé (vérifié via override admin)
 *
 * Cf. docs/backend/rdv.md pour le module complet.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanupUsers, createTestUser } from "./helpers/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

interface Setup {
  alice: { client: SupabaseClient; userId: string };
  bob: { client: SupabaseClient; userId: string };
  annonceId: string;
  conversationId: string;
}

async function setupRdvFixtures(): Promise<Setup> {
  const ts = Date.now();
  const alice = await createTestUser({
    email: `alice-rdv-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "Buyer",
    pays: "CI",
    ville: "Abidjan",
  });
  const bob = await createTestUser({
    email: `bob-rdv-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "Seller",
    pays: "CI",
    ville: "Abidjan",
  });

  const admin = adminClient();
  const { data: cat } = await admin
    .from("categories")
    .select("id")
    .order("ordre", { ascending: true })
    .limit(1)
    .single<{ id: string }>();
  if (!cat) throw new Error("No category seeded");

  const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
  const { data: annonce, error: annonceErr } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      categorie_id: cat.id,
      titre: "iPhone 12 Pro 128 Go bon état",
      description: "Vendu avec sa boîte d'origine, chargeur et coque.",
      prix: 250000,
      photos: ["photo1.jpg"],
      pays: "CI",
      ville: "Abidjan",
      expires_at: expiresAt,
      statut: "active",
    })
    .select("id")
    .single<{ id: string }>();
  if (annonceErr || !annonce) throw annonceErr ?? new Error("annonce insert failed");

  // Conversation Alice (acheteuse) ↔ Bob (vendeur) sur l'annonce
  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .insert({
      annonce_id: annonce.id,
      acheteur_id: alice.userId,
      vendeur_id: bob.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (convErr || !conv) throw convErr ?? new Error("conv insert failed");

  return {
    alice: { client: alice.client, userId: alice.userId },
    bob: { client: bob.client, userId: bob.userId },
    annonceId: annonce.id,
    conversationId: conv.id,
  };
}

describe("Module RDV — intégration", () => {
  let setup: Setup;
  const userIdsToCleanup: string[] = [];

  beforeAll(async () => {
    setup = await setupRdvFixtures();
    userIdsToCleanup.push(setup.alice.userId, setup.bob.userId);
  });

  afterAll(async () => {
    await cleanupUsers(userIdsToCleanup);
  });

  it("propose_rdv (Alice) → confirm_rdv (Bob) → annonce passe en_cours (trigger lifecycle)", async () => {
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();

    const { data: proposeData, error: proposeErr } = await setup.alice.client.rpc("propose_rdv", {
      p_conversation_id: setup.conversationId,
      p_lieu: "Marché de Cocody, devant la pharmacie",
      p_date: future,
    });
    expect(proposeErr).toBeNull();
    expect((proposeData as { success: boolean }).success).toBe(true);

    // Bob confirme (l'autre partie)
    const { data: confirmData, error: confirmErr } = await setup.bob.client.rpc("confirm_rdv", {
      p_conversation_id: setup.conversationId,
    });
    expect(confirmErr).toBeNull();
    expect((confirmData as { success: boolean }).success).toBe(true);

    // Vérification trigger lifecycle : annonce → en_cours
    const admin = adminClient();
    const { data: annonceRow } = await admin
      .from("annonces")
      .select("statut")
      .eq("id", setup.annonceId)
      .single<{ statut: string }>();
    expect(annonceRow?.statut).toBe("en_cours");
  });

  it("RLS annonces_buyer_select_via_conv (mig 41) — Alice voit l'annonce en_cours via PostgREST", async () => {
    // Sous JWT Alice (RLS appliquée), elle doit voir l'annonce malgré statut='en_cours'
    // (la policy publique annonces_read_active filtre statut='active').
    const { data: rows, error } = await setup.alice.client
      .from("annonces")
      .select("id, statut")
      .eq("id", setup.annonceId);

    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows![0]!.statut).toBe("en_cours");
  });

  it("cannot_self_confirm — Alice (proposeuse) ne peut pas re-confirmer sa propre prop", async () => {
    // L'état actuel est : confirmé par Bob. On annule, Alice re-propose,
    // puis Alice tente de confirmer elle-même.
    await setup.alice.client.rpc("cancel_rdv", { p_conversation_id: setup.conversationId });

    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    await setup.alice.client.rpc("propose_rdv", {
      p_conversation_id: setup.conversationId,
      p_lieu: "Plateau",
      p_date: future,
    });

    const { data, error } = await setup.alice.client.rpc("confirm_rdv", {
      p_conversation_id: setup.conversationId,
    });
    expect(error).toBeNull();
    expect((data as { success: boolean; error?: string }).success).toBe(false);
    expect((data as { error?: string }).error).toBe("cannot_self_confirm");
  });

  it("not_participant — un user tiers ne peut ni proposer ni confirmer", async () => {
    const charlie = await createTestUser({
      email: `charlie-rdv-${Date.now()}@niqo.test`,
      prenom: "Charlie",
      nom: "Tiers",
    });
    userIdsToCleanup.push(charlie.userId);

    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();

    const { data: proposeData } = await charlie.client.rpc("propose_rdv", {
      p_conversation_id: setup.conversationId,
      p_lieu: "Quelque part",
      p_date: future,
    });
    expect((proposeData as { error?: string }).error).toBe("not_participant");

    const { data: confirmData } = await charlie.client.rpc("confirm_rdv", {
      p_conversation_id: setup.conversationId,
    });
    expect((confirmData as { error?: string }).error).toBe("not_participant");
  });

  it("cancel_rdv revert annonce → active si plus aucun RDV confirmé (trigger lifecycle)", async () => {
    // À ce stade : Alice a re-proposé, mais pas encore confirmé. On confirme
    // par Bob pour repasser en 'en_cours', puis on annule et on vérifie revert.
    const { data: confirmData } = await setup.bob.client.rpc("confirm_rdv", {
      p_conversation_id: setup.conversationId,
    });
    expect((confirmData as { success: boolean }).success).toBe(true);

    const admin = adminClient();
    const { data: rowEnCours } = await admin
      .from("annonces").select("statut").eq("id", setup.annonceId).single<{ statut: string }>();
    expect(rowEnCours?.statut).toBe("en_cours");

    // Annulation
    const { data: cancelData } = await setup.alice.client.rpc("cancel_rdv", {
      p_conversation_id: setup.conversationId,
    });
    expect((cancelData as { success: boolean }).success).toBe(true);

    const { data: rowActive } = await admin
      .from("annonces").select("statut").eq("id", setup.annonceId).single<{ statut: string }>();
    expect(rowActive?.statut).toBe("active");
  });

  it("mark_annonce_vendue — exige rencontre confirmée par les 2 (no_meeting_confirmed sinon, mig 86)", async () => {
    // 1er essai : sans rencontre confirmée → no_meeting_confirmed
    const { data: failData } = await setup.bob.client.rpc("mark_annonce_vendue", {
      p_annonce_id: setup.annonceId,
    });
    expect((failData as { error?: string }).error).toBe("no_meeting_confirmed");

    // Re-propose + confirm + override date au passé via admin
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    await setup.alice.client.rpc("propose_rdv", {
      p_conversation_id: setup.conversationId,
      p_lieu: "Marché Treichville",
      p_date: future,
    });
    await setup.bob.client.rpc("confirm_rdv", { p_conversation_id: setup.conversationId });

    const admin = adminClient();
    await admin
      .from("conversations")
      .update({ rdv_date: new Date(Date.now() - 24 * 3600 * 1000).toISOString() })
      .eq("id", setup.conversationId);

    // Toujours bloqué tant que personne n'a confirmé la rencontre
    const { data: stillBlocked } = await setup.bob.client.rpc("mark_annonce_vendue", {
      p_annonce_id: setup.annonceId,
    });
    expect((stillBlocked as { error?: string }).error).toBe("no_meeting_confirmed");

    // Mig 86 : les 2 parties confirment la rencontre via confirm_rencontre
    await setup.alice.client.rpc("confirm_rencontre", {
      p_conversation_id: setup.conversationId,
      p_rencontre: true,
    });
    await setup.bob.client.rpc("confirm_rencontre", {
      p_conversation_id: setup.conversationId,
      p_rencontre: true,
    });

    // mark_annonce_vendue doit passer maintenant
    const { data: vendueData } = await setup.bob.client.rpc("mark_annonce_vendue", {
      p_annonce_id: setup.annonceId,
    });
    expect((vendueData as { success: boolean }).success).toBe(true);

    const { data: rowVendue } = await admin
      .from("annonces").select("statut").eq("id", setup.annonceId).single<{ statut: string }>();
    expect(rowVendue?.statut).toBe("vendue");
  });

  it("not_owner — Alice (acheteuse) ne peut pas mark_annonce_vendue", async () => {
    // Reset pour pouvoir tester (vendue → invalid_state sinon)
    const admin = adminClient();
    await admin.from("annonces").update({ statut: "active" }).eq("id", setup.annonceId);

    const { data } = await setup.alice.client.rpc("mark_annonce_vendue", {
      p_annonce_id: setup.annonceId,
    });
    expect((data as { error?: string }).error).toBe("not_owner");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RDV trust v2 — extensions (migs 91, 92, 93)
// ─────────────────────────────────────────────────────────────────────────────

describe("RDV trust v2 (migs 91, 92, 93)", () => {
  let setup: Setup;

  beforeAll(async () => {
    setup = await setupRdvFixtures();
    // Setup RDV passé confirmé pour ces tests
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    await setup.alice.client.rpc("propose_rdv", {
      p_conversation_id: setup.conversationId,
      p_lieu: "Marché Treichville",
      p_date: future,
    });
    await setup.bob.client.rpc("confirm_rdv", { p_conversation_id: setup.conversationId });

    // Admin override : RDV passé
    const admin = adminClient();
    await admin
      .from("conversations")
      .update({ rdv_date: new Date(Date.now() - 24 * 3600 * 1000).toISOString() })
      .eq("id", setup.conversationId);
  });

  afterAll(async () => {
    if (setup) {
      await cleanupUsers([setup.alice.userId, setup.bob.userId]);
    }
  });

  it("mig 91 — create_signalement_post_rdv (Alice signale Bob no_show)", async () => {
    const { data } = await setup.alice.client.rpc("create_signalement_post_rdv", {
      p_conversation_id: setup.conversationId,
      p_motif_categorie: "no_show",
    });
    expect((data as { success: boolean }).success).toBe(true);

    // Vérif insert + champs typés
    const admin = adminClient();
    const { data: sig } = await admin
      .from("signalements")
      .select("target_type, target_id, motif_categorie, role_signaleur, rdv_snapshot")
      .eq("target_id", setup.conversationId)
      .eq("signaleur_id", setup.alice.userId)
      .single<{
        target_type: string;
        target_id: string;
        motif_categorie: string;
        role_signaleur: string;
        rdv_snapshot: { annonce_id: string; vendeur_id: string };
      }>();

    expect(sig?.target_type).toBe("rdv_post");
    expect(sig?.motif_categorie).toBe("no_show");
    expect(sig?.role_signaleur).toBe("acheteur");
    expect(sig?.rdv_snapshot?.annonce_id).toBe(setup.annonceId);
    expect(sig?.rdv_snapshot?.vendeur_id).toBe(setup.bob.userId);
  });

  it("mig 91 — anti-doublon : 2e tentative renvoie already_reported", async () => {
    const { data } = await setup.alice.client.rpc("create_signalement_post_rdv", {
      p_conversation_id: setup.conversationId,
      p_motif_categorie: "no_show",
    });
    expect((data as { error?: string }).error).toBe("already_reported");
  });

  it("mig 92 — add_rencontre_photo + RLS anti-revanche (Bob ne voit pas la photo d'Alice)", async () => {
    const photoPath = `${setup.conversationId}/${setup.alice.userId}/test-photo.jpg`;

    // Mig 121 : add_rencontre_photo gate `not_disputed` — on doit forcer un
    // état (true, false) avant la RPC, puis reset à NULL/NULL pour ne pas
    // casser le test mig 93 suivant qui attend "ni Alice ni Bob n'ont répondu".
    const admin = adminClient();
    await admin
      .from("conversations")
      .update({ rencontre_acheteur: true, rencontre_vendeur: false })
      .eq("id", setup.conversationId);

    // Alice ajoute une photo (pas d'upload Storage réel — on insère juste la ligne via RPC)
    // Note : la RPC vérifie le path matche {conv}/{uid}/. On bypass le real upload.
    const { data } = await setup.alice.client.rpc("add_rencontre_photo", {
      p_conversation_id: setup.conversationId,
      p_storage_path: photoPath,
    });
    expect((data as { success: boolean }).success).toBe(true);

    // Alice voit sa propre photo (RLS auteur SELECT own)
    const { data: aliceView } = await setup.alice.client
      .from("rencontre_photos")
      .select("id, storage_path")
      .eq("conversation_id", setup.conversationId);
    expect(aliceView?.length).toBeGreaterThan(0);

    // Bob NE doit PAS voir la photo d'Alice (anti-revanche)
    const { data: bobView } = await setup.bob.client
      .from("rencontre_photos")
      .select("id, storage_path")
      .eq("conversation_id", setup.conversationId);
    expect(bobView ?? []).toHaveLength(0);

    // Reset : remet rencontre_* à NULL pour que mig 93 (get_pending_user_actions
    // → 'rencontre' pour Bob) voie un RDV non-répondu.
    await admin
      .from("conversations")
      .update({ rencontre_acheteur: null, rencontre_vendeur: null })
      .eq("id", setup.conversationId);
  });

  it("mig 92 — invalid_path : uid du path ne match pas auth.uid", async () => {
    const wrongPath = `${setup.conversationId}/${setup.bob.userId}/photo.jpg`;
    const { data } = await setup.alice.client.rpc("add_rencontre_photo", {
      p_conversation_id: setup.conversationId,
      p_storage_path: wrongPath,
    });
    expect((data as { error?: string }).error).toBe("invalid_path");
  });

  it("mig 93 — get_pending_user_actions retourne 'rencontre' pour Bob (n'a pas répondu)", async () => {
    // À ce point : RDV passé confirmé, ni Alice ni Bob n'ont répondu Oui/Non
    // → les 2 doivent voir 'rencontre'
    const { data: bobActions } = await setup.bob.client.rpc("get_pending_user_actions");
    const actions = (bobActions ?? []) as Array<{ type: string; conversation_id: string }>;
    const found = actions.find((a) => a.conversation_id === setup.conversationId);
    expect(found?.type).toBe("rencontre");
  });

  it("mig 93 — après met (les 2 confirment), Bob voit 'mark_vendue' (annonce en_cours)", async () => {
    // Alice et Bob confirment la rencontre
    await setup.alice.client.rpc("confirm_rencontre", {
      p_conversation_id: setup.conversationId,
      p_rencontre: true,
    });
    await setup.bob.client.rpc("confirm_rencontre", {
      p_conversation_id: setup.conversationId,
      p_rencontre: true,
    });

    // Bob (vendeur) doit voir mark_vendue (priority 3) en première position
    const { data: bobActions } = await setup.bob.client.rpc("get_pending_user_actions");
    const actions = (bobActions ?? []) as Array<{
      type: string;
      conversation_id: string;
      priority: number;
    }>;
    const sorted = actions
      .filter((a) => a.conversation_id === setup.conversationId)
      .sort((a, b) => a.priority - b.priority);
    expect(sorted[0]?.type).toBe("mark_vendue");
  });
});
