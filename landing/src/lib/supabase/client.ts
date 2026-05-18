"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase pour Client Components ('use client').
 *
 * Utilisé pour les actions interactives qui ne peuvent pas être Server Actions
 * (ex: signin form, listener auth state). Le client lit les cookies directement
 * depuis document.cookie.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
