/**
 * Tests intégration end-to-end — Module Conversations.
 *
 * Couvre via PostgREST (RLS gateway + triggers DB + RPCs SECURITY DEFINER) :
 *   1. get_or_create_conversation : happy path Alice → Bob active
 *   2. get_or_create_conversation : idempotent (2e call retourne même id)
 *   3. get_or_create_conversation : Bob (vendeur) sur sa propre annonce → cannot_message_self
 *   4. get_or_create_conversation : annonce vendue → annonce_not_available
 *   5. INSERT message + trigger tg_conversation_last_message dénormalise preview
 *   6. INSERT message contenu interdit → bloqué par tg_messages_content_filter
 *   7. mark_messages_read : Alice's msgs is_read=true côté Bob, Bob's own remain
 *   8. RLS conv SELECT : Carol (tiers) ne voit pas la conv Alice-Bob
 *   9. RLS message SELECT : Carol ne voit aucun message
 *  10. RLS message INSERT bloqué pour Carol (non-participant)
 *  11. UPDATE message is_read OK / UPDATE contenu bloqué (column-level mig 74)
 *  12. is_my_account_active : suspendre Alice → INSERT message bloqué (mig 74)
 *  13. admin_soft_delete_message : message marqué is_deleted=true (admin only)
 *
 * Cf. docs/backend/conversations.md pour le module complet.
 * Migs couvertes : 22, 23, 24, 29, 35, 40, 57, 65, 74, 105.
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
  annonceActiveId: string;
  annonceVendueId: string;
}

async function getSetup(): Promise<Setup> {
  const ts = Date.now();

  const alice = await createTestUser({
    email: `alice-conv-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "ConvBuyer",
    pays: "CI",
    ville: "Abidjan",
  });
  const bob = await createTestUser({
    email: `bob-conv-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "ConvSeller",
    pays: "CI",
    ville: "Abidjan",
  });
  const carol = await createTestUser({
    email: `carol-conv-${ts}@niqo.test`,
    prenom: "Carol",
    nom: "ConvTiers",
    pays: "CI",
    ville: "Abidjan",
  });
  const diana = await createTestUser({
    email: `diana-conv-${ts}@niqo.test`,
    prenom: "Diana",
    nom: "ConvAdmin",
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

  // Bob crée 2 annonces (active + vendue)
  const { data: ann1, error: ann1Err } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      categorie_id: cat.id,
      titre: `iPhone test conv ${ts}`,
      description: "Vendu avec sa boîte, chargeur et coque. Test conv mig 22.",
      prix: 250000,
      photos: ["photo-conv1.jpg"],
      pays: "CI",
      ville: "Abidjan",
      etat: "bon",
      statut: "active",
    })
    .select("id")
    .single<{ id: string }>();
  if (ann1Err || !ann1) throw ann1Err ?? new Error("annonce1 setup failed");

  const { data: ann2, error: ann2Err } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      categorie_id: cat.id,
      titre: `Samsung test conv ${ts}`,
      description: "Très bon état, vendu avec accessoires. Test conv vendue.",
      prix: 350000,
      photos: ["photo-conv2.jpg"],
      pays: "CI",
      ville: "Abidjan",
      etat: "bon",
      statut: "active",
    })
    .select("id")
    .single<{ id: string }>();
  if (ann2Err || !ann2) throw ann2Err ?? new Error("annonce2 setup failed");

  // Force ann2 en vendue (bypass RLS via service_role)
  await admin.from("annonces").update({ statut: "vendue" }).eq("id", ann2.id);

  return {
    alice,
    bob,
    carol,
    diana,
    categorieNormale: cat.id,
    annonceActiveId: ann1.id,
    annonceVendueId: ann2.id,
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

describe("Conversations — create + RLS + RPCs + triggers (mig 22→105)", () => {
  it("1. get_or_create_conversation : happy path Alice → Bob active", async () => {
    const { data, error } = await setup.alice.client.rpc(
      "get_or_create_conversation",
      { p_annonce_id: setup.annonceActiveId },
    );

    expect(error).toBeNull();
    const result = data as { success: boolean; conversation?: { id: string } };
    expect(result.success).toBe(true);
    expect(result.conversation?.id).toBeTruthy();
  });

  it("2. get_or_create_conversation : idempotent (2e call → même id)", async () => {
    const { data: r1 } = await setup.alice.client.rpc(
      "get_or_create_conversation",
      { p_annonce_id: setup.annonceActiveId },
    );
    const { data: r2 } = await setup.alice.client.rpc(
      "get_or_create_conversation",
      { p_annonce_id: setup.annonceActiveId },
    );

    const id1 = (r1 as { conversation?: { id: string } }).conversation?.id;
    const id2 = (r2 as { conversation?: { id: string } }).conversation?.id;
    expect(id1).toBeTruthy();
    expect(id1).toBe(id2);
  });

  it("3. get_or_create_conversation : Bob (vendeur) sur sa propre annonce → cannot_message_self", async () => {
    const { data, error } = await setup.bob.client.rpc(
      "get_or_create_conversation",
      { p_annonce_id: setup.annonceActiveId },
    );

    expect(error).toBeNull();
    const result = data as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("cannot_message_self");
  });

  it("4. get_or_create_conversation : annonce vendue → annonce_not_available", async () => {
    const { data, error } = await setup.carol.client.rpc(
      "get_or_create_conversation",
      { p_annonce_id: setup.annonceVendueId },
    );

    expect(error).toBeNull();
    const result = data as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("annonce_not_available");
  });

  it("5. INSERT message + trigger tg_conversation_last_message dénormalise preview", async () => {
    // Récupère l'id conv Alice-Bob (créée en test 1)
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    // Alice envoie un message
    const { error: insErr } = await setup.alice.client.from("messages").insert({
      conversation_id: convId,
      expediteur_id: setup.alice.userId,
      contenu: "Bonjour Bob, ton iPhone est encore disponible ?",
      type: "texte",
    });
    expect(insErr).toBeNull();

    // Le trigger fn_update_conversation_last_message a dû propager
    const { data: conv } = await setup.alice.client
      .from("conversations")
      .select("last_message_preview, last_message_at")
      .eq("id", convId)
      .single<{ last_message_preview: string; last_message_at: string }>();

    expect(conv!.last_message_preview).toBe(
      "Bonjour Bob, ton iPhone est encore disponible ?",
    );
    expect(conv!.last_message_at).toBeTruthy();
  });

  it("6. INSERT message contenu interdit → bloqué par content filter (mig 29)", async () => {
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    const { error } = await setup.alice.client.from("messages").insert({
      conversation_id: convId,
      expediteur_id: setup.alice.userId,
      contenu: "je vends de la cocaine pure",
      type: "texte",
    });

    expect(error).not.toBeNull();
    // PostgreSQL raise "contenu_interdit" → PostgrestError code = 'P0001' ou message contient
    expect(error?.message.toLowerCase()).toContain("contenu_interdit");
  });

  it("7. mark_messages_read : Alice's msgs is_read=true côté Bob, Bob's own restent", async () => {
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    // Bob envoie un message
    await setup.bob.client.from("messages").insert({
      conversation_id: convId,
      expediteur_id: setup.bob.userId,
      contenu: "Salut Alice, oui dispo à Cocody",
      type: "texte",
    });

    // Bob appelle mark_messages_read
    const { error: rpcErr } = await setup.bob.client.rpc(
      "mark_messages_read",
      { p_conversation_id: convId },
    );
    expect(rpcErr).toBeNull();

    // Tous les msgs d'Alice sont is_read=true
    const { data: aliceMsgs } = await setup.bob.client
      .from("messages")
      .select("is_read")
      .eq("conversation_id", convId)
      .eq("expediteur_id", setup.alice.userId)
      .returns<{ is_read: boolean }[]>();
    expect(aliceMsgs!.length).toBeGreaterThan(0);
    expect(aliceMsgs!.every((m) => m.is_read === true)).toBe(true);

    // Les msgs de Bob lui-même restent (au moins 1 unread car on ne marque pas ses propres)
    const { data: bobMsgs } = await setup.bob.client
      .from("messages")
      .select("is_read")
      .eq("conversation_id", convId)
      .eq("expediteur_id", setup.bob.userId)
      .returns<{ is_read: boolean }[]>();
    expect(bobMsgs!.length).toBeGreaterThan(0);
    expect(bobMsgs!.some((m) => m.is_read === false)).toBe(true);
  });

  it("8. RLS conv SELECT : Carol (tiers) ne voit pas la conv Alice-Bob", async () => {
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    const { data: carolView } = await setup.carol.client
      .from("conversations")
      .select("id")
      .eq("id", convId);

    expect(carolView).toEqual([]);
  });

  it("9. RLS message SELECT : Carol ne voit aucun message", async () => {
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    const { data: carolMsgs } = await setup.carol.client
      .from("messages")
      .select("id")
      .eq("conversation_id", convId);

    expect(carolMsgs).toEqual([]);
  });

  it("10. RLS message INSERT bloqué pour Carol (non-participant)", async () => {
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    const { error } = await setup.carol.client.from("messages").insert({
      conversation_id: convId,
      expediteur_id: setup.carol.userId,
      contenu: "Spam intrus",
      type: "texte",
    });

    expect(error).not.toBeNull();
    // RLS violation → code 42501 ou message "new row violates row-level security policy"
    expect(error?.code === "42501" || /row-level security/.test(error?.message ?? "")).toBe(true);
  });

  it("11. UPDATE message is_read OK / UPDATE contenu bloqué (column-level grant mig 74)", async () => {
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    // Alice envoie un msg (qu'on va updater côté Bob)
    const { data: msgIns } = await setup.alice.client
      .from("messages")
      .insert({
        conversation_id: convId,
        expediteur_id: setup.alice.userId,
        contenu: "Message pour test update",
        type: "texte",
      })
      .select("id")
      .single<{ id: string }>();
    const msgId = msgIns!.id;

    // Bob UPDATE is_read=true → OK
    const { error: updReadErr } = await setup.bob.client
      .from("messages")
      .update({ is_read: true })
      .eq("id", msgId);
    expect(updReadErr).toBeNull();

    // Bob tente UPDATE contenu → bloqué (column-level REVOKE mig 74)
    const { error: updContenuErr } = await setup.bob.client
      .from("messages")
      .update({ contenu: "Altéré par Bob" })
      .eq("id", msgId);
    expect(updContenuErr).not.toBeNull();
    expect(updContenuErr?.code === "42501" || /permission denied/i.test(updContenuErr?.message ?? "")).toBe(true);
  });

  it("12. is_my_account_active : suspendre Alice → INSERT message bloqué (mig 74)", async () => {
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    const admin = adminClient();
    await admin.from("users").update({ is_active: false }).eq("id", setup.alice.userId);

    const { error } = await setup.alice.client.from("messages").insert({
      conversation_id: convId,
      expediteur_id: setup.alice.userId,
      contenu: "Message après suspension",
      type: "texte",
    });

    expect(error).not.toBeNull();
    // RLS WITH CHECK violation
    expect(error?.code === "42501" || /row-level security/.test(error?.message ?? "")).toBe(true);

    // Restore Alice
    await admin.from("users").update({ is_active: true }).eq("id", setup.alice.userId);
  });

  it("13. admin_soft_delete_message : Diana (admin) → is_deleted=true; non-admin bloqué", async () => {
    const { data: convData } = await setup.alice.client
      .from("conversations")
      .select("id")
      .eq("annonce_id", setup.annonceActiveId)
      .eq("acheteur_id", setup.alice.userId)
      .single<{ id: string }>();
    const convId = convData!.id;

    // Alice envoie un msg à supprimer
    const { data: msgIns } = await setup.alice.client
      .from("messages")
      .insert({
        conversation_id: convId,
        expediteur_id: setup.alice.userId,
        contenu: "Message à soft-delete",
        type: "texte",
      })
      .select("id")
      .single<{ id: string }>();
    const msgId = msgIns!.id;

    // Alice (non-admin) → ADMIN_REQUIRED
    const { error: aliceErr } = await setup.alice.client.rpc(
      "admin_soft_delete_message",
      { p_message_id: msgId },
    );
    expect(aliceErr).not.toBeNull();
    expect(aliceErr?.message).toMatch(/ADMIN_REQUIRED/);

    // Diana (admin) → OK
    const { error: dianaErr } = await setup.diana.client.rpc(
      "admin_soft_delete_message",
      { p_message_id: msgId },
    );
    expect(dianaErr).toBeNull();

    // Le msg a is_deleted=true (lu en service_role pour bypass)
    const admin = adminClient();
    const { data: msgPost } = await admin
      .from("messages")
      .select("is_deleted, contenu")
      .eq("id", msgId)
      .single<{ is_deleted: boolean; contenu: string }>();
    expect(msgPost!.is_deleted).toBe(true);
    expect(msgPost!.contenu).toBe("Message à soft-delete"); // contenu préservé
  });
});
