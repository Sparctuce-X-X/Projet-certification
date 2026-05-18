import { Stack, router } from "expo-router";
import { ArrowLeft, Heart } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnnouncementCard } from "@/components/ui/AnnouncementCard";
import type { AnnonceListItem } from "@/lib/annonces";
import {
  fetchMyFavorites,
  loadMyFavoriteIds,
  toggleFavorite,
} from "@/lib/favorites";

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const [annonces, setAnnonces] = useState<AnnonceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const items = await fetchMyFavorites();
      setAnnonces(items);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onAnnouncementPress = useCallback((id: string) => {
    router.push(`/announce/${id}`);
  }, []);

  const onFavoritePress = useCallback(
    (id: string) => {
      void (async () => {
        try {
          await toggleFavorite(id);
          // Retirer de la liste locale immédiatement
          setAnnonces((prev) => prev.filter((a) => a.id !== id));
        } catch {
          // Silent
        }
      })();
    },
    []
  );

  if (loading) {
    return (
      <View className="flex-1 bg-niqo-white items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color="#D85A30" />
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}
      className="bg-niqo-white"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View className="flex-row items-center px-4 py-2 border-b border-niqo-gray-150">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="flex-1 text-center font-display text-h3 text-niqo-black">
          {annonces.length > 0 ? `Mes favoris · ${annonces.length}` : "Mes favoris"}
        </Text>
        <View className="min-w-[44px]" />
      </View>

      <FlatList
        data={annonces}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 32,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D85A30"
          />
        }
        renderItem={({ item }) => (
          <AnnouncementCard
            item={item}
            onPress={onAnnouncementPress}
            onFavorite={onFavoritePress}
            isFavorited
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-20 px-4">
            <Heart size={40} color="#888780" />
            <Text className="mt-4 font-display text-h3 text-niqo-gray-800 text-center">
              Pas encore de favoris
            </Text>
            <Text className="font-body text-body text-niqo-gray-500 text-center mt-2">
              Appuie sur le cœur d'une annonce pour la sauvegarder ici.
            </Text>
            <Pressable
              onPress={() => router.replace("/home")}
              accessibilityRole="button"
              className="mt-6 bg-niqo-coral rounded-btn px-6 min-h-[44px] items-center justify-center active:opacity-80"
            >
              <Text className="font-body text-label text-niqo-white">
                Explorer les annonces
              </Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}
