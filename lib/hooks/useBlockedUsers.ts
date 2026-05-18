import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import {
  fetchMyBlockedUserIds,
  subscribeToBlockedUsers,
} from "@/lib/blocking";

/**
 * Hook global pour la liste des user IDs bloqués par l'user authentifié.
 *
 * Sources de mise à jour :
 * - Au focus de l'écran (retour depuis page Profil → Bloqués)
 * - En live via Realtime (subscribe blocked_users WHERE blocker_id = self)
 *
 * Le retour est un Set<string> pour des lookups O(1) côté consumers
 * (filter annonces / conversations / commentaires, etc.).
 *
 * Utilisation typique :
 *   const blockedIds = useBlockedUsers();
 *   const filteredAnnonces = annonces.filter(a => !blockedIds.has(a.vendeur_id));
 */
export function useBlockedUsers(): {
  blockedIds: Set<string>;
  isLoaded: boolean;
  refresh: () => Promise<void>;
} {
  const { profile, isAuthenticated } = useAuth();
  const userId = profile?.id;
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setBlockedIds(new Set());
      setIsLoaded(true);
      return;
    }
    try {
      const ids = await fetchMyBlockedUserIds();
      setBlockedIds(new Set(ids));
    } catch (e) {
      // Fail-soft : sur erreur réseau, on garde l'état précédent.
      // Le filter front continue de fonctionner avec la liste périmée plutôt
      // que de tout afficher (qui révélerait du contenu bloqué).
      console.warn("[useBlockedUsers] refresh failed:", (e as Error).message);
    } finally {
      setIsLoaded(true);
    }
  }, [isAuthenticated]);

  // Refresh au focus de l'écran
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  // Realtime subscribe — sync en direct sur INSERT/DELETE blocked_users
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeToBlockedUsers(userId, () => {
      void refresh();
    });
    return unsubscribe;
  }, [userId, refresh]);

  return { blockedIds, isLoaded, refresh };
}
