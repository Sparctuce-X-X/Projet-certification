import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Client Supabase pour Server Components, Server Actions, Route Handlers.
 *
 * Le client lit/écrit les cookies de session via `next/headers`. En Server
 * Component, l'écriture peut échouer silencieusement (la response est déjà
 * envoyée) — c'est OK, le middleware aura déjà refresh la session.
 *
 * Pattern @supabase/ssr v0.10 : getAll/setAll batched (évite les conflicts
 * de set/remove individuels).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — pas de write permis, OK
          }
        },
      },
    }
  );
}
