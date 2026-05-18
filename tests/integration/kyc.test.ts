/**
 * Tests intégration end-to-end — Module KYC (vérification d'identité, F07).
 *
 * Couvre :
 *   - submit_verification : happy path Alice via PostgREST + RLS gateway
 *   - submit_verification gates : INVALID_PAIEMENT (other user), PAIEMENT_ALREADY_USED,
 *     INVALID_PATH_OWNERSHIP, INVALID_CONSENT_VERSION
 *   - admin_validate_verification : happy path approve → badge users.is_verified=true
 *   - Anti-fraude CNI (mig 85) : Bob avec même numero → CNI_ALREADY_USED
 *   - RLS verifications_identite : Bob ne voit pas la verif d'Alice via PostgREST
 *   - Reject flow : reject_reason persisté + badge reste false
 *   - submit_verification multi-user : Bob soumet OK après Alice
 *
 * Cf. docs/backend/kyc.md pour le module complet.
 * Migs couvertes : 43, 45, 47, 50, 55, 85, 103.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  adminClient,
  cleanupUsers,
  createTestUser,
} from "./helpers/supabase";

/**
 * CNI unique par run pour éviter les collisions UNIQUE INDEX si le cleanup
 * d'un run précédent a échoué (cf. issue trigger `trg_purge_cni_storage`
 * bloqué par `storage.protect_objects_delete` — détaillé docs/backend/kyc.md
 * §Known issues).
 */
const TEST_CNI_ALICE = `CI${Date.now().toString().slice(-10)}A`;

interface Setup {
  alice: { client: SupabaseClient; userId: string };
  bob: { client: SupabaseClient; userId: string };
  dom: { client: SupabaseClient; userId: string };
  /** Paiement completed d'Alice (consommable par submit_verification) */
  paiementAlice: string;
  /** Paiement completed de Bob (pour anti-fraude) */
  paiementBob: string;
  /** Paiement completed boost d'Alice (gate INVALID_PAIEMENT) */
  paiementAliceBoost: string;
}

