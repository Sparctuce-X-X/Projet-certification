import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import {
  Camera as CameraIcon,
  RefreshCw,
  Settings,
  X,
} from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

interface CameraCaptureProps {
  /** Forme du guide visuel — rectangle pour CNI, oval pour selfie */
  guideShape: "rectangle" | "oval";
  /** Tip principal au-dessus du guide (ex: "Cadre ta CNI recto") */
  tipTitle: string;
  /** Tip secondaire (ex: "Bien à plat sur fond uni, sans reflet") */
  tipSubtitle: string;
  /** Index de l'étape actuelle (1-based) pour le header "Étape X / 5" */
  step: number;
  totalSteps: number;
  /** Caméra back (CNI) ou front (selfie) */
  facing?: "back" | "front";
  /** Capture validée — l'orchestrateur enchaîne sur CaptureReview */
  onCapture: (localUri: string) => void;
  /** Fermeture du wizard */
  onClose: () => void;
}

/**
 * Vue caméra plein écran avec :
 *   - Mask sombre semi-transparent (4 vues entourant le guide)
 *   - Guide central rectangle (CNI 4:3) ou ovale (selfie 5:7) avec angles coral
 *   - Header progress + bouton fermer
 *   - Tip text au-dessus du guide
 *   - Bouton capture rond coral 72×72 avec ring blanc + animation tap
 *   - Permission gate avec écran de demande / refus
 *
 * Aucune option galerie — KYC anti-fraude exige live capture (cf. CDC §2.6).
 */
