import { Image } from "expo-image";
import { Check, RotateCcw, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

interface CaptureReviewProps {
  /** URI local de la photo capturée (file://...) */
  localUri: string;
  /** Index étape (cohérent avec CameraCapture) */
  step: number;
  totalSteps: number;
  /** Titre context (ex: "CNI recto", "Selfie") */
  label: string;
  onRetake: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Écran de revue post-capture. L'user voit sa photo plein écran et choisit :
 *   - Recommencer (revient à <CameraCapture>)
 *   - Continuer (avance le wizard vers le step suivant)
 *
 * Pas d'auto-skip — la validation explicite empêche les captures involontaires
 * (mouvement parasite au tap) de polluer la soumission KYC.
 */
export function CaptureReview({
  localUri,
  step,
  totalSteps,
  label,
  onRetake,
  onConfirm,
  onClose,
}: CaptureReviewProps) {
  return (
    <View className="flex-1 bg-niqo-black">
      {/* Photo plein écran */}
      <Image
        source={{ uri: localUri }}
        style={{ flex: 1 }}
        contentFit="contain"
        transition={120}
      />

      {/* Header */}
      <View className="absolute top-0 left-0 right-0 px-4 pt-12 flex-row items-center justify-between">
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

      {/* Label en bas-gauche au-dessus des boutons */}
      <View className="absolute bottom-32 left-0 right-0 items-center">
        <View className="bg-black/55 rounded-full px-4 py-2">
          <Text className="font-display text-label text-niqo-white">
            {label}
          </Text>
        </View>
      </View>

      {/* Boutons sticky bottom */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 16,
          paddingBottom: 28,
          paddingTop: 16,
          backgroundColor: "rgba(0,0,0,0.55)",
          flexDirection: "row",
          gap: 12,
        }}
      >
        <Pressable
          onPress={onRetake}
          accessibilityRole="button"
          accessibilityLabel="Refaire la photo"
          className="flex-1 min-h-[52px] flex-row items-center justify-center gap-2 border-2 border-niqo-white/70 rounded-btn active:opacity-70"
        >
          <RotateCcw size={18} color="#FFFFFF" strokeWidth={2.2} />
          <Text className="font-body text-label text-niqo-white">
            Refaire
          </Text>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel="Valider la photo et continuer"
          className="flex-1 min-h-[52px] flex-row items-center justify-center gap-2 bg-niqo-coral rounded-btn active:opacity-80"
        >
          <Check size={18} color="#FFFFFF" strokeWidth={2.5} />
          <Text className="font-body text-label text-niqo-white">
            Continuer
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
