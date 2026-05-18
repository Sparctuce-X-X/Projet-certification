/**
 * Tests intégration end-to-end — Module Boost (F09).
 *
 * Couvre :
 *   - apply_boost happy path 7j → dashboard.boosted=1
 *   - Cumul 7j sur 7j → boost_until ≈ now()+14j
 *   - Atomic claim : re-utiliser le paiement → PAIEMENT_ALREADY_USED (mig 63)
 *   - PAIEMENT_TARGET_MISMATCH : paiement target=annonce2, appel sur annonce1
 *   - INVALID_PRICE : paiement montant=500 → 7j (mig 63)
 *   - INVALID_PAIEMENT cross-user (Bob essaie d'utiliser paiement d'Alice)
 *   - ANNONCE_INVALID : annonce vendue → raise + rollback `consumed_at=null` (mig 63)
 *   - RLS paiements_niqo : Bob ne lit pas les paiements d'Alice via PostgREST
 *   - purge_expired_boosts : flippe is_boosted=false
 *   - INVALID_DURATION : 5j refusé
 *
 * Cf. docs/backend/boost.md pour le module complet.
 * Migs couvertes : 43, 60, 61, 62, 63, 77, 94.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  adminClient,
  cleanupUsers,
  createTestUser,
} from "./helpers/supabase";

interface Setup {
  alice: { client: SupabaseClient; userId: string };
  bob: { client: SupabaseClient; userId: string };
  annonceAlice1: string;
  annonceAlice2: string;
  annonceAliceVendue: string;
  annonceBob: string;
  /** Paiement Alice boost completed → target=annonceAlice1 (happy path) */
  paiementOk1: string;
  /** Paiement Alice boost completed → target=annonceAlice1 (cumul) */
  paiementOk2: string;
  /** Paiement Alice boost completed → target=annonceAlice2 (TARGET_MISMATCH) */
  paiementMismatch: string;
  /** Paiement Alice boost completed → target=annonceAlice1, montant=500 (INVALID_PRICE) */
  paiementLowPrice: string;
  /** Paiement Alice boost completed → target=annonceAliceVendue (ANNONCE_INVALID) */
  paiementAnnonceVendue: string;
  /** Paiement Bob boost completed → target=annonceBob (cross-user) */
  paiementBob: string;
}

