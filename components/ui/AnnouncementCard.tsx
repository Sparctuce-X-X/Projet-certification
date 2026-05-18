import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Heart, Sparkles } from "lucide-react-native";
import { memo, useCallback } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import type { AnnonceListItem } from "@/lib/annonces";

interface AnnouncementCardProps {
  item: AnnonceListItem;
  onPress: (id: string) => void;
  onFavorite: (id: string) => void;
  /** true = cœur plein coral, false = cœur vide noir */
  isFavorited?: boolean;
}

function formatPrice(value: number, currency: string): string {
  return (
    value.toLocaleString("fr-FR").replace(/\u00A0/g, " ") + " " + currency
  );
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "hier";
  if (days < 30) return `${days}j`;
  const months = Math.floor(days / 30);
  return `${months} mois`;
}

function isNew(isoDate: string): boolean {
  return Date.now() - new Date(isoDate).getTime() < 24 * 60 * 60 * 1000;
}

/**
 * Badge overlay affiché sur les annonces non-actives (vues depuis Mes favoris,
 * où on ne filtre pas par statut côté DB pour préserver l'historique des
 * annonces aimées). Sur Home/Search, statut est toujours "active" (filtré
 * côté DB), donc cette branche reste invisible.
 */
const UNAVAILABLE_LABEL: Partial<Record<AnnonceListItem["statut"], string>> = {
  en_cours: "Réservée",
  vendue: "Vendue",
  suspendue: "Retirée",
  expiree: "Expirée",
};

function AnnouncementCardImpl({
  item,
  onPress,
  onFavorite,
  isFavorited = false,
}: AnnouncementCardProps) {
  const isLocation = item.type_offre === "location";
  const priceLabel = isLocation
    ? `${formatPrice(item.prix, "FCFA")}/mois`
    : formatPrice(item.prix, "FCFA");
  const isRecent = isNew(item.created_at);
  const unavailableLabel = UNAVAILABLE_LABEL[item.statut];
  const isUnavailable = !!unavailableLabel;

  // ── Animation cœur ────────────────────────────────────────────────────
  const heartScale = useSharedValue(1);
  const heartOpacity = useSharedValue(1);

  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
    opacity: heartOpacity.value,
  }));

  const onHeartPress = useCallback(() => {
    // Haptic feedback — léger pour le retrait, moyen pour l'ajout.
    // Pas de vibration sur Android < 10 (pas de support haptic engine).
    if (Platform.OS === "ios") {
      void Haptics.impactAsync(
        isFavorited
          ? Haptics.ImpactFeedbackStyle.Light
          : Haptics.ImpactFeedbackStyle.Medium
      );
    }

    if (!isFavorited) {
      // Ajout : squeeze → pop → bounce (UX guideline : 150-300ms total)
      heartScale.value = withSequence(
        withTiming(0.5, { duration: 120 }),
        withSpring(1.25, { damping: 5, stiffness: 280 }),
        withSpring(1, { damping: 8, stiffness: 200 })
      );
    } else {
      // Retrait : pulsation subtile
      heartScale.value = withSequence(
        withTiming(0.8, { duration: 120 }),
        withSpring(1, { damping: 10, stiffness: 250 })
      );
    }
    onFavorite(item.id);
  }, [isFavorited, item.id, onFavorite, heartScale]);

  return (
    <View className="flex-1">
      <View className="relative">
        <Pressable
          onPress={() => onPress(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`${item.titre}, ${priceLabel}, à ${item.ville}`}
          className="active:opacity-80"
        >
          <View className="aspect-square rounded-card overflow-hidden bg-niqo-gray-100">
            <Image
              source={{ uri: item.cover_url }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              placeholder={{ blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4" }}
              transition={200}
            />
            {isUnavailable && (
              <View className="absolute inset-0 bg-niqo-black/45 items-center justify-center">
                <View className="bg-niqo-black/85 rounded-full px-3 py-1">
                  <Text className="font-display text-caption text-niqo-white">
                    {unavailableLabel}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </Pressable>

        {/* Badges top-left — masqués si annonce indisponible (overlay déjà signal fort) */}
        <View className="absolute top-2 left-2 gap-1">
          {!isUnavailable && (item.is_boosted &&
          item.boost_until &&
          new Date(item.boost_until) > new Date() ? (
            <View className="bg-niqo-coral rounded-full px-2 py-0.5 flex-row items-center gap-1">
              <Sparkles size={10} color="#FFFFFF" strokeWidth={2.4} />
              <Text className="font-body text-micro text-niqo-white font-medium">
                Sponsorisé
              </Text>
            </View>
          ) : isRecent ? (
            <View className="bg-niqo-coral rounded-full px-2 py-0.5">
              <Text className="font-body text-micro text-niqo-white">
                Nouveau
              </Text>
            </View>
          ) : null)}
          {item.type_offre && (
            <View className={`rounded-full px-2 py-0.5 ${
              item.type_offre === "location"
                ? "bg-niqo-status-escrow-bg"
                : "bg-niqo-status-complete-bg"
            }`}>
              <Text className={`font-body text-micro ${
                item.type_offre === "location"
                  ? "text-niqo-status-escrow-text"
                  : "text-niqo-status-complete-text"
              }`}>
                {item.type_offre === "location" ? "Location" : "Vente"}
              </Text>
            </View>
          )}
        </View>

        <Pressable
          onPress={onHeartPress}
          accessibilityRole="button"
          accessibilityLabel={
            isFavorited ? "Retirer des favoris" : "Ajouter aux favoris"
          }
          hitSlop={8}
          className="absolute top-2 right-2 w-9 h-9 rounded-full bg-niqo-white items-center justify-center active:opacity-60"
        >
          <Animated.View style={heartStyle}>
            <Heart
              size={18}
              color={isFavorited ? "#D85A30" : "#1A1A1A"}
              fill={isFavorited ? "#D85A30" : "none"}
            />
          </Animated.View>
        </Pressable>
      </View>

      <Pressable
        onPress={() => onPress(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`${item.titre}, ${priceLabel}`}
        className="mt-2 active:opacity-80"
      >
        <Text
          className={`font-body text-body ${isUnavailable ? "text-niqo-gray-500 line-through" : "text-niqo-black"}`}
          numberOfLines={2}
        >
          {item.titre}
        </Text>
        <Text
          className={`mt-1 font-mono text-price ${isUnavailable ? "text-niqo-gray-500" : "text-niqo-black"}`}
          allowFontScaling={false}
        >
          {priceLabel}
        </Text>
        <Text className="mt-1 font-body text-micro text-niqo-gray-500">
          {item.ville} · {timeAgo(item.created_at)}
        </Text>
      </Pressable>
    </View>
  );
}

export const AnnouncementCard = memo(AnnouncementCardImpl);
