import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Alert, Pressable, Text, View } from "react-native";
import { Building2, Heart, ShoppingBag } from "lucide-react-native";

import { useAuth } from "@/lib/auth/AuthProvider";

export type HomeMode = "annonces" | "immo";

interface HomeHeaderProps {
  onFavoritesPress: () => void;
  mode: HomeMode;
  onModeChange: (mode: HomeMode) => void;
}

async function devResetCountry() {
  try {
    await AsyncStorage.removeItem("niqo_country");
  } catch {}
  router.replace("/");
}

const Wordmark = (
  <>
    <Text className="font-display text-h2 text-niqo-black" allowFontScaling={false}>
      niqo
    </Text>
    <Text className="font-display text-h2 text-niqo-coral" allowFontScaling={false}>
      .
    </Text>
  </>
);

export function HomeHeader({ onFavoritesPress, mode, onModeChange }: HomeHeaderProps) {
  const { isAuthenticated, signOut } = useAuth();

  const showDevMenu = () => {
    Alert.alert("Menu dev", "Actions de debug réservées au développement.", [
      { text: "Annuler", style: "cancel" },
      ...(isAuthenticated
        ? [{ text: "Se déconnecter", onPress: () => void signOut() }]
        : []),
      {
        text: "Réinitialiser pays",
        style: "destructive" as const,
        onPress: () => void devResetCountry(),
      },
    ]);
  };

  return (
    <View className="bg-niqo-white border-b border-niqo-gray-150">
      {/* Top row : logo + favoris */}
      <View className="px-4 h-14 flex-row items-center justify-between">
        {__DEV__ ? (
          <Pressable
            onLongPress={showDevMenu}
            delayLongPress={700}
            accessibilityRole="button"
            accessibilityLabel="Niqo. Appui long pour le menu dev."
            className="flex-row items-baseline active:opacity-80"
          >
            {Wordmark}
          </Pressable>
        ) : (
          <View className="flex-row items-baseline">{Wordmark}</View>
        )}

        <Pressable
          onPress={onFavoritesPress}
          accessibilityRole="button"
          accessibilityLabel="Mes favoris"
          className="items-center justify-center min-h-[44px] min-w-[44px] active:opacity-60"
        >
          <Heart size={22} color="#1A1A1A" />
        </Pressable>
      </View>

      {/* Tab row : Annonces | Immo */}
      <View className="flex-row px-4">
        <Pressable
          onPress={() => onModeChange("annonces")}
          accessibilityRole="tab"
          accessibilityLabel="Onglet Annonces"
          accessibilityState={{ selected: mode === "annonces" }}
          className="flex-1 flex-row items-center justify-center gap-2 py-2.5"
        >
          <ShoppingBag size={16} color={mode === "annonces" ? "#D85A30" : "#888780"} />
          <Text
            className={`font-display text-label ${
              mode === "annonces" ? "text-niqo-coral" : "text-niqo-gray-500"
            }`}
          >
            Annonces
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onModeChange("immo")}
          accessibilityRole="tab"
          accessibilityLabel="Onglet Immobilier"
          accessibilityState={{ selected: mode === "immo" }}
          className="flex-1 flex-row items-center justify-center gap-2 py-2.5"
        >
          <Building2 size={16} color={mode === "immo" ? "#D85A30" : "#888780"} />
          <Text
            className={`font-display text-label ${
              mode === "immo" ? "text-niqo-coral" : "text-niqo-gray-500"
            }`}
          >
            Immo
          </Text>
        </Pressable>
      </View>

      {/* Indicateur onglet actif */}
      <View className="flex-row px-4">
        <View className={`flex-1 h-0.5 ${mode === "annonces" ? "bg-niqo-coral" : "bg-transparent"}`} />
        <View className={`flex-1 h-0.5 ${mode === "immo" ? "bg-niqo-coral" : "bg-transparent"}`} />
      </View>
    </View>
  );
}
