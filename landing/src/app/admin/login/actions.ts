"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Sanitize le `redirect` query param pour empêcher un open redirect post-login.
 * Next.js `redirect()` accepte n'importe quel URL absolu — sans filtre, un
 * attaquant pourrait crafter `?redirect=https://evil.com/...` et exploiter
 * l'admin Niqo comme rebond de confiance pour un phishing post-auth.
 *
 * Politique : path absolu interne uniquement. Bloque les URLs externes
 * (https://evil.com), les protocol-relative (//evil.com) et tout ce qui
 * n'est pas un path commençant par `/`.
 */
function safeAdminRedirect(raw: string | null): string {
  const fallback = "/admin/verifications";
  if (!raw || typeof raw !== "string") return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback; // protocol-relative
  return raw;
}

export async function signInAdmin(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const redirectTo = safeAdminRedirect(formData.get("redirect") as string | null);

  if (!email || !password) {
    return { error: "Email et mot de passe requis." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { error: "Identifiants invalides." };
  }

  // Vérifier is_admin
  const { data: profile } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    await supabase.auth.signOut();
    return {
      error: "Ce compte n'a pas accès au back-office.",
    };
  }

  redirect(redirectTo);
}
