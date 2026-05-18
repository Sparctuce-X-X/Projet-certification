import { router, usePathname } from "expo-router";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Guard global monté dans app/_layout.tsx. Quand un user est connecté avec
 * un profil incomplet (typiquement post-OAuth Google/Apple : pas de telephone),
 * force la nav vers /auth/complete-profile.
 *
 * Pas de UI — le composant retourne null, l'effet redirige.
 *
 * Pourquoi un guard global plutôt qu'un check par écran :
 *   - Couvre tous les chemins (deep link, cold-start, browse anonyme→signin)
 *   - Une seule source de vérité (`needsProfileCompletion` dans AuthProvider)
 *   - Pas de fork dans chaque action gated (sell, buy, contact…)
 *
 * Le caller `complete-profile` lui-même est exclu pour éviter une redirect
 * loop pendant que l'écran est ouvert.
 */
export function ProfileCompletionGate() {
  const { needsProfileCompletion, isLoading } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    // Ne rien faire pendant l'hydratation cold-start (évite flash si fetch
    // profile en cours).
    if (isLoading) return;
    if (!needsProfileCompletion) return;
    // Déjà sur l'écran cible, ou navigation vers une page légale depuis
    // cet écran : ne pas interrompre.
    if (
      pathname === "/auth/complete-profile" ||
      pathname.startsWith("/legal/")
    )
      return;

    router.replace("/auth/complete-profile");
  }, [needsProfileCompletion, isLoading, pathname]);

  return null;
}
