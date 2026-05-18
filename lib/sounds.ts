import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Sons de l'app Niqo — chargés une seule fois, rejoués à la demande.
 *
 * Fichiers attendus dans assets/sounds/ :
 *   - send.mp3    — swoosh court (envoi de message)
 *   - receive.mp3 — pop subtil (réception de message)
 *
 * Si les fichiers n'existent pas encore, les fonctions jouent uniquement
 * le haptic feedback (fallback gracieux).
 */

let sendSound: Audio.Sound | null = null;
let receiveSound: Audio.Sound | null = null;
let initialized = false;

/**
 * Pré-charge les sons en mémoire. Appeler une seule fois au mount de
 * l'écran chat. Idempotent.
 */
export async function initSounds(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    // Mode audio : ne pas interrompre la musique de l'user
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    const { sound: s1 } = await Audio.Sound.createAsync(
      require("@/assets/sounds/send.wav"),
      { shouldPlay: false, volume: 0.5 }
    );
    sendSound = s1;

    const { sound: s2 } = await Audio.Sound.createAsync(
      require("@/assets/sounds/receive.wav"),
      { shouldPlay: false, volume: 0.4 }
    );
    receiveSound = s2;
  } catch {
    // Sons absents ou erreur de chargement — haptic-only fallback
  }
}

/**
 * Joue le son d'envoi de message + haptic léger.
 */
export async function playSendSound(): Promise<void> {
  // Haptic feedback
  if (Platform.OS === "ios") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  if (!sendSound) return;
  try {
    await sendSound.setPositionAsync(0);
    await sendSound.playAsync();
  } catch {
    // silent — son non-critique
  }
}

/**
 * Joue le son de réception de message + haptic subtil.
 */
export async function playReceiveSound(): Promise<void> {
  if (Platform.OS === "ios") {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  if (!receiveSound) return;
  try {
    await receiveSound.setPositionAsync(0);
    await receiveSound.playAsync();
  } catch {
    // silent
  }
}

/**
 * Libère les ressources audio. Appeler au unmount de l'écran chat.
 */
export async function releaseSounds(): Promise<void> {
  try {
    await sendSound?.unloadAsync();
    await receiveSound?.unloadAsync();
  } catch {
    // silent
  }
  sendSound = null;
  receiveSound = null;
  initialized = false;
}
