import { Pressable, Text } from "react-native";
import { Search } from "lucide-react-native";

interface SearchBarProps {
  onPress: () => void;
}

export function SearchBar({ onPress }: SearchBarProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel="Rechercher un article"
      className="flex-row items-center bg-niqo-gray-50 rounded-card px-4 h-12 active:opacity-60"
    >
      <Search size={20} color="#888780" />
      <Text className="ml-3 font-body text-body text-niqo-gray-500">
        Rechercher un article…
      </Text>
    </Pressable>
  );
}
