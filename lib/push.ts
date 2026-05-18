import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

// ── Setup global du handler (foreground display) ─────────────────────────────
// À appeler 1× au boot de l'app (dans _layout.tsx).
// Définit comment les notifs reçues quand l'app est ouverte sont affichées.

export function setupPushHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

// ── Permission + récupération du token ───────────────────────────────────────

/**
 * Demande la permission de notifications, récupère un ExpoPushToken et
 * l'enregistre côté DB via la RPC `register_push_token`.
 *
 * À appeler après login (depuis AuthProvider) — pas au signup splash, pour
 * ne pas brusquer l'user avec la modale système avant qu'il ait vu la valeur
 * de l'app.
 *
 * Idempotent : la RPC fait un upsert sur le token (UNIQUE constraint).
 *
 * Retourne le token Expo (string) si OK, null si l'user a refusé / device
 * non supporté (simulateur, web). Ne throw jamais — push notif = best effort.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Simulateur iOS / émulateur Android : pas de support push réel
    if (__DEV__) console.log("[push] skip register — not a real device");
    return null;
  }

  // Permission system
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    if (__DEV__) console.log("[push] permission denied");
    return null;
  }

  // Android : créer le channel par défaut (priority high pour wake-up)
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Notifications Niqo",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#D85A30",
      sound: "default",
    });
  }

  // Récupère l'ExpoPushToken (nécessite un projectId EAS configuré)
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } })
      .easConfig?.projectId;

  if (!projectId) {
    if (__DEV__) console.warn("[push] no projectId in expoConfig.extra.eas");
    return null;
  }

  let tokenData: Notifications.ExpoPushToken;
  try {
    tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  } catch (e) {
    if (__DEV__) console.error("[push] getExpoPushTokenAsync failed", e);
    return null;
  }

  const token = tokenData.data;
  const platform = Platform.OS as "ios" | "android" | "web";
  const deviceName = Device.deviceName ?? null;

  // Enregistre côté DB
  try {
    const { error } = await supabase.rpc("register_push_token", {
      p_token: token,
      p_platform: platform,
      p_device_name: deviceName,
    });
    if (error) {
      if (__DEV__) console.error("[push] register_push_token failed", error);
      return null;
    }
  } catch (e) {
    if (__DEV__) console.error("[push] register threw", e);
    return null;
  }

  if (__DEV__) console.log("[push] registered token", token.slice(0, 20) + "...");
  return token;
}

// ── Listeners notif reçue / tap ──────────────────────────────────────────────

export interface PushNotificationData {
  url?: string; // deep link niqo://...
  conversation_id?: string;
  annonce_id?: string;
  verification_id?: string;
  signalement_id?: string;
  [key: string]: unknown;
}

/**
 * Attache 2 listeners + récupère le tap initial (cold-start) :
 *   - foreground notif reçue (l'user est dans l'app) — appelle onReceive
 *   - tap sur une notif (l'app était killed → cold start, OU background)
 *     → appelle onTap. Le cold-start tap est récupéré via
 *     `getLastNotificationResponseAsync()` parce que le listener ne fire
 *     que sur les events suivants — sans ça, l'app cold-startée ouvre Home
 *     au lieu de la cible de la notif tappée.
 *
 * À appeler 1× au boot dans _layout.tsx. Retourne une fonction cleanup.
 */
export function addPushNotificationListeners(args: {
  onReceive?: (data: PushNotificationData) => void;
  onTap: (data: PushNotificationData) => void;
}): () => void {
  // Cold-start : si l'app a été lancée en tappant une notif (killed), la
  // réponse est dispo via getLastNotificationResponseAsync. Best-effort.
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (!response) return;
    const data = (response.notification.request.content.data ??
      {}) as PushNotificationData;
    args.onTap(data);
  });

  const receiveSub = Notifications.addNotificationReceivedListener((notif) => {
    const data = (notif.request.content.data ?? {}) as PushNotificationData;
    args.onReceive?.(data);
  });

  const tapSub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = (response.notification.request.content.data ?? {}) as PushNotificationData;
      args.onTap(data);
    }
  );

  return () => {
    receiveSub.remove();
    tapSub.remove();
  };
}

// ── Cleanup au logout ────────────────────────────────────────────────────────

/**
 * Appelé au signOut — supprime le token de l'user courant.
 * Empêche d'envoyer des push à un device dont l'user s'est déconnecté.
 *
 * RLS owner DELETE est en place (mig 64) → fonctionne tant que la session
 * est encore valide. Appeler AVANT supabase.auth.signOut().
 */
export async function unregisterPushTokenForCurrentDevice(): Promise<void> {
  if (!Device.isDevice) return;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } })
      .easConfig?.projectId;
  if (!projectId) return;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from("push_tokens").delete().eq("token", tokenData.data);
  } catch {
    // Best-effort — pas de throw
  }
}
