import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { createClient } from "@/lib/supabase/server";

/**
 * Layout admin protégé — sidebar + auth gate is_admin.
 *
 * Le middleware (middleware.ts) garantit déjà qu'un user est authentifié.
 * Ici on vérifie en plus que `users.is_admin = true`, sinon redirect login
 * avec error param. La séparation middleware (auth) + layout (autorisation)
 * permet de garder le middleware edge-runtime léger.
 */
export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // L3 audit : préserver l'URL d'origine pour ré-atterrir après login.
  // Le middleware (lib/supabase/middleware.ts) injecte `x-pathname` dans les
  // request headers. Pour le cas !user (race condition middleware), on
  // ajoute `?redirect=`. Pour le cas not_admin (user auth mais pas admin),
  // on combine `?error=not_admin&redirect=`. LoginForm lit déjà ces params.
  const reqHeaders = await headers();
  const currentPath = reqHeaders.get("x-pathname") ?? "";
  const redirectQs =
    currentPath.startsWith("/admin") && currentPath !== "/admin/login"
      ? `&redirect=${encodeURIComponent(currentPath)}`
      : "";

  if (!user) {
    redirect(`/admin/login?${redirectQs ? redirectQs.slice(1) : ""}`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("is_admin, email, prenom, nom")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    redirect(`/admin/login?error=not_admin${redirectQs}`);
  }

  // Count pending verifications pour le badge sidebar
  const { count: pendingCount } = await supabase
    .from("verifications_identite")
    .select("id", { count: "exact", head: true })
    .eq("statut", "pending");

  return (
    <div className="flex min-h-screen bg-niqo-gray-50">
      <AdminSidebar
        userEmail={profile.email ?? user.email ?? ""}
        userName={`${profile.prenom ?? ""} ${profile.nom ?? ""}`.trim() || "Admin"}
        verificationsPendingCount={pendingCount ?? 0}
      />
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