async function setupBoostFixtures(): Promise<Setup> {
  const ts = Date.now();

  const alice = await createTestUser({
    email: `alice-boost-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "Boost",
    pays: "CI",
    ville: "Abidjan",
  });
  const bob = await createTestUser({
    email: `bob-boost-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "Boost",
    pays: "CI",
    ville: "Abidjan",
  });

  const admin = adminClient();

  // Récupère 1 categorie_id pour les annonces
  const { data: catData } = await admin
    .from("categories")
    .select("id")
    .order("ordre", { ascending: true })
    .limit(1)
    .single<{ id: string }>();
  if (!catData) throw new Error("categories vide — DB pas seed correctement");
  const categorieId = catData.id;

  const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

  // 4 annonces (3 Alice + 1 Bob)
  const annonces = await admin
    .from("annonces")
    .insert([
      {
        vendeur_id: alice.userId,
        titre: `Boost Alice 1 ${ts}`,
        description: "Test boost",
        prix: 30000,
        ville: "Abidjan",
        pays: "CI",
        etat: "bon",
        statut: "active",
        expires_at: expiresAt,
        categorie_id: categorieId,
      },
      {
        vendeur_id: alice.userId,
        titre: `Boost Alice 2 ${ts}`,
        description: "Test mismatch",
        prix: 50000,
        ville: "Abidjan",
        pays: "CI",
        etat: "bon",
        statut: "active",
        expires_at: expiresAt,
        categorie_id: categorieId,
      },
      {
        vendeur_id: alice.userId,
        titre: `Boost Alice vendue ${ts}`,
        description: "Test ANNONCE_INVALID",
        prix: 20000,
        ville: "Abidjan",
        pays: "CI",
        etat: "bon",
        statut: "vendue",
        expires_at: expiresAt,
        categorie_id: categorieId,
      },
      {
        vendeur_id: bob.userId,
        titre: `Boost Bob 1 ${ts}`,
        description: "Test cross-user",
        prix: 15000,
        ville: "Abidjan",
        pays: "CI",
        etat: "bon",
        statut: "active",
        expires_at: expiresAt,
        categorie_id: categorieId,
      },
    ])
    .select("id, titre")
    .returns<{ id: string; titre: string }[]>();
  if (annonces.error || !annonces.data || annonces.data.length !== 4) {
    throw annonces.error ?? new Error("annonces setup failed");
  }
  // Map par titre (insert order n'est pas garanti par PostgREST)
  const annonceByTitle = (suffix: string): string => {
    const row = annonces.data!.find((r) => r.titre.includes(suffix));
    if (!row) throw new Error(`annonce '${suffix}' introuvable`);
    return row.id;
  };
  const annonceAlice1 = annonceByTitle("Boost Alice 1");
  const annonceAlice2 = annonceByTitle("Boost Alice 2");
  const annonceAliceVendue = annonceByTitle("Alice vendue");
  const annonceBob = annonceByTitle("Boost Bob 1");

  // 6 paiements via service_role
  const paiements = await admin
    .from("paiements_niqo")
    .insert([
      {
        user_id: alice.userId,
        type: "boost",
        target_id: annonceAlice1,
        montant_fcfa: 1000,
        statut: "completed",
        completed_at: new Date().toISOString(),
      },
      {
        user_id: alice.userId,
        type: "boost",
        target_id: annonceAlice1,
        montant_fcfa: 1000,
        statut: "completed",
        completed_at: new Date().toISOString(),
      },
      {
        user_id: alice.userId,
        type: "boost",
        target_id: annonceAlice2,
        montant_fcfa: 1000,
        statut: "completed",
        completed_at: new Date().toISOString(),
      },
      {
        user_id: alice.userId,
        type: "boost",
        target_id: annonceAlice1,
        montant_fcfa: 500,
        statut: "completed",
        completed_at: new Date().toISOString(),
      },
      {
        user_id: alice.userId,
        type: "boost",
        target_id: annonceAliceVendue,
        montant_fcfa: 1000,
        statut: "completed",
        completed_at: new Date().toISOString(),
      },
      {
        user_id: bob.userId,
        type: "boost",
        target_id: annonceBob,
        montant_fcfa: 1000,
        statut: "completed",
        completed_at: new Date().toISOString(),
      },
    ])
    .select("id, target_id, montant_fcfa, user_id")
    .returns<{ id: string; target_id: string; montant_fcfa: number; user_id: string }[]>();
  if (paiements.error || !paiements.data || paiements.data.length !== 6) {
    throw paiements.error ?? new Error("paiements setup failed");
  }

  // Map les paiements par discriminant fiable
  const findPaiement = (
    userId: string,
    targetId: string,
    montant: number,
    excludeIds: Set<string> = new Set()
  ): string => {
    const p = paiements.data!.find(
      (x) =>
        x.user_id === userId &&
        x.target_id === targetId &&
        x.montant_fcfa === montant &&
        !excludeIds.has(x.id)
    );
    if (!p) throw new Error(`paiement introuvable: ${userId}/${targetId}/${montant}`);
    return p.id;
  };

  const used = new Set<string>();
  const paiementOk1 = findPaiement(alice.userId, annonceAlice1, 1000, used);
  used.add(paiementOk1);
  const paiementOk2 = findPaiement(alice.userId, annonceAlice1, 1000, used);
  used.add(paiementOk2);
  const paiementMismatch = findPaiement(alice.userId, annonceAlice2, 1000, used);
  const paiementLowPrice = findPaiement(alice.userId, annonceAlice1, 500, used);
  const paiementAnnonceVendue = findPaiement(alice.userId, annonceAliceVendue, 1000, used);
  const paiementBob = findPaiement(bob.userId, annonceBob, 1000, used);

  return {
    alice,
    bob,
    annonceAlice1,
    annonceAlice2,
    annonceAliceVendue,
    annonceBob,
    paiementOk1,
    paiementOk2,
    paiementMismatch,
    paiementLowPrice,
    paiementAnnonceVendue,
    paiementBob,
  };
}

