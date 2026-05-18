import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { fetchUnreadCount, subscribeToAllMessages } from "@/lib/messages";

/**
 * Hook global pour le compteur de messages non-lus du badge BottomNav.
 *
 * Sources de mise à jour :
 * - Au focus de l'écran (retour du chat, switch d'app, etc.)
 * - En live via Realtime (subscribeToAllMessages) tant que l'utilisateur
 *   est authentifié — le badge se met à jour partout dans l'app, pas
 *   seulement quand on revient sur l'onglet Messages.
 *
 * `fetchUnreadCount` filtre par `expediteur_id != self`, donc les messages
 * que l'utilisateur s'envoie lui-même ne déclenchent pas d'incrément
 * cosmétique.
 */
export function useUnreadCount(): number {
  const { isAuthenticated } = useAuth();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) {
        setCount(0);
        return;
      }
      void fetchUnreadCount().then(setCount);
    }, [isAuthenticated])
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    const channel = subscribeToAllMessages(() => {
      void fetchUnreadCount().then(setCount);
    });
    return () => {
      void channel.unsubscribe();
    };
  }, [isAuthenticated]);

  return count;
}
