import { View } from "react-native";

interface Props {
  /** Étape actuelle (1-indexed). Toutes les étapes <= step sont coloriées. */
  step: number;
  /** Nombre total d'étapes. Default 3. */
  total?: number;
}

/**
 * Barre de progression segmentée pour wizards multi-step.
 * 3 segments par défaut, équirépartis, gap 2 (8px). Segments passés et
 * actuel = coral, futurs = gray-200.
 *
 * Pas d'animation pour l'MVP — la mise à jour est instantanée. Si on veut
 * un fill progressif, wrap chaque segment dans un Animated.View avec
 * useAnimatedStyle qui interpole sur step.
 */
export function WizardProgress({ step, total = 3 }: Props) {
  return (
    <View
      className="flex-row gap-2"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: step }}
      accessibilityLabel={`Étape ${step} sur ${total}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const segmentIndex = i + 1;
        const isActive = step >= segmentIndex;
        return (
          <View
            key={segmentIndex}
            className={`flex-1 h-1 rounded-full ${
              isActive ? "bg-niqo-coral" : "bg-niqo-gray-200"
            }`}
          />
        );
      })}
    </View>
  );
}
