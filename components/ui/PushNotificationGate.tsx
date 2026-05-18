import { useRouter } from "expo-router";
import { useEffect } from "react";

import {
  addPushNotificationListeners,
  setupPushHandler,
  type PushNotificationData,
} from "@/lib/push";

/**
 * Composant invisible qui :
 *   1. Setup le handler global (foreground display) — 1× au boot
 *   2. Attache les listeners (notif reçue + tap) — 1× au boot
 *   3. Route le tap via expo-router selon `data.url` ou des champs structurés
 *
 * À render au niveau root (_layout.tsx), à côté de AuthGate.
 *
 * Logique de routing du tap :
 *   - `data.url` (deep link niqo://...) → Linking.openURL
 *   - `data.conversation_id` → /messages/[conversationId]
 *   - `data.annonce_id` → /announce/[id]
 *   - `data.verification_id` → /profile/verification
 *   - `data.signalement_id` (côté target) → /profile (banner refus / score)
 *   - sinon : noop (notif sans cible)
 */
export function PushNotificationGate() {
  const router = useRouter();

  useEffect(() => {
    setupPushHandler();

    const cleanup = addPushNotificationListeners({
      onTap: (data: PushNotificationData) => {
        if (data.url && typeof data.url === "string") {
          // Deep link générique — laisse expo-router gérer le scheme
          router.push(data.url as never);
          return;
        }
        if (data.conversation_id && typeof data.conversation_id === "string") {
          router.push(`/messages/${data.conversation_id}` as never);
          return;
        }
        if (data.annonce_id && typeof data.annonce_id === "string") {
          router.push(`/announce/${data.annonce_id}` as never);
          return;
        }
        if (data.verification_id) {
          router.push("/profile/verification" as never);
          return;
        }
        if (data.signalement_id) {
          router.push("/profile" as never);
          return;
        }
        // Pas de cible → noop, l'app s'ouvre normalement
      },
    });

    return cleanup;
  }, [router]);

  return null;
}
