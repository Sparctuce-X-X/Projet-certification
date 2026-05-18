import { Star } from "lucide-react-native";
import { Pressable, View } from "react-native";

interface Props {
  /** Note actuelle (0-5). 0 = aucune étoile remplie. */
  value: number;
  /** Si fourni, le composant devient interactif (boutons). */
  onChange?: (next: 1 | 2 | 3 | 4 | 5) => void;
  size?: number;
  /** Couleur des étoiles remplies. Default coral Niqo. */
  color?: string;
  /** Couleur du contour des étoiles vides. Default gris 200. */
  emptyColor?: string;
  /** Espacement horizontal entre étoiles. Default 4. */
  gap?: number;
}

/**
 * 5 étoiles. Interactif si `onChange` fourni, readonly sinon.
 * Touch target ≥44px assuré en interactif (padding interne).
 */
export function StarRating({
  value,
  onChange,
  size = 20,
  color = "#D85A30",
  emptyColor = "#D8D7CD",
  gap = 4,
}: Props) {
  const stars = [1, 2, 3, 4, 5] as const;
  const isInteractive = !!onChange;
  // En interactif, on garantit 44x44 par étoile pour respecter les touch targets HIG.
  const hitPadding = isInteractive ? Math.max(0, (44 - size) / 2) : 0;

  return (
    <View
      style={{ flexDirection: "row", alignItems: "center" }}
      accessibilityRole={isInteractive ? "adjustable" : undefined}
      accessibilityLabel={`Note ${value} sur 5`}
    >
      {stars.map((n) => {
        const filled = n <= value;
        const StarSvg = (
          <Star
            size={size}
            color={filled ? color : emptyColor}
            fill={filled ? color : "none"}
            strokeWidth={filled ? 1.5 : 2}
          />
        );

        if (!isInteractive) {
          return (
            <View
              key={n}
              style={{ marginRight: n < 5 ? gap : 0 }}
            >
              {StarSvg}
            </View>
          );
        }

        return (
          <Pressable
            key={n}
            onPress={() => onChange?.(n)}
            accessibilityRole="button"
            accessibilityLabel={`${n} étoile${n > 1 ? "s" : ""}`}
            style={{
              padding: hitPadding,
              marginRight: n < 5 ? gap : 0,
            }}
          >
            {StarSvg}
          </Pressable>
        );
      })}
    </View>
  );
}
