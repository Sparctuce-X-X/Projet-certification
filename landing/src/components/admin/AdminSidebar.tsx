"use client";

import { Activity, BarChart3, Flag, History, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

interface AdminSidebarProps {
  userEmail: string;
  userName: string;
  verificationsPendingCount?: number;
}

interface NavItem {
  href: string;
  label: string;
  Icon: typeof ShieldCheck;
  badge?: number;
}

/**
 * Sidebar admin — pleine hauteur fixe 240px, style Linear/Vercel.
 *
 * Pas collapsable pour MVP : admin solo sur desktop. Les badges count
 * (ex: pending verifications) sont fetched par le parent server-side et
 * passés via props pour éviter les fetch côté client.
 *
 * Highlight active state via `usePathname` (Client Component obligatoire).
 */
export function AdminSidebar({
  userEmail,
  userName,
  verificationsPendingCount,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // L5 audit : try/catch pour ne pas laisser l'admin bloqué en
      // "Déconnexion…" si signOut throw (network coupé, Supabase down).
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/admin/login");
      router.refresh();
    } catch (err) {
      console.error("[admin] signOut failed", err);
      setSigningOut(false);
      alert(
        "Impossible de se déconnecter (problème réseau). Réessaie dans quelques secondes."
      );
    }
  };

  const navItems: NavItem[] = [
    {
      href: "/admin/verifications",
      label: "Vérifications",
      Icon: ShieldCheck,
      badge: verificationsPendingCount,
    },
    { href: "/admin/signalements", label: "Signalements", Icon: Flag },
    { href: "/admin/kpis", label: "KPIs", Icon: BarChart3 },
    { href: "/admin/audit", label: "Audit log", Icon: History },
    { href: "/admin/observability", label: "Observabilité", Icon: Activity },
  ];

  return (
    <aside className="w-60 shrink-0 bg-white border-r border-niqo-gray-200 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 h-16 flex items-center border-b border-niqo-gray-200">
        <Link
          href="/admin/verifications"
          className="flex items-baseline cursor-pointer"
          aria-label="Niqo Admin"
        >
          <span className="font-display text-xl font-bold text-niqo-black">
            niqo
          </span>
          <span className="font-display text-xl font-bold text-niqo-coral">
            .
          </span>
          <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-niqo-gray-500">
            Admin
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-5">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  // L4 audit : aria-current="page" pour signaler l'état actif
                  // au screen reader (la couleur seule ne suffit pas).
                  aria-current={active ? "page" : undefined}
                  className={`group flex items-center gap-3 px-3 h-10 rounded-lg text-sm font-medium transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-niqo-coral focus-visible:ring-offset-2 ${
                    active
                      ? "bg-niqo-coral-light text-niqo-coral"
                      : "text-niqo-gray-800 hover:bg-niqo-gray-50"
                  }`}
                >
                  <item.Icon className="w-4 h-4" strokeWidth={2.2} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="bg-niqo-coral text-white text-[10px] font-semibold px-1.5 min-w-[20px] h-5 rounded-full flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User footer */}
      <div className="px-3 pb-5 pt-3 border-t border-niqo-gray-200">
        <div className="px-3 mb-2">
          <p className="font-display text-sm font-semibold text-niqo-black truncate">
            {userName}
          </p>
          <p className="text-xs text-niqo-gray-500 truncate" title={userEmail}>
            {userEmail}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={signingOut}
          className="w-full flex items-center gap-2 px-3 h-9 rounded-lg text-sm text-niqo-gray-800 hover:bg-niqo-gray-50 transition-colors duration-150 cursor-pointer disabled:opacity-60"
        >
          <LogOut className="w-4 h-4" strokeWidth={2.2} />
          <span>{signingOut ? "Déconnexion…" : "Se déconnecter"}</span>
        </button>
      </div>
    </aside>
  );
}