async function setupKycFixtures(): Promise<Setup> {
  const ts = Date.now();

  const alice = await createTestUser({
    email: `alice-kyc-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "Kyc",
    pays: "CI",
    ville: "Abidjan",
  });
  const bob = await createTestUser({
    email: `bob-kyc-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "Kyc",
    pays: "CI",
    ville: "Abidjan",
  });
  const dom = await createTestUser({
    email: `dom-kyc-${ts}@niqo.test`,
    prenom: "Dom",
    nom: "Admin",
    pays: "CI",
    ville: "Abidjan",
    isAdmin: true,
  });

  const admin = adminClient();

  // 3 paiements completed pour les fixtures
  const { data: pAlice, error: errAlice } = await admin
    .from("paiements_niqo")
    .insert({
      user_id: alice.userId,
      type: "verification",
      montant_fcfa: 1000,
      statut: "completed",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (errAlice || !pAlice) throw errAlice ?? new Error("paiement alice");

  const { data: pBob, error: errBob } = await admin
    .from("paiements_niqo")
    .insert({
      user_id: bob.userId,
      type: "verification",
      montant_fcfa: 1000,
      statut: "completed",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (errBob || !pBob) throw errBob ?? new Error("paiement bob");

  const { data: pAliceBoost, error: errAliceBoost } = await admin
    .from("paiements_niqo")
    .insert({
      user_id: alice.userId,
      type: "boost",
      montant_fcfa: 1000,
      statut: "completed",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (errAliceBoost || !pAliceBoost) throw errAliceBoost ?? new Error("paiement boost");

  return {
    alice: { client: alice.client, userId: alice.userId },
    bob: { client: bob.client, userId: bob.userId },
    dom: { client: dom.client, userId: dom.userId },
    paiementAlice: pAlice.id,
    paiementBob: pBob.id,
    paiementAliceBoost: pAliceBoost.id,
  };
}

describe("Module KYC — intégration", () => {
  let setup: Setup;
  const userIdsToCleanup: string[] = [];

  beforeAll(async () => {
    setup = await setupKycFixtures();
    userIdsToCleanup.push(setup.alice.userId, setup.bob.userId, setup.dom.userId);
  });

  afterAll(async () => {
    // Post-mig 110 : la cascade users → verifications_identite → trigger
    // HTTP fire-and-forget ne raise plus. Cleanup OK même avec verifs créées.
    await cleanupUsers(userIdsToCleanup);
  });

  it("submit_verification Alice happy path → row pending créée", async () => {
    const { data, error } = await setup.alice.client.rpc("submit_verification", {
      p_paiement_id: setup.paiementAlice,
      p_recto_path: `${setup.alice.userId}/v1/recto.jpg`,
      p_verso_path: `${setup.alice.userId}/v1/verso.jpg`,
      p_selfie_path: `${setup.alice.userId}/v1/selfie.jpg`,
      p_consent_version: "v1.1",
    });
    expect(error).toBeNull();
    expect(typeof data).toBe("string");

    const admin = adminClient();
    const { data: row } = await admin
      .from("verifications_identite")
      .select("id, statut, rgpd_consent_version")
      .eq("id", data as string)
      .single<{ id: string; statut: string; rgpd_consent_version: string }>();
    expect(row?.statut).toBe("pending");
    expect(row?.rgpd_consent_version).toBe("v1.1");
  });

  it("submit_verification 2× même paiement → PAIEMENT_ALREADY_USED", async () => {
    const { error } = await setup.alice.client.rpc("submit_verification", {
      p_paiement_id: setup.paiementAlice,
      p_recto_path: `${setup.alice.userId}/v2/recto.jpg`,
      p_verso_path: `${setup.alice.userId}/v2/verso.jpg`,
      p_selfie_path: `${setup.alice.userId}/v2/selfie.jpg`,
      p_consent_version: "v1.1",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("PAIEMENT_ALREADY_USED");
  });

  it("submit_verification Alice avec paiement type=boost → INVALID_PAIEMENT", async () => {
    const { error } = await setup.alice.client.rpc("submit_verification", {
      p_paiement_id: setup.paiementAliceBoost,
      p_recto_path: `${setup.alice.userId}/v3/recto.jpg`,
      p_verso_path: `${setup.alice.userId}/v3/verso.jpg`,
      p_selfie_path: `${setup.alice.userId}/v3/selfie.jpg`,
      p_consent_version: "v1.1",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("INVALID_PAIEMENT");
  });

  it("submit_verification Alice avec paiement de Bob → INVALID_PAIEMENT", async () => {
    const { error } = await setup.alice.client.rpc("submit_verification", {
      p_paiement_id: setup.paiementBob,
      p_recto_path: `${setup.alice.userId}/v4/recto.jpg`,
      p_verso_path: `${setup.alice.userId}/v4/verso.jpg`,
      p_selfie_path: `${setup.alice.userId}/v4/selfie.jpg`,
      p_consent_version: "v1.1",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("INVALID_PAIEMENT");
  });

  // ⚠ Les 2 tests suivants (INVALID_PATH_OWNERSHIP, INVALID_CONSENT_VERSION)
  // utilisent Bob (qui n'a pas encore de verif pending — il submitra plus tard
  // dans le test anti-fraude). Si on utilisait Alice, le gate
  // VERIFICATION_ALREADY_PENDING fire avant et masque le gate cible.

  it("submit_verification path spoofé (folder Alice) → INVALID_PATH_OWNERSHIP", async () => {
    const { error } = await setup.bob.client.rpc("submit_verification", {
      p_paiement_id: setup.paiementBob,
      p_recto_path: `${setup.alice.userId}/spoof/recto.jpg`,  // folder Alice avec JWT Bob
      p_verso_path: `${setup.bob.userId}/v0/verso.jpg`,
      p_selfie_path: `${setup.bob.userId}/v0/selfie.jpg`,
      p_consent_version: "v1.1",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("INVALID_PATH_OWNERSHIP");
  });

  it("submit_verification version consent inventée → INVALID_CONSENT_VERSION", async () => {
    const { error } = await setup.bob.client.rpc("submit_verification", {
      p_paiement_id: setup.paiementBob,
      p_recto_path: `${setup.bob.userId}/v0/recto.jpg`,
      p_verso_path: `${setup.bob.userId}/v0/verso.jpg`,
      p_selfie_path: `${setup.bob.userId}/v0/selfie.jpg`,
      p_consent_version: "v9.9",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("INVALID_CONSENT_VERSION");
  });

  it("RLS verifications_identite : Bob ne voit PAS la verif d'Alice", async () => {
    const { data, error } = await setup.bob.client
      .from("verifications_identite")
      .select("id")
      .eq("user_id", setup.alice.userId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("admin_validate_verification (approve) → users.is_verified=true + trigger", async () => {
    // Récupère l'ID de la verif Alice pending (la 1ère insérée)
    const admin = adminClient();
    const { data: verif } = await admin
      .from("verifications_identite")
      .select("id")
      .eq("user_id", setup.alice.userId)
      .eq("statut", "pending")
      .single<{ id: string }>();
    expect(verif?.id).toBeDefined();

    const { error } = await setup.dom.client.rpc("admin_validate_verification", {
      p_verification_id: verif!.id,
      p_approved: true,
      p_reject_reason: null,
      p_numero_cni: TEST_CNI_ALICE,
    });
    expect(error).toBeNull();

    const { data: aliceRow } = await admin
      .from("users")
      .select("is_verified, verification_paid_at")
      .eq("id", setup.alice.userId)
      .single<{ is_verified: boolean; verification_paid_at: string | null }>();
    expect(aliceRow?.is_verified).toBe(true);
    expect(aliceRow?.verification_paid_at).not.toBeNull();
  });

  it("anti-fraude mig 85 : Bob avec MÊME numero_cni → CNI_ALREADY_USED", async () => {
    // Bob soumet d'abord sa propre verif
    const { error: submitErr } = await setup.bob.client.rpc("submit_verification", {
      p_paiement_id: setup.paiementBob,
      p_recto_path: `${setup.bob.userId}/v1/recto.jpg`,
      p_verso_path: `${setup.bob.userId}/v1/verso.jpg`,
      p_selfie_path: `${setup.bob.userId}/v1/selfie.jpg`,
      p_consent_version: "v1.1",
    });
    expect(submitErr).toBeNull();

    const admin = adminClient();
    const { data: bobVerif } = await admin
      .from("verifications_identite")
      .select("id")
      .eq("user_id", setup.bob.userId)
      .eq("statut", "pending")
      .single<{ id: string }>();

    // Dom tente valider Bob avec le MÊME numéro qu'Alice → fraude détectée
    const { error } = await setup.dom.client.rpc("admin_validate_verification", {
      p_verification_id: bobVerif!.id,
      p_approved: true,
      p_reject_reason: null,
      p_numero_cni: TEST_CNI_ALICE,  // même que Alice
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("CNI_ALREADY_USED");
  });

  it("admin_validate_verification (reject) → reject_reason persisté + badge reste false", async () => {
    const admin = adminClient();
    const { data: bobVerif } = await admin
      .from("verifications_identite")
      .select("id")
      .eq("user_id", setup.bob.userId)
      .eq("statut", "pending")
      .single<{ id: string }>();

    const { error } = await setup.dom.client.rpc("admin_validate_verification", {
      p_verification_id: bobVerif!.id,
      p_approved: false,
      p_reject_reason: "CNI deja associee a un autre compte verifie",
      p_numero_cni: null,
    });
    expect(error).toBeNull();

    const { data: rejected } = await admin
      .from("verifications_identite")
      .select("statut, reject_reason")
      .eq("id", bobVerif!.id)
      .single<{ statut: string; reject_reason: string | null }>();
    expect(rejected?.statut).toBe("rejected");
    expect(rejected?.reject_reason).toBe("CNI deja associee a un autre compte verifie");

    const { data: bobUser } = await admin
      .from("users")
      .select("is_verified")
      .eq("id", setup.bob.userId)
      .single<{ is_verified: boolean }>();
    expect(bobUser?.is_verified).toBe(false);
  });
});
