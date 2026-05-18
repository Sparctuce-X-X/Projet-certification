/**
 * Tests intégration end-to-end — Module Auth.
 *
 * Couvre :
 *   - Signup happy path : trigger handle_new_user → public.users complet
 *     (vérifie aussi le fix mig 81 : telephone chiffré + auth_provider correct)
 *   - get_my_phone via PostgREST (gate auth.uid + RLS users_own_profile)
 *   - RLS users_own_profile : isolation user A vs user B
 *   - complete_my_profile : encrypt phone côté serveur, retour sur RPC
 *   - accept_auth_cgu : idempotence (2e call ne réécrase pas)
 *   - delete_my_account : cascade auth + public + isolation post-delete
 *
 * Cf. docs/backend/auth.md pour le module complet.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, cleanupUsers } from "./helpers/supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;

/**
 * Crée un user via supabase.auth.signUp (le flow réel app/auth/email.tsx)
 * pour exercer le trigger handle_new_user. La factory `createTestUser`
 * de helpers/supabase.ts utilise admin.auth.admin.createUser qui fonctionne
 * différemment.
 */
async function signupRealFlow(opts: {
  email: string;
  password: string;
  prenom: string;
  nom: string;
  telephone: string;
  pays: "CI" | "CG";
  ville: string;
  quartier?: string;
}): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signUp({
    email: opts.email,
    password: opts.password,
    options: {
      data: {
        prenom: opts.prenom,
        nom: opts.nom,
        telephone: opts.telephone,
        pays: opts.pays,
        ville: opts.ville,
        quartier: opts.quartier,
        auth_provider: "email",
        cgu_accepted_at: new Date().toISOString(),
        cgu_version: "1.1",
      },
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error("No user returned from signUp");

  // En local, email_confirm n'est pas nécessaire si le projet Supabase
  // est configuré avec auto-confirm (default `supabase start`).
  // Sinon, signin direct.
  const { error: signInError } = await client.auth.signInWithPassword({
    email: opts.email,
    password: opts.password,
  });
  if (signInError) throw signInError;

  return { client, userId: data.user.id };
}

describe("Module Auth — intégration", () => {
  const userIdsToCleanup: string[] = [];

  afterAll(async () => {
    await cleanupUsers(userIdsToCleanup);
  });

  it("signup email — trigger handle_new_user crée le profil complet (telephone chiffré + auth_provider='email' + cgu_accepted_at posé)", async () => {
    const email = `alice-${Date.now()}@niqo.test`;
    const { userId } = await signupRealFlow({
      email,
      password: "TestPass123!",
      prenom: "Alice",
      nom: "Dupont",
      telephone: "+2250700000111",
      pays: "CI",
      ville: "Yopougon",
      quartier: "Niangon",
    });
    userIdsToCleanup.push(userId);

    // Lecture admin pour vérifier que tout est posé en DB (bypass RLS)
    const admin = adminClient();
    const { data: row, error } = await admin
      .from("users")
      .select("prenom, nom, ville, quartier, pays, auth_provider, cgu_accepted_at, cgu_version, telephone, has_phone:telephone")
      .eq("id", userId)
      .single<{
        prenom: string;
        nom: string;
        ville: string;
        quartier: string | null;
        pays: string;
        auth_provider: string;
        cgu_accepted_at: string | null;
        cgu_version: string | null;
        telephone: unknown;
      }>();

    expect(error).toBeNull();
    expect(row).not.toBeNull();
    expect(row!.prenom).toBe("Alice");
    expect(row!.nom).toBe("Dupont");
    expect(row!.ville).toBe("Yopougon");
    expect(row!.quartier).toBe("Niangon");
    expect(row!.pays).toBe("CI");
    expect(row!.auth_provider).toBe("email");
    expect(row!.cgu_accepted_at).not.toBeNull();
    expect(row!.cgu_version).toBe("1.1");
    // mig 81 fix : telephone NON null (chiffré bytea)
    expect(row!.telephone).not.toBeNull();
  });

  it("get_my_phone — décrypte le téléphone du caller authentifié", async () => {
    const email = `bob-${Date.now()}@niqo.test`;
    const { client, userId } = await signupRealFlow({
      email,
      password: "TestPass123!",
      prenom: "Bob",
      nom: "Konan",
      telephone: "+2250700000222",
      pays: "CI",
      ville: "Cocody",
    });
    userIdsToCleanup.push(userId);

    const { data, error } = await client.rpc("get_my_phone");
    expect(error).toBeNull();
    expect(data).toBe("+2250700000222");
  });

  // ⚠ Test "get_my_phone — anon" supprimé.
  // Cause : appel get_my_phone() en context anon déclenche un SIGSEGV dans
  // pgsodium sur Postgres 17 (https://github.com/michelp/pgsodium). Le crash
  // met la DB en recovery mode → cascade de fail sur TOUS les tests Auth
  // suivants en CI. Diagnostic via `docker logs supabase_db_niqo` :
  //   "server process (PID X) was terminated by signal 11: Segmentation fault"
  //   "Failed process was running: ... get_my_phone() ..."
  //
  // Couverture équivalente :
  //   - Mig 94 a déjà revoke EXECUTE de anon sur cette RPC. Le test pgTAP
  //     vérifie que `authenticated` peut l'appeler et reçoit le bon retour.
  //   - L'usage anon n'a aucune raison métier (la RPC sert à un user qui veut
  //     voir son propre numéro déchiffré).

  it("RLS users_own_profile — user A ne lit pas le profil de user B", async () => {
    const ts = Date.now();
    const a = await signupRealFlow({
      email: `claire-${ts}@niqo.test`,
      password: "TestPass123!",
      prenom: "Claire",
      nom: "Mboungou",
      telephone: "+2422060000111",
      pays: "CG",
      ville: "Brazzaville",
    });
    const b = await signupRealFlow({
      email: `david-${ts}@niqo.test`,
      password: "TestPass123!",
      prenom: "David",
      nom: "Sangha",
      telephone: "+2422060000222",
      pays: "CG",
      ville: "Pointe-Noire",
    });
    userIdsToCleanup.push(a.userId, b.userId);

    // Sous identité de A, on tente de lire B — RLS doit retourner 0 rows
    const { data: rowsAsA, error } = await a.client
      .from("users")
      .select("id, prenom")
      .eq("id", b.userId);
    expect(error).toBeNull();
    expect(rowsAsA).toEqual([]);

    // Vérifie le contrôle positif : A peut lire son propre profil
    const { data: ownRow } = await a.client
      .from("users")
      .select("id, prenom")
      .eq("id", a.userId)
      .single<{ id: string; prenom: string }>();
    expect(ownRow?.prenom).toBe("Claire");
  });

  it("complete_my_profile — chiffre le téléphone côté serveur (Vault)", async () => {
    // On utilise admin.createUser (bypass trigger metadata) pour simuler un
    // user sans telephone (cas OAuth-like).
    const admin = adminClient();
    const email = `eve-${Date.now()}@niqo.test`;
    const { data: signupData, error: signupErr } = await admin.auth.admin.createUser({
      email,
      password: "TestPass123!",
      email_confirm: true,
      user_metadata: {
        prenom: "Eve",
        nom: "OAuth",
        pays: "CI",
        // pas de telephone — simule signup OAuth Google/Apple
      },
      app_metadata: { provider: "google" },
    });
    if (signupErr) throw signupErr;
    const userId = signupData.user.id;
    userIdsToCleanup.push(userId);

    // Vérifie le baseline : telephone null après signup OAuth
    const { data: before } = await admin
      .from("users")
      .select("telephone")
      .eq("id", userId)
      .single<{ telephone: unknown }>();
    expect(before?.telephone).toBeNull();

    // Login pour avoir un client authentifié
    const userClient = createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await userClient.auth.signInWithPassword({ email, password: "TestPass123!" });

    // Appel RPC — chiffre + persiste + corrige pays/prenom/nom (fix mig 82+83 OAuth)
    const { error: rpcErr } = await userClient.rpc("complete_my_profile", {
      p_ville: "Brazzaville",
      p_quartier: "Bacongo",
      p_telephone: "+2422060000333",
      p_pays: "CG",
      p_prenom: "Eve",
      p_nom: "Mboungou",
    });
    expect(rpcErr).toBeNull();

    // Vérifie côté serveur : get_my_phone retourne la valeur claire
    const { data: phone } = await userClient.rpc("get_my_phone");
    expect(phone).toBe("+2422060000333");

    // Vérifie pays + prenom + nom mis à jour
    const { data: row } = await admin
      .from("users")
      .select("pays, prenom, nom")
      .eq("id", userId)
      .single<{ pays: string; prenom: string; nom: string }>();
    expect(row?.pays).toBe("CG");
    expect(row?.prenom).toBe("Eve");
    expect(row?.nom).toBe("Mboungou");
  });

  it("accept_auth_cgu — idempotente (2e appel n'écrase pas)", async () => {
    const { client, userId } = await signupRealFlow({
      email: `frank-${Date.now()}@niqo.test`,
      password: "TestPass123!",
      prenom: "Frank",
      nom: "Test",
      telephone: "+2250700000444",
      pays: "CI",
      ville: "Abidjan",
    });
    userIdsToCleanup.push(userId);

    const admin = adminClient();
    const { data: first } = await admin
      .from("users")
      .select("cgu_accepted_at, cgu_version")
      .eq("id", userId)
      .single<{ cgu_accepted_at: string; cgu_version: string }>();

    // 2e call avec une version différente
    const { error } = await client.rpc("accept_auth_cgu", { p_version: "2.0" });
    expect(error).toBeNull();

    const { data: second } = await admin
      .from("users")
      .select("cgu_accepted_at, cgu_version")
      .eq("id", userId)
      .single<{ cgu_accepted_at: string; cgu_version: string }>();

    expect(second?.cgu_accepted_at).toBe(first?.cgu_accepted_at);
    expect(second?.cgu_version).toBe(first?.cgu_version);
  });

  it("UNIQUE telephone (mig 84) — 2nd signup with same phone is rejected", async () => {
    const ts = Date.now();
    const sharedPhone = `+22507${String(ts).slice(-7)}`;
    const a = await signupRealFlow({
      email: `henri-${ts}@niqo.test`,
      password: "TestPass123!",
      prenom: "Henri",
      nom: "First",
      telephone: sharedPhone,
      pays: "CI",
      ville: "Abidjan",
    });
    userIdsToCleanup.push(a.userId);

    // 2e signup même phone — supabase.auth.signUp devrait remonter l'erreur
    // unique_violation native du trigger handle_new_user (insertion dans
    // auth.users → trigger → INSERT public.users → unique_violation sur
    // telephone_hash → la transaction auth.users rollback aussi).
    let caught: unknown = null;
    try {
      await signupRealFlow({
        email: `irene-${ts}@niqo.test`,
        password: "TestPass123!",
        prenom: "Irene",
        nom: "Duplicate",
        telephone: sharedPhone,
        pays: "CI",
        ville: "Abidjan",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    const msg = (caught as Error)?.message ?? "";
    // Le message contient soit le code 'PHONE_ALREADY_USED' (si le trigger
    // re-raise), soit 'users_telephone_hash_unique' (unique_violation native).
    expect(
      msg.includes("PHONE_ALREADY_USED") ||
        msg.includes("users_telephone_hash_unique") ||
        msg.toLowerCase().includes("database error")
    ).toBe(true);

    // Sanity check : Henri (le 1er) garde bien son compte
    const admin = adminClient();
    const { data: row } = await admin
      .from("users")
      .select("prenom, telephone_hash")
      .eq("id", a.userId)
      .single<{ prenom: string; telephone_hash: unknown }>();
    expect(row?.prenom).toBe("Henri");
    expect(row?.telephone_hash).not.toBeNull();
  });

  it("UNIQUE telephone (mig 84) — complete_my_profile collision raise PHONE_ALREADY_USED", async () => {
    const ts = Date.now();
    const sharedPhone = `+22507${String(ts).slice(-7)}`;
    // 1er user normal qui prend le téléphone
    const a = await signupRealFlow({
      email: `julien-${ts}@niqo.test`,
      password: "TestPass123!",
      prenom: "Julien",
      nom: "First",
      telephone: sharedPhone,
      pays: "CI",
      ville: "Abidjan",
    });
    userIdsToCleanup.push(a.userId);

    // 2e user OAuth-like (sans téléphone au signup), tente de poser le même
    // numéro via complete_my_profile → la RPC catch unique_violation et raise
    // PHONE_ALREADY_USED (P0020).
    const admin = adminClient();
    const email = `kassim-${ts}@niqo.test`;
    const { data: signupData, error: signupErr } = await admin.auth.admin.createUser({
      email,
      password: "TestPass123!",
      email_confirm: true,
      user_metadata: { prenom: "Kassim", nom: "OAuth", pays: "CI" },
      app_metadata: { provider: "google" },
    });
    if (signupErr) throw signupErr;
    userIdsToCleanup.push(signupData.user.id);

    const userClient = createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await userClient.auth.signInWithPassword({ email, password: "TestPass123!" });

    const { error: rpcErr } = await userClient.rpc("complete_my_profile", {
      p_ville: "Abidjan",
      p_quartier: null,
      p_telephone: sharedPhone,
      p_pays: "CI",
      p_prenom: "Kassim",
      p_nom: "OAuth",
    });
    expect(rpcErr).not.toBeNull();
    expect(rpcErr?.message).toContain("PHONE_ALREADY_USED");
  });

  it("delete_my_account — cascade auth + public.users", async () => {
    const { client, userId } = await signupRealFlow({
      email: `grace-${Date.now()}@niqo.test`,
      password: "TestPass123!",
      prenom: "Grace",
      nom: "Delete",
      telephone: "+2250700000555",
      pays: "CI",
      ville: "Abidjan",
    });
    // Pas de push à cleanup — la RPC va tout supprimer

    const admin = adminClient();
    const { data: before } = await admin
      .from("users")
      .select("id")
      .eq("id", userId);
    expect(before?.length).toBe(1);

    const { error } = await client.rpc("delete_my_account");
    expect(error).toBeNull();

    // public.users gone
    const { data: afterPublic } = await admin
      .from("users")
      .select("id")
      .eq("id", userId);
    expect(afterPublic?.length).toBe(0);

    // auth.users gone (via admin.auth.admin.getUserById)
    const { data: afterAuth, error: authError } = await admin.auth.admin.getUserById(userId);
    // L'admin SDK retourne une erreur ou un user null selon la version
    expect(authError !== null || afterAuth?.user === null).toBe(true);
  });
});
