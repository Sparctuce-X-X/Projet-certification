import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Connexion · Niqo Admin",
  robots: { index: false, follow: false },
};

/**
 * Page login admin — full-screen, hors layout sidebar.
 *
 * Si le user est déjà connecté et admin → redirect direct sur /admin/verifications
 * (pas la peine de lui re-demander ses identifiants).
 */
export default async function AdminLoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.is_admin) {
      redirect("/admin/verifications");
    }
  }

  return (
    <div className="min-h-screen bg-niqo-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-[400px] bg-white border border-niqo-gray-200 rounded-2xl p-8 shadow-sm">
        {/* Logo */}
        <div className="flex items-baseline justify-center mb-7">
          <span className="font-display text-2xl font-bold text-niqo-black">
            niqo
          </span>
          <span className="font-display text-2xl font-bold text-niqo-coral">
            .
          </span>
          <span className="ml-2.5 font-mono text-[11px] uppercase tracking-widest text-niqo-gray-500">
            Admin
          </span>
        </div>

        <h1 className="font-display text-xl font-bold text-niqo-black text-center mb-2">
          Connexion back-office
        </h1>
        <p className="text-sm text-niqo-gray-500 text-center mb-7">
          Accès réservé aux administrateurs.
        </p>

        <LoginForm />
      </div>
    </div>
  );
}
