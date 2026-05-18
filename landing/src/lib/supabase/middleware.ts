import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware Supabase — refresh la session expirée + gate /admin/*.
 *
 * Architecture en 2 couches :
 *   1. Middleware (ici, edge-runtime) : check user authentifié → redirect
 *      vers /admin/login si pas de session
 *   2. Layout admin (app/admin/layout.tsx, server component) : check
 *      `users.is_admin = true` via DB query → redirect si pas admin
 *
 * Cette séparation permet au middleware de rester rapide et edge-compatible
 * (pas de DB query lourde en edge runtime). Le layout fait la vraie
 * autorisation côté serveur de page.
 */
export async function updateSession(request: NextRequest) {
  // L3 audit : injecte le pathname courant en header pour que les layouts
  // server puissent le lire via `headers()` (Next 16 ne l'expose plus
  // nativement). Utile pour le layout admin qui doit préserver `?redirect=`
  // dans le cas not_admin (user auth mais profile.is_admin=false).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT : getUser() refresh la session si JWT expiré
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/admin/login";
  const isAdminRoute = pathname.startsWith("/admin");

  // Gate /admin/* (sauf /admin/login) : si pas authentifié → login
  if (isAdminRoute && !isLoginPage && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
