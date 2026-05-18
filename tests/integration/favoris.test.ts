/**
 * Tests intégration end-to-end — Module Favoris.
 *
 * Couvre :
 *   - Toggle favori ON (INSERT) par un user actif via PostgREST
 *   - Toggle favori OFF (DELETE) par le même user
 *   - RLS SELECT isolation : Alice ne voit pas les favoris de Bob
 *   - Guard is_my_account_active : compte suspendu bloqué en INSERT (mig 74)
 *   - Ownership INSERT : Bob ne peut pas insérer un favori pour Alice
 *   - fetchMyFavorites : jointure favoris → annonces (inclut statut, type_offre)
 *   - Anon bloqué en SELECT (RLS retourne 0 rows sans auth)
 *   - UNIQUE (user_id, annonce_id) : doublon rejeté via PostgREST
 *
 * Cf. docs/backend/favoris.md pour le module complet.
 * Migs couvertes : 19, 74, 76.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  anonClient,
  cleanupUsers,
  createTestUser,
} from "./helpers/supabase";

interface Setup {
  alice: { client: SupabaseClient; userId: string };
  bob: { client: SupabaseClient; userId: string };
  /** Annonce de Bob : Alice peut la mettre en favori */
  annonceId: string;
  /** Deuxième annonce de Bob : pour test UNIQUE + DELETE */
  annonceId2: string;
}

async function setupFavorisFixtures(): Promise<Setup> {
  const ts = Date.now();

  const alice = await createTestUser({
    email: `alice-fav-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "Favori",
    pays: "CI",
    ville: "Abidjan",
  });
  const bob = await createTestUser({
    email: `bob-fav-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "Vendeur",
    pays: "CI",
    ville: "Abidjan",
  });

  const admin = adminClient();

  // Récupère une catégorie existante (seedée en mig 13)
  const { data: cat } = await admin
    .from("categories")
    .select("id")
    .order("ordre", { ascending: true })
    .limit(1)
    .single<{ id: string }>();
  if (!cat) throw new Error("No category seeded");

  const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

  const { data: a1, error: a1Err } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      categorie_id: cat.id,
      titre: "Samsung Galaxy S23 128 Go",
      description: "Excellent état, boite et accessoires d'origine fournis.",
      prix: 280000,
      photos: ["s23.jpg"],
      pays: "CI",
      ville: "Abidjan",
      expires_at: expiresAt,
    })
    .select("id")
    .single<{ id: string }>();
  if (a1Err || !a1) throw a1Err ?? new Error("annonce1 insert failed");

  const { data: a2, error: a2Err } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      categorie_id: cat.id,
      titre: "Casque Sony WH-1000XM5",
      description: "Réduction de bruit active, autonomie 30h, neuf avec boite.",
      prix: 95000,
      photos: ["casque.jpg"],
      pays: "CI",
      ville: "Abidjan",
      expires_at: expiresAt,
    })
    .select("id")
    .single<{ id: string }>();
  if (a2Err || !a2) throw a2Err ?? new Error("annonce2 insert failed");

  return {
    alice: { client: alice.client, userId: alice.userId },
    bob: { client: bob.client, userId: bob.userId },
    annonceId: a1.id,
    annonceId2: a2.id,
  };
}

describe("Module Favoris — intégration", () => {
  let setup: Setup;
  const userIdsToCleanup: string[] = [];

  beforeAll(async () => {
    setup = await setupFavorisFixtures();
    userIdsToCleanup.push(setup.alice.userId, setup.bob.userId);
  });

  afterAll(async () => {
    await cleanupUsers(userIdsToCleanup);
  });

  it("toggle ON : Alice ajoute une annonce en favori (INSERT via PostgREST)", async () => {
    const { error } = await setup.alice.client.from("favoris").insert({
      user_id: setup.alice.userId,
      annonce_id: setup.annonceId,
    });
    expect(error).toBeNull();

    // Vérifier que le favori est bien créé
    const { data } = await setup.alice.client
      .from("favoris")
      .select("annonce_id")
      .eq("annonce_id", setup.annonceId)
      .maybeSingle<{ annonce_id: string }>();
    expect(data?.annonce_id).toBe(setup.annonceId);
  });

  it("UNIQUE (user_id, annonce_id) : doublon rejeté via PostgREST", async () => {
    const { error } = await setup.alice.client.from("favoris").insert({
      user_id: setup.alice.userId,
      annonce_id: setup.annonceId,
    });
    // PostgREST retourne une erreur 409 / code 23505 sur violation UNIQUE
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });

  it("RLS SELECT isolation : Bob ne voit pas les favoris d'Alice", async () => {
    // Bob n'a aucun favori — mais il ne doit pas voir ceux d'Alice non plus
    const { data, error } = await setup.bob.client.from("favoris").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("RLS INSERT ownership : Bob ne peut pas insérer un favori pour le compte d'Alice", async () => {
    const { error } = await setup.bob.client.from("favoris").insert({
      user_id: setup.alice.userId, // ownership mismatch
      annonce_id: setup.annonceId2,
    });
    expect(error).not.toBeNull();
    // RLS WITH CHECK violée → code 42501 (insufficient_privilege) via PostgREST
    expect(error!.code).toBe("42501");
  });

  it("Guard is_my_account_active : compte suspendu bloqué en INSERT (mig 74)", async () => {
    // Créer un user suspendu pour ce test
    const ts = Date.now();
    const suspended = await createTestUser({
      email: `suspended-fav-${ts}@niqo.test`,
      prenom: "Suspendu",
      nom: "Test",
    });
    userIdsToCleanup.push(suspended.userId);

    // Suspendre le compte via admin
    const admin = adminClient();
    await admin
      .from("users")
      .update({ is_active: false })
      .eq("id", suspended.userId);

    const { error } = await suspended.client.from("favoris").insert({
      user_id: suspended.userId,
      annonce_id: setup.annonceId,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("fetchMyFavorites pattern : jointure favoris → annonces retourne les détails", async () => {
    // Alice a déjà 1 favori (annonceId)
    const { data, error } = await setup.alice.client
      .from("favoris")
      .select(
        "annonce_id, annonces:annonce_id (id, titre, prix, photos, ville, statut, created_at, type_offre, is_boosted, boost_until)"
      )
      .order("created_at", { ascending: false });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const row = (data as Array<{ annonce_id: string; annonces: { id: string; titre: string; statut: string } | null }>)[0];
    expect(row?.annonce_id).toBe(setup.annonceId);
    expect(row?.annonces).not.toBeNull();
    expect(row?.annonces?.statut).toBe("active");
  });

  it("toggle OFF : Alice retire son favori (DELETE via PostgREST)", async () => {
    const { error } = await setup.alice.client
      .from("favoris")
      .delete()
      .eq("user_id", setup.alice.userId)
      .eq("annonce_id", setup.annonceId);
    expect(error).toBeNull();

    // Vérifier que le favori n'existe plus
    const { data } = await setup.alice.client
      .from("favoris")
      .select("id")
      .eq("annonce_id", setup.annonceId);
    expect(data).toHaveLength(0);
  });

  it("Anon : SELECT favoris retourne 0 rows (RLS bloque sans auth)", async () => {
    const anon = anonClient();
    const { data, error } = await anon.from("favoris").select("id");
    expect(error).toBeNull();
    // RLS using (auth.uid() = user_id) → auth.uid() null → 0 rows (pas d'erreur, résultat vide)
    expect(data).toHaveLength(0);
  });
});
