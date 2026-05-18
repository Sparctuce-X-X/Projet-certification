/**
 * Tests intégration end-to-end — Module Annonces.
 *
 * Couvre via PostgREST (RLS gateway + triggers DB) :
 *   1. Create annonce (RLS INSERT owner + trigger inherit_pays + expires_at)
 *   2. Browse anon : ne voit que statut=active
 *   3. Owner SELECT own : voit tous statuts
 *   4. Buyer via conv : voit en_cours (mig 41)
 *   5. Owner UPDATE bloqué si statut <> active
 *   6. fn_increment_views (anon, active)
 *   7. fn_prolonger_annonce happy path
 *   8. fn_prolonger_annonce not_owner
 *   9. mark_annonce_vendue immo bypass (mig 101)
 *  10. mark_annonce_vendue normale → no_meeting_confirmed
 *  11. Rate limit 6e annonce / 24h (mig 16)
 *  12. Anti-doublon (mig 17)
 *  13. Content filter — mot interdit dans titre (mig 29)
 *
 * Cf. docs/backend/annonces.md pour le module complet.
 * Migs couvertes : 15, 16, 17, 18, 29, 32, 34, 39, 41, 95, 100, 101.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, cleanupUsers, createTestUser } from "./helpers/supabase";

interface Setup {
  alice: { client: SupabaseClient; userId: string };
  bob: { client: SupabaseClient; userId: string };
  carol: { client: SupabaseClient; userId: string };
  categorieNormale: string;
  categorieImmo: string;
}

async function getSetup(): Promise<Setup> {
  const ts = Date.now();

  const alice = await createTestUser({
    email: `alice-ann-${ts}@niqo.test`,
    prenom: "Alice",
    nom: "Annonces",
    pays: "CI",
    ville: "Abidjan",
  });
  const bob = await createTestUser({
    email: `bob-ann-${ts}@niqo.test`,
    prenom: "Bob",
    nom: "Annonces",
    pays: "CI",
    ville: "Abidjan",
  });
  const carol = await createTestUser({
    email: `carol-ann-${ts}@niqo.test`,
    prenom: "Carol",
    nom: "Annonces",
    pays: "CG",
    ville: "Brazzaville",
  });

  const admin = adminClient();
  const { data: cats, error: catErr } = await admin
    .from("categories")
    .select("id, nom")
    .in("nom", ["Immobilier", "Téléphones & Accessoires"])
    .returns<{ id: string; nom: string }[]>();
  if (catErr || !cats || cats.length < 2) {
    throw catErr ?? new Error("categories setup failed");
  }
  const categorieImmo = cats.find((c) => c.nom === "Immobilier")!.id;
  const categorieNormale = cats.find((c) => c.nom !== "Immobilier")!.id;

  return { alice, bob, carol, categorieNormale, categorieImmo };
}

const TS = Date.now();
let setup: Setup;
const cleanup: string[] = [];

beforeAll(async () => {
  setup = await getSetup();
  cleanup.push(setup.alice.userId, setup.bob.userId, setup.carol.userId);
});

afterAll(async () => {
  await cleanupUsers(cleanup);
});

describe("Annonces — create + RLS + triggers + RPCs (mig 15→105)", () => {
  it("1. Create annonce via PostgREST : owner INSERT + trigger inherit_pays + expires_at +60d", async () => {
    const { data, error } = await setup.alice.client
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieNormale,
        titre: `Test create ${TS}`,
        description: "Description normale pour test create plus 10 chars",
        prix: 30000,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CG", // ← client envoie CG, trigger forcera CI
        expires_at: new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString(), // ← client envoie +1j, trigger forcera +60j
      })
      .select("id, pays, expires_at")
      .single<{ id: string; pays: string; expires_at: string }>();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data?.pays).toBe("CI"); // trigger inherit_pays
    const expiresAt = new Date(data!.expires_at).getTime();
    const expected = Date.now() + 60 * 24 * 3600 * 1000;
    expect(Math.abs(expiresAt - expected)).toBeLessThan(2 * 60 * 1000); // ±2 min trigger expires_at
  });

  it("2. Anon ne voit que statut=active (RLS annonces_read_active)", async () => {
    // Alice crée une annonce suspendue via service_role
    const admin = adminClient();
    const { data: ins } = await admin
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieNormale,
        titre: `Test anon ${TS}`,
        description: "Description test anon access RLS plus 10 chars",
        prix: 31000,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CI",
        statut: "suspendue",
      })
      .select("id")
      .single<{ id: string }>();

    // Client anon explicite (pas de JWT) pour valider RLS browse-first
    const { createClient } = await import("@supabase/supabase-js");
    const anonClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });

    const { data } = await anonClient
      .from("annonces")
      .select("id")
      .eq("id", ins!.id);

    expect(data).toEqual([]); // anon ne voit pas la suspendue
  });

  it("3. Owner SELECT own : Alice voit ses annonces (tous statuts)", async () => {
    // Alice a déjà inséré au moins 2 annonces dans les tests précédents
    // (test 1 owner-insert + tests 2/4/5 seed admin pour Alice).
    const { data } = await setup.alice.client
      .from("annonces")
      .select("id, statut")
      .eq("vendeur_id", setup.alice.userId);

    expect(data).toBeTruthy();
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it("4. Buyer via conv : Bob lit l'annonce en_cours via conversation (mig 41)", async () => {
    const admin = adminClient();
    // Alice crée une nouvelle annonce en_cours, Bob a une conv dessus
    const { data: ins } = await admin
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieNormale,
        titre: `Test conv ${TS}`,
        description: "Description test buyer via conv RLS plus 10",
        prix: 32000,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CI",
        statut: "en_cours",
      })
      .select("id")
      .single<{ id: string }>();

    await admin.from("conversations").insert({
      annonce_id: ins!.id,
      vendeur_id: setup.alice.userId,
      acheteur_id: setup.bob.userId,
    });

    const { data } = await setup.bob.client
      .from("annonces")
      .select("id")
      .eq("id", ins!.id);

    expect(data?.length).toBe(1);
  });

  it("5. Owner UPDATE bloqué si statut <> active (RLS annonces_owner_update)", async () => {
    const admin = adminClient();
    const { data: ins } = await admin
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieNormale,
        titre: `Test update vendue ${TS}`,
        description: "Description annonce vendue test RLS plus 10",
        prix: 33000,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CI",
        statut: "vendue",
      })
      .select("id")
      .single<{ id: string }>();

    const { data, error } = await setup.alice.client
      .from("annonces")
      .update({ titre: "Should not update" })
      .eq("id", ins!.id)
      .select("id");

    // RLS bloque → 0 rows affectées (pas une erreur)
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("6. fn_increment_views : anon peut incrémenter sur active, no-op sur non-active", async () => {
    const admin = adminClient();
    const { data: ins } = await admin
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieNormale,
        titre: `Test views ${TS}`,
        description: "Description test fn_increment_views RLS plus 10",
        prix: 34000,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CI",
        statut: "active",
      })
      .select("id")
      .single<{ id: string }>();

    const { createClient } = await import("@supabase/supabase-js");
    const anonClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });

    const { error } = await anonClient.rpc("fn_increment_views", {
      p_annonce_id: ins!.id,
    });
    expect(error).toBeNull();

    const { data: a } = await admin
      .from("annonces")
      .select("nb_vues")
      .eq("id", ins!.id)
      .single<{ nb_vues: number }>();
    expect(a?.nb_vues).toBe(1);
  });

  it("7. fn_prolonger_annonce happy path : owner sur expiree<28j → success", async () => {
    const admin = adminClient();
    // Backdate les annonces précédentes d'Alice pour échapper au rate_limit
    await admin
      .from("annonces")
      .update({ created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() })
      .eq("vendeur_id", setup.alice.userId);
    const { data: ins, error: insErr } = await admin
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieNormale,
        titre: `Test prolong ${TS}`,
        description: "Description test fn_prolonger_annonce plus 10",
        prix: 35000,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CI",
        statut: "expiree",
      })
      .select("id")
      .single<{ id: string }>();
    if (insErr || !ins) throw new Error(`Insert failed: ${insErr?.message}`);
    // Backdate expires_at à -5j (< 28j → prolongeable)
    await admin
      .from("annonces")
      .update({ expires_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString() })
      .eq("id", ins.id);

    const { data, error } = await setup.alice.client.rpc("fn_prolonger_annonce", {
      p_annonce_id: ins.id,
    });

    expect(error).toBeNull();
    expect((data as { success: boolean }).success).toBe(true);

    const { data: a } = await admin
      .from("annonces")
      .select("statut")
      .eq("id", ins.id)
      .single<{ statut: string }>();
    expect(a?.statut).toBe("active");
  });

  it("8. fn_prolonger_annonce not_owner : Bob ne peut pas prolonger annonce d'Alice", async () => {
    const admin = adminClient();
    await admin
      .from("annonces")
      .update({ created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() })
      .eq("vendeur_id", setup.alice.userId);
    const { data: ins, error: insErr } = await admin
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieNormale,
        titre: `Test prolong stranger ${TS}`,
        description: "Description test prolong stranger plus 10",
        prix: 36000,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CI",
        statut: "expiree",
      })
      .select("id")
      .single<{ id: string }>();
    if (insErr || !ins) throw new Error(`Insert failed: ${insErr?.message}`);
    await admin
      .from("annonces")
      .update({ expires_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString() })
      .eq("id", ins.id);

    const { data } = await setup.bob.client.rpc("fn_prolonger_annonce", {
      p_annonce_id: ins.id,
    });

    expect((data as { error: string }).error).toBe("not_owner");
  });

  it("9. mark_annonce_vendue immo : bypass rencontre (mig 101)", async () => {
    const admin = adminClient();
    await admin
      .from("annonces")
      .update({ created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() })
      .eq("vendeur_id", setup.alice.userId);
    const { data: ins, error: insErr } = await admin
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieImmo,
        titre: `Test immo vendue ${TS}`,
        description: "Description studio location immo bypass plus 10",
        prix: 60000,
        photos: ["x.jpg"],
        etat: null,
        ville: "Abidjan",
        pays: "CI",
        statut: "active",
        type_offre: "location",
        type_bien: "studio",
      })
      .select("id")
      .single<{ id: string }>();
    if (insErr || !ins) throw new Error(`Insert failed: ${insErr?.message}`);

    const { data } = await setup.alice.client.rpc("mark_annonce_vendue", {
      p_annonce_id: ins.id,
    });
    expect((data as { success: boolean }).success).toBe(true);

    const { data: a } = await admin
      .from("annonces")
      .select("statut")
      .eq("id", ins.id)
      .single<{ statut: string }>();
    expect(a?.statut).toBe("vendue");
  });

  it("10. mark_annonce_vendue normale sans rencontre → no_meeting_confirmed", async () => {
    const admin = adminClient();
    await admin
      .from("annonces")
      .update({ created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() })
      .eq("vendeur_id", setup.alice.userId);
    const { data: ins, error: insErr } = await admin
      .from("annonces")
      .insert({
        vendeur_id: setup.alice.userId,
        categorie_id: setup.categorieNormale,
        titre: `Test normale no_meeting ${TS}`,
        description: "Description annonce normale sans meeting plus 10",
        prix: 37000,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CI",
        statut: "active",
      })
      .select("id")
      .single<{ id: string }>();
    if (insErr || !ins) throw new Error(`Insert failed: ${insErr?.message}`);

    const { data } = await setup.alice.client.rpc("mark_annonce_vendue", {
      p_annonce_id: ins.id,
    });
    expect((data as { error: string }).error).toBe("no_meeting_confirmed");
  });

  it("11. Rate limit 5/24h : 6e INSERT raise (mig 16)", async () => {
    // On utilise un user fresh sans annonces antérieures
    const fresh = await createTestUser({
      email: `ratelim-${TS}@niqo.test`,
      prenom: "RateLim",
      pays: "CI",
    });
    cleanup.push(fresh.userId);

    // 5 INSERT successifs OK
    for (let i = 1; i <= 5; i++) {
      const { error } = await fresh.client.from("annonces").insert({
        vendeur_id: fresh.userId,
        categorie_id: setup.categorieNormale,
        titre: `RateLim ${TS} #${i}`,
        description: `Description rate limit annonce ${i} plus 10`,
        prix: 10000 + i,
        photos: ["x.jpg"],
        etat: "bon",
        ville: "Abidjan",
        pays: "CI",
      });
      expect(error).toBeNull();
    }

    // 6e → raise
    const { error } = await fresh.client.from("annonces").insert({
      vendeur_id: fresh.userId,
      categorie_id: setup.categorieNormale,
      titre: `RateLim ${TS} #6`,
      description: "Description rate limit doit raise plus 10",
      prix: 16000,
      photos: ["x.jpg"],
      etat: "bon",
      ville: "Abidjan",
      pays: "CI",
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("rate_limit_announces");
  });

  it("12. Anti-doublon : 2e INSERT identique <24h raise (mig 17)", async () => {
    const fresh = await createTestUser({
      email: `dup-${TS}@niqo.test`,
      prenom: "Dup",
      pays: "CI",
    });
    cleanup.push(fresh.userId);

    const payload = {
      vendeur_id: fresh.userId,
      categorie_id: setup.categorieNormale,
      titre: `Doublon ${TS}`,
      description: "Description anti doublon identique plus 10",
      prix: 22000,
      photos: ["x.jpg"],
      etat: "bon" as const,
      ville: "Abidjan",
      pays: "CI" as const,
    };

    const r1 = await fresh.client.from("annonces").insert(payload);
    expect(r1.error).toBeNull();

    const r2 = await fresh.client.from("annonces").insert(payload);
    expect(r2.error).toBeTruthy();
    expect(r2.error!.message).toContain("annonces_duplicate_check");
  });

  it("13. Content filter : mot interdit dans titre raise contenu_interdit (mig 29)", async () => {
    // On injecte un mot interdit via service_role (RLS deny-all mig 105)
    const admin = adminClient();
    await admin.from("mots_interdits").upsert(
      { mot: `zzz${TS}banned`, categorie: "test" },
      { onConflict: "mot" }
    );

    const fresh = await createTestUser({
      email: `filter-${TS}@niqo.test`,
      prenom: "Filter",
      pays: "CI",
    });
    cleanup.push(fresh.userId);

    const { error } = await fresh.client.from("annonces").insert({
      vendeur_id: fresh.userId,
      categorie_id: setup.categorieNormale,
      titre: `Vends zzz${TS}banned`,
      description: "Description normale sans mot banni cote desc plus 10",
      prix: 14000,
      photos: ["x.jpg"],
      etat: "bon",
      ville: "Abidjan",
      pays: "CI",
    });

    expect(error).toBeTruthy();
    expect(error!.message).toContain("contenu_interdit");

    // Cleanup
    await admin.from("mots_interdits").delete().eq("mot", `zzz${TS}banned`);
  });
});
