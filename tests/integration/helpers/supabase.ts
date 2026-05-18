import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Client admin (service_role JWT) — bypass RLS. À utiliser uniquement pour
 * setup/cleanup de fixtures, JAMAIS dans une assertion business.
 */
export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client anonyme (anon JWT) — comme un user pas connecté.
 */
export function anonClient(): SupabaseClient {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Crée un user via signup et retourne son client authentifié + son ID.
 * Cleanup à faire avec `cleanupUsers([userId])` dans afterAll/afterEach.
 *
 * Retry GoTrue createUser jusqu'à 4 fois avec backoff exponentiel : en CI
 * (`pool: forks` + `singleFork: true`, ~14 fichiers de tests séquentiels),
 * la dernière suite (`favoris.test.ts` au moment d'écrire) peut taper sur
 * une fenêtre transitoire où l'admin endpoint répond "Database error
 * checking email" (HTTP 500). Re-tenter résout systématiquement.
 */
export async function createTestUser(opts?: {
  email?: string;
  password?: string;
  prenom?: string;
  nom?: string;
  pays?: "CI" | "CG";
  ville?: string;
  isAdmin?: boolean;
}): Promise<{ client: SupabaseClient; userId: string; email: string }> {
  const email = opts?.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@niqo.test`;
  const password = opts?.password ?? "TestPass123!";

  const admin = adminClient();

  let userId: string | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        prenom: opts?.prenom ?? "Test",
        nom: opts?.nom ?? "User",
      },
    });
    if (!error && data?.user?.id) {
      userId = data.user.id;
      break;
    }
    lastErr = error;
    // Backoff exponentiel : 250ms, 500ms, 1000ms
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    }
  }
  if (!userId) throw lastErr;

  // Force le profil public.users (le trigger handle_new_user devrait le faire,
  // mais on s'assure des champs Niqo-spécifiques)
  await admin.from("users").upsert({
    id: userId,
    email,
    prenom: opts?.prenom ?? "Test",
    nom: opts?.nom ?? "User",
    pays: opts?.pays ?? "CI",
    ville: opts?.ville ?? "Abidjan",
    is_admin: opts?.isAdmin ?? false,
    is_active: true,
  });

  // Login pour récupérer un client authentifié
  const userClient = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await userClient.auth.signInWithPassword({ email, password });
  if (loginError) throw loginError;

  return { client: userClient, userId, email };
}

/**
 * Cleanup users de test (cascade DB supprime annonces / messages / etc.).
 * À appeler dans afterAll.
 */
export async function cleanupUsers(userIds: string[]): Promise<void> {
  const admin = adminClient();
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
}
