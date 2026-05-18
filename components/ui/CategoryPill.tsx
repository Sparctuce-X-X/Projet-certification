import { Pressable, Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";

interface CategoryPillProps {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onPress: () => void;
}

export function CategoryPill({
  label,
  Icon,
  active,
  onPress,
}: CategoryPillProps) {
  const containerClass = active
    ? "bg-niqo-coral-light"
    : "bg-niqo-gray-50";
  const textClass = active ? "text-niqo-coral" : "text-niqo-gray-800";
  const iconColor = active ? "#D85A30" : "#444441";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Catégorie ${label}`}
      accessibilityState={{ selected: active }}
      className={`flex-row items-center gap-2 ${containerClass} rounded-full px-4 min-h-[44px] active:opacity-60`}
    >
      <Icon size={18} color={iconColor} />
      <Text
        className={`font-body text-label ${textClass}`}
        allowFontScaling={false}
      >
        {label}
      </Text>
    </Pressable>
  );
}