export function CameraCapture({
  guideShape,
  tipTitle,
  tipSubtitle,
  step,
  totalSteps,
  facing = "back",
  onCapture,
  onClose,
}: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);

  // Animation tap bouton capture
  const captureScale = useSharedValue(1);
  const captureStyle = useAnimatedStyle(() => ({
    transform: [{ scale: captureScale.value }],
  }));

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);

    if (Platform.OS === "ios") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    captureScale.value = withSequence(
      withTiming(0.92, { duration: 80 }),
      withSpring(1, { damping: 8, stiffness: 250 })
    );

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        base64: false,
        skipProcessing: false,
      });
      if (photo?.uri) {
        onCapture(photo.uri);
      }
    } catch {
      // silent — un échec de capture n'est pas bloquant, l'user peut retenter
    } finally {
      setCapturing(false);
    }
  }, [capturing, captureScale, onCapture]);

  // ── Gate permission ──
  if (!permission) {
    // En attente du chargement initial — écran neutre
    return <View className="flex-1 bg-niqo-black" />;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-niqo-black px-6 items-center justify-center">
        <View className="w-16 h-16 rounded-full bg-niqo-coral/15 items-center justify-center mb-6">
          <CameraIcon size={32} color="#D85A30" />
        </View>
        <Text className="font-display text-h2 text-niqo-white text-center mb-3">
          Caméra nécessaire.
        </Text>
        <Text className="font-body text-body text-niqo-white/70 text-center max-w-xs mb-8 leading-relaxed">
          Pour vérifier ton identité, Niqo doit prendre tes pièces et un selfie
          en direct depuis l&apos;app. Pas de galerie autorisée — c&apos;est
          notre garantie anti-fraude.
        </Text>
        {permission.canAskAgain ? (
          <Pressable
            onPress={() => void requestPermission()}
            className="bg-niqo-coral rounded-btn min-h-[44px] px-6 items-center justify-center active:opacity-80"
          >
            <Text className="font-body text-label text-niqo-white">
              Autoriser la caméra
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            className="bg-niqo-coral rounded-btn min-h-[44px] px-6 flex-row items-center gap-2 active:opacity-80"
          >
            <Settings size={16} color="#FFFFFF" />
            <Text className="font-body text-label text-niqo-white">
              Ouvrir les réglages
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          className="mt-4 min-h-[44px] px-6 items-center justify-center active:opacity-60"
        >
          <Text className="font-body text-label text-niqo-white/60">
            Annuler
          </Text>
        </Pressable>
      </View>
    );
  }

  // ── Vue caméra avec overlay ──
  // L'overlay est fait avec 4 vues entourant le guide central :
  //   ┌──────────────┐
  //   │     top      │
  //   ├──┬────────┬──┤
  //   │L │ guide  │R │
  //   ├──┴────────┴──┤
  //   │    bottom    │
  //   └──────────────┘
  // C'est plus performant qu'un masque SVG et compatible 100% RN.

  const isOval = guideShape === "oval";
  // Dimensions guide (en % de l'écran ; ajusté pour 360px baseline)
  const guideWidthPct = isOval ? 70 : 84;
  const guideAspect = isOval ? 5 / 7 : 4 / 3; // selfie portrait, CNI landscape
  const overlayBg = "rgba(0,0,0,0.65)";

  return (
    <View className="flex-1 bg-niqo-black">
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing={facing}
        animateShutter
      />

      {/* ── Overlay (au-dessus de la caméra) ── */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        {/* Top mask */}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "22%",
            backgroundColor: overlayBg,
          }}
        />

        {/* Bottom mask + tip + bouton capture */}
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "32%",
            backgroundColor: overlayBg,
          }}
        >
          {/* Tip text (top of bottom area) */}
          <View className="px-6 pt-5">
            <Text className="font-display text-label text-niqo-white text-center">
              {tipTitle}
            </Text>
            <Text className="mt-1 font-body text-micro text-niqo-white/70 text-center">
              {tipSubtitle}
            </Text>
          </View>

          {/* Bouton capture */}
          <View className="flex-1 items-center justify-center">
            <Pressable
              onPress={handleCapture}
              accessibilityRole="button"
              accessibilityLabel="Prendre la photo"
              accessibilityState={{ disabled: capturing }}
              disabled={capturing}
              className="active:opacity-90"
              hitSlop={12}
            >
              <Animated.View
                style={[
                  {
                    width: 72,
                    height: 72,
                    borderRadius: 36,
                    backgroundColor: capturing ? "#A8421F" : "#D85A30",
                    borderWidth: 4,
                    borderColor: "#FFFFFF",
                    alignItems: "center",
                    justifyContent: "center",
                  },
                  captureStyle,
                ]}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: capturing ? "#A8421F" : "#D85A30",
                  }}
                />
              </Animated.View>
            </Pressable>
          </View>
        </View>

        {/* Side masks (level guide) */}
        <View
          style={{
            position: "absolute",
            top: "22%",
            bottom: "32%",
            left: 0,
            width: `${(100 - guideWidthPct) / 2}%`,
            backgroundColor: overlayBg,
          }}
        />
        <View
          style={{
            position: "absolute",
            top: "22%",
            bottom: "32%",
            right: 0,
            width: `${(100 - guideWidthPct) / 2}%`,
            backgroundColor: overlayBg,
          }}
        />

        {/* Guide frame central */}
        <View
          style={{
            position: "absolute",
            top: "22%",
            bottom: "32%",
            left: `${(100 - guideWidthPct) / 2}%`,
            width: `${guideWidthPct}%`,
            alignItems: "center",
            justifyContent: "center",
          }}
          pointerEvents="none"
        >
          <View
            style={{
              width: "100%",
              aspectRatio: guideAspect,
              borderWidth: 2,
              borderColor: "rgba(255,255,255,0.5)",
              borderRadius: isOval ? 9999 : 12,
              maxHeight: "100%",
            }}
          >
            {/* Corners coral pour rectangle uniquement (l'oval n'a pas d'angles) */}
            {!isOval && (
              <>
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    left: -2,
                    width: 28,
                    height: 28,
                    borderTopWidth: 4,
                    borderLeftWidth: 4,
                    borderColor: "#D85A30",
                    borderTopLeftRadius: 12,
                  }}
                />
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    width: 28,
                    height: 28,
                    borderTopWidth: 4,
                    borderRightWidth: 4,
                    borderColor: "#D85A30",
                    borderTopRightRadius: 12,
                  }}
                />
                <View
                  style={{
                    position: "absolute",
                    bottom: -2,
                    left: -2,
                    width: 28,
                    height: 28,
                    borderBottomWidth: 4,
                    borderLeftWidth: 4,
                    borderColor: "#D85A30",
                    borderBottomLeftRadius: 12,
                  }}
                />
                <View
                  style={{
                    position: "absolute",
                    bottom: -2,
                    right: -2,
                    width: 28,
                    height: 28,
                    borderBottomWidth: 4,
                    borderRightWidth: 4,
                    borderColor: "#D85A30",
                    borderBottomRightRadius: 12,
                  }}
                />
              </>
            )}
          </View>
        </View>

        {/* Header — close + step indicator */}
        <View
          className="absolute top-0 left-0 right-0 px-4 pt-12 flex-row items-center justify-between"
          pointerEvents="box-none"
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Quitter la vérification"
            hitSlop={12}
            className="w-11 h-11 rounded-full bg-black/40 items-center justify-center active:opacity-60"
          >
            <X size={20} color="#FFFFFF" strokeWidth={2.4} />
          </Pressable>
          <View className="bg-black/40 rounded-full px-3 h-9 items-center justify-center">
            <Text className="font-mono text-micro text-niqo-white">
              Étape {step} / {totalSteps}
            </Text>
          </View>
          <View className="w-11" />
        </View>
      </View>
    </View>
  );
}

// Re-export icon for symmetry (not used externally but documents pattern)
export const CameraCaptureIcons = { CameraIcon, RefreshCw };