describe("Boost — apply_boost + cumul + purge + RLS (mig 60→63, 77)", () => {
  let setup: Setup;
  const userIdsToCleanup: string[] = [];

  beforeAll(async () => {
    setup = await setupBoostFixtures();
    userIdsToCleanup.push(setup.alice.userId, setup.bob.userId);
  });

  afterAll(async () => {
    await cleanupUsers(userIdsToCleanup);
  });

  it("apply_boost happy path 7j → boost_until ≈ now()+7j + dashboard.boosted = 1", async () => {
    const { data, error } = await setup.alice.client.rpc("apply_boost", {
      p_paiement_id: setup.paiementOk1,
      p_annonce_id: setup.annonceAlice1,
      p_duration_days: 7,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const boostUntil = new Date(data as string);
    const expected = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    // Tolérance 2 min pour cover la latence DB
    expect(Math.abs(boostUntil.getTime() - expected.getTime())).toBeLessThan(2 * 60 * 1000);

    // dashboard breakdown (mig 61)
    const { data: stats, error: statsErr } = await setup.alice.client.rpc(
      "get_my_dashboard_stats"
    );
    expect(statsErr).toBeNull();
    expect((stats as { annonces: { boosted: number } }).annonces.boosted).toBe(1);
  });

  it("cumul 7j+7j → boost_until ≈ now()+14j (greatest(boost_until, now())+N)", async () => {
    const { data, error } = await setup.alice.client.rpc("apply_boost", {
      p_paiement_id: setup.paiementOk2,
      p_annonce_id: setup.annonceAlice1,
      p_duration_days: 7,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const boostUntil = new Date(data as string);
    const expected = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    expect(Math.abs(boostUntil.getTime() - expected.getTime())).toBeLessThan(2 * 60 * 1000);
  });

  it("PAIEMENT_ALREADY_USED — atomic claim refuse la 2e application (mig 63)", async () => {
    const { error } = await setup.alice.client.rpc("apply_boost", {
      p_paiement_id: setup.paiementOk1,
      p_annonce_id: setup.annonceAlice1,
      p_duration_days: 7,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("PAIEMENT_ALREADY_USED");
  });

  it("PAIEMENT_TARGET_MISMATCH — paiement target=annonce2 appliqué sur annonce1 (mig 62)", async () => {
    const { error } = await setup.alice.client.rpc("apply_boost", {
      p_paiement_id: setup.paiementMismatch,
      p_annonce_id: setup.annonceAlice1,
      p_duration_days: 7,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("PAIEMENT_TARGET_MISMATCH");
  });

  it("INVALID_PRICE — paiement 500 FCFA pour 7j (tarif officiel 1000) (mig 63)", async () => {
    const { error } = await setup.alice.client.rpc("apply_boost", {
      p_paiement_id: setup.paiementLowPrice,
      p_annonce_id: setup.annonceAlice1,
      p_duration_days: 7,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("INVALID_PRICE");
  });

  it("INVALID_PAIEMENT cross-user — Alice tente d'utiliser un paiement de Bob", async () => {
    const { error } = await setup.alice.client.rpc("apply_boost", {
      p_paiement_id: setup.paiementBob,
      p_annonce_id: setup.annonceAlice1,
      p_duration_days: 7,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("INVALID_PAIEMENT");
  });

  it("ANNONCE_INVALID + rollback — annonce vendue, paiement libéré (consumed_at=null) (mig 63)", async () => {
    // Test critique : vérifie que la RPC libère le paiement quand l'annonce
    // devient invalide entre l'init du paiement et l'application
    // (sinon l'user perd 1000 FCFA sur une annonce vendue).
    const { error } = await setup.alice.client.rpc("apply_boost", {
      p_paiement_id: setup.paiementAnnonceVendue,
      p_annonce_id: setup.annonceAliceVendue,
      p_duration_days: 7,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("ANNONCE_INVALID");

    // Vérifie via service_role que consumed_at est revenu à null
    const admin = adminClient();
    const { data: paiement } = await admin
      .from("paiements_niqo")
      .select("consumed_at")
      .eq("id", setup.paiementAnnonceVendue)
      .single<{ consumed_at: string | null }>();
    expect(paiement?.consumed_at).toBeNull();
  });

  it("INVALID_DURATION — 5 jours refusé (whitelist 7|30)", async () => {
    const { error } = await setup.alice.client.rpc("apply_boost", {
      p_paiement_id: setup.paiementOk2, // déjà consommé mais peu importe — gate duration fire AVANT
      p_annonce_id: setup.annonceAlice1,
      p_duration_days: 5,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("INVALID_DURATION");
  });

  it("RLS paiements_niqo — Bob ne lit pas les paiements d'Alice via PostgREST", async () => {
    const { data, error } = await setup.bob.client
      .from("paiements_niqo")
      .select("id")
      .eq("user_id", setup.alice.userId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("purge_expired_boosts — flippe is_boosted=false sur annonce expirée", async () => {
    // Force annonce alice2 boostée mais expirée (via service_role)
    const admin = adminClient();
    await admin
      .from("annonces")
      .update({ is_boosted: true, boost_until: new Date(Date.now() - 3600_000).toISOString() })
      .eq("id", setup.annonceAlice2);

    // Trigger le cron manuellement
    const { error: purgeErr } = await admin.rpc("purge_expired_boosts");
    // purge_expired_boosts est revoke from public/anon/authenticated (mig 94),
    // mais service_role peut l'invoquer.
    expect(purgeErr).toBeNull();

    const { data: annonce } = await admin
      .from("annonces")
      .select("is_boosted, boost_until")
      .eq("id", setup.annonceAlice2)
      .single<{ is_boosted: boolean; boost_until: string }>();
    expect(annonce?.is_boosted).toBe(false);

    // Alice1 reste boostée (boost_until = now()+14j post-cumul)
    const { data: annonce1 } = await admin
      .from("annonces")
      .select("is_boosted")
      .eq("id", setup.annonceAlice1)
      .single<{ is_boosted: boolean }>();
    expect(annonce1?.is_boosted).toBe(true);
  });
});
