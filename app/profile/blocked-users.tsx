import { useFocusEffect } from "@react-navigation/native";
import { Image } from "expo-image";
import { Stack, router } from "expo-router";
import { ArrowLeft, ShieldOff, X } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  fetchMyBlockedUsersWithProfiles,
  unblockUser,
  type BlockedUserDisplay,
} from "@/lib/blocking";
import { useAuth } from "@/lib/auth/AuthProvider";

function formatBlockedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getInitial(prenom: string): string {
  return (prenom[0] ?? "?").toUpperCase();
}

interface RowProps {
  user: BlockedUserDisplay;
  onUnblock: (user: BlockedUserDisplay) => void;
  onPress: (id: string) => void;
}

function BlockedUserRow({ user, onUnblock, onPress }: RowProps) {
  return (
    <View className="flex-row items-center px-4 min-h-[64px] bg-niqo-white">
      <Pressable
        onPress={() => onPress(user.id)}
        accessibilityRole="button"
        accessibilityLabel={`${user.prenom}, bloqué le ${formatBlockedDate(user.blocked_at)}`}
        accessibilityHint="Tape pour voir son profil"
        className="flex-1 flex-row items-center py-3 active:opacity-60"
      >
        {/* Avatar 40px : photo si dispo, sinon initiale sur coral. */}
        {user.avatar_url ? (
          <Image
            source={{ uri: user.avatar_url }}
            style={{ width: 40, height: 40, borderRadius: 20 }}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View
            style={{ width: 40, height: 40, borderRadius: 20 }}
            className="bg-niqo-coral items-center justify-center"
          >
            <Text
              className="font-display text-label text-niqo-white"
              allowFontScaling={false}
            >
              {getInitial(user.prenom)}
            </Text>
          </View>
        )}

        <View className="ml-3 flex-1">
          <Text
            className="font-body text-body text-niqo-black"
            numberOfLines={1}
          >
            {user.prenom}
          </Text>
          <Text
            className="font-mono text-micro text-niqo-gray-500 mt-0.5"
            numberOfLines={1}
          >
            Bloqué le {formatBlockedDate(user.blocked_at)}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => onUnblock(user)}
        accessibilityRole="button"
        accessibilityLabel={`Débloquer ${user.prenom}`}
        accessibilityHint="Cette personne pourra à nouveau te contacter"
        hitSlop={8}
        className="min-h-[44px] min-w-[44px] items-center justify-center active:opacity-60"
      >
        <X size={20} color="#888780" />
      </Pressable>
    </View>
  );
}

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [users, setUsers] = useState<BlockedUserDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const list = await fetchMyBlockedUsersWithProfiles();
      setUsers(list);
    } catch (e) {
      setError("Impossible de charger ta liste. Vérifie ta connexion.");
      console.warn(
        "[blocked-users] load failed:",
        (e as Error)?.message ?? e
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh à chaque focus — l'user peut bloquer ailleurs (sheet sur /u/[id])
  // puis revenir ici, on veut la liste fraîche sans pull manuel.
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      void load(false);
    }, [isAuthenticated, load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  const onUnblock = useCallback((user: BlockedUserDisplay) => {
    Alert.alert(
      `Débloquer ${user.prenom} ?`,
      "Cette personne pourra à nouveau te contacter et voir tes annonces.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Débloquer",
          style: "destructive",
          onPress: () => {
            void (async () => {
              // Optimistic remove — feedback instantané. Si RPC fail, on remet.
              setUsers((prev) => prev.filter((u) => u.id !== user.id));
              try {
                const result = await unblockUser(user.id);
                if (!result.success) {
                  Alert.alert(
                    "Erreur",
                    result.error ?? "Le déblocage a échoué. Réessaie."
                  );
                  void load(true);
                }
              } catch {
                Alert.alert(
                  "Erreur",
                  "Vérifie ta connexion et réessaie."
                );
                void load(true);
              }
            })();
          },
        },
      ]
    );
  }, [load]);

  const onPressProfile = useCallback((id: string) => {
    router.push(`/u/${id}`);
  }, []);

  // Redirect anonyme — defensive (route gated mais possible deep-link)
  if (!authLoading && !isAuthenticated) {
    router.replace("/home");
    return null;
  }

  return (
    <View
      style={{ paddingTop: insets.top }}
      className="flex-1 bg-niqo-white"
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View className="bg-niqo-white border-b border-niqo-gray-150 px-3 h-14 flex-row items-center">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-1 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="ml-1 font-display text-h3 text-niqo-black">
          Utilisateurs bloqués
        </Text>
      </View>

      {/* Loading initial — spinner centré (pas de skeleton, liste souvent vide
          ou très courte → skeleton ferait du bruit visuel pour rien). */}
      {loading && users.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#D85A30" />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BlockedUserRow
              user={item}
              onUnblock={onUnblock}
              onPress={onPressProfile}
            />
          )}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-niqo-gray-150 ml-[68px]" />
          )}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 32,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#D85A30"
            />
          }
          ListEmptyComponent={
            error ? (
              <View className="flex-1 items-center justify-center px-6">
                <Text className="font-body text-body text-niqo-danger text-center">
                  {error}
                </Text>
                <Pressable
                  onPress={() => void load(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Réessayer"
                  className="mt-4 bg-niqo-coral rounded-btn px-6 min-h-[44px] items-center justify-center active:opacity-80"
                >
                  <Text className="font-body text-label text-niqo-white">
                    Réessayer
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="flex-1 items-center justify-center px-6 gap-3 pt-10">
                <ShieldOff size={56} color="#A8A89F" />
                <Text className="font-display text-h3 text-niqo-black text-center">
                  Aucun utilisateur bloqué
                </Text>
                <Text
                  className="font-body text-body text-niqo-gray-500 text-center"
                  style={{ maxWidth: 280 }}
                >
                  Tu pourras bloquer un utilisateur depuis son profil ou
                  depuis une conversation.
                </Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}
