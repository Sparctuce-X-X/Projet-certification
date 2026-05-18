import { Image } from "expo-image";
import { Stack, router } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  Info,
  MessageCircle,
  MessageSquareWarning,
  ShoppingCart,
  Star,
  User,
} from "lucide-react-native";
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

import { fetchMyAchats, type MyAchat } from "@/lib/achats";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(value: number): string {
  return value.toLocaleString("fr-FR").replace(/ /g, " ") + " FCFA";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function MesAchatsScreen() {
  const insets = useSafeAreaInsets();
  const [achats, setAchats] = useState<MyAchat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const items = await fetchMyAchats();
      setAchats(items);
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
      <View className="flex-row items-center px-4 py-2">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="flex-1 text-center font-display text-h3 text-niqo-black">
          Mes achats
        </Text>
        <View className="min-w-[44px]" />
      </View>

      <FlatList
        data={achats}
        keyExtractor={(item) => item.conversation_id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D85A30"
          />
        }
        renderItem={({ item }) => {
          const annonceDeleted = !item.annonce_id;
          return (
            <View className="bg-niqo-white border-b border-niqo-gray-100 py-3">
              <Pressable
                onPress={() => {
                  if (item.annonce_id) router.push(`/announce/${item.annonce_id}`);
                }}
                disabled={annonceDeleted}
                accessibilityRole="button"
                accessibilityLabel={item.annonce_titre}
                className="flex-row active:opacity-80"
              >
                {/* Cover */}
                <View className="w-20 h-20 rounded-card overflow-hidden bg-niqo-gray-100">
                  {item.annonce_cover_url ? (
                    <Image
                      source={{ uri: item.annonce_cover_url }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                      placeholder={{ blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4" }}
                      transition={150}
                    />
                  ) : (
                    <View className="flex-1 items-center justify-center">
                      <ShoppingCart size={20} color="#888780" />
                    </View>
                  )}
                </View>

                {/* Info */}
                <View className="flex-1 ml-3 justify-between">
                  <View>
                    <Text
                      className={`font-body text-body ${annonceDeleted ? "text-niqo-gray-500 italic" : "text-niqo-black"}`}
                      numberOfLines={2}
                    >
                      {item.annonce_titre}
                    </Text>
                    {item.annonce_prix !== null && (
                      <Text
                        className="mt-1 font-mono text-caption text-niqo-black"
                        allowFontScaling={false}
                      >
                        {formatPrice(item.annonce_prix)}
                      </Text>
                    )}
                  </View>

                  {/* Vendeur + date */}
                  <View className="flex-row items-center mt-1">
                    {item.vendeur_avatar_url ? (
                      <Image
                        source={{ uri: item.vendeur_avatar_url }}
                        style={{ width: 16, height: 16, borderRadius: 8 }}
                        contentFit="cover"
                      />
                    ) : (
                      <View className="w-4 h-4 rounded-full bg-niqo-gray-200 items-center justify-center">
                        <User size={10} color="#888780" />
                      </View>
                    )}
                    <Text
                      className={`ml-1.5 font-body text-micro ${item.vendeur_deleted ? "text-niqo-gray-500 italic" : "text-niqo-gray-800"}`}
                      numberOfLines={1}
                    >
                      {item.vendeur_prenom}
                    </Text>
                    <Text className="mx-1.5 text-niqo-gray-300">·</Text>
                    <Text className="font-body text-micro text-niqo-gray-500">
                      {formatDate(item.rdv_date)}
                    </Text>
                  </View>
                </View>
              </Pressable>

              {/* Footer adapté selon état rencontre (mig 86 + 88) */}
              <AchatFooter
                state={item.rencontre_state}
                noteGiven={item.my_avis_note}
                conversationId={item.conversation_id}
                vendeurPrenom={item.vendeur_prenom}
              />
            </View>
          );
        }}
        ListHeaderComponent={
          <View className="flex-row items-start gap-2 bg-niqo-gray-50 border border-niqo-gray-150 rounded-card px-3 py-2.5 mb-3 mt-2">
            <Info size={14} color="#888780" />
            <Text className="flex-1 font-body text-micro text-niqo-gray-800 leading-snug">
              Les achats immobiliers ne sont pas tracés ici (Niqo n&apos;intervient pas dans le paiement immobilier).
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-20 px-4">
            <ShoppingCart size={32} color="#888780" />
            <Text className="mt-3 font-display text-h3 text-niqo-gray-800 text-center">
              Pas encore d&apos;achat
            </Text>
            <Text className="mt-2 font-body text-body text-niqo-gray-500 text-center">
              Tes achats apparaîtront ici une fois que tu auras eu un RDV avec un vendeur.
            </Text>
            <Pressable
              onPress={() => router.replace("/home")}
              className="mt-6 bg-niqo-coral rounded-btn px-8 min-h-[48px] items-center justify-center active:opacity-80"
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

// ── Sub-component : footer card achat ────────────────────────────────────────

interface AchatFooterProps {
  state: MyAchat["rencontre_state"];
  noteGiven: number | null;
  conversationId: string;
  vendeurPrenom: string;
}

/**
 * Footer adapté à l'état rencontre post-RDV (mig 86 + 88) :
 *   - "pending"  : pill warning "Confirme la rencontre" (acheteur n'a pas répondu)
 *   - "disputed" : pill danger "Voir le désaccord" (vendeur a dit non)
 *   - "met" + pas d'avis : bouton coral "Noter" (notation possible)
 *   - "met" + avis posé  : ★ "Tu as noté X/5" + lien "Conversation"
 *
 * Audit ui-ux-pro-max :
 *   - hitSlop universel sur les pills (h-8 visuel = 44px touch effectif)
 *   - Lien "Conversation" retiré pour les 3 états action (redondant : le pill
 *     ouvre déjà la conv). Gardé uniquement pour l'état passif "met-noté"
 *     où sinon pas d'accès rapide à la conv.
 *   - Icon `MessageSquareWarning` pour pending (action chat-oriented vs
 *     l'ancien `HelpCircle` qui semblait passif).
 */

const PILL_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };

function AchatFooter({
  state,
  noteGiven,
  conversationId,
  vendeurPrenom,
}: AchatFooterProps) {
  const onOpenConv = () =>
    router.push(`/messages/${conversationId}` as never);

  if (state === "pending") {
    return (
      <View className="mt-3 ml-[92px]">
        <Pressable
          onPress={onOpenConv}
          hitSlop={PILL_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`Confirmer la rencontre avec ${vendeurPrenom}`}
          className="self-start flex-row items-center bg-niqo-warning/10 border border-niqo-warning/30 rounded-btn px-3 h-8 active:opacity-80"
        >
          <MessageSquareWarning size={12} color="#BA7517" />
          <Text className="ml-1.5 font-display text-micro text-niqo-warning">
            Confirme la rencontre
          </Text>
        </Pressable>
      </View>
    );
  }

  if (state === "disputed") {
    return (
      <View className="mt-3 ml-[92px]">
        <Pressable
          onPress={onOpenConv}
          hitSlop={PILL_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Voir le désaccord"
          className="self-start flex-row items-center bg-niqo-danger/10 border border-niqo-danger/30 rounded-btn px-3 h-8 active:opacity-80"
        >
          <AlertTriangle size={12} color="#E24B4A" />
          <Text className="ml-1.5 font-display text-micro text-niqo-danger">
            Voir le désaccord
          </Text>
        </Pressable>
      </View>
    );
  }

  // état "met" — distinguer noté vs pas noté
  if (noteGiven === null) {
    return (
      <View className="mt-3 ml-[92px]">
        <Pressable
          onPress={onOpenConv}
          hitSlop={PILL_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`Noter ${vendeurPrenom}`}
          className="self-start bg-niqo-coral rounded-btn px-3 h-8 items-center justify-center active:opacity-80"
        >
          <Text className="font-display text-micro text-niqo-white">
            Noter
          </Text>
        </Pressable>
      </View>
    );
  }

  // met + avis posé → indicateur passif + lien Conv (seul cas où Conv reste utile)
  return (
    <View className="flex-row items-center justify-between mt-3 ml-[92px]">
      <View className="flex-row items-center">
        <Star size={12} color="#D85A30" fill="#D85A30" />
        <Text className="ml-1 font-body text-micro text-niqo-gray-800">
          Tu as noté {noteGiven}/5
        </Text>
      </View>
      <Pressable
        onPress={onOpenConv}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Ouvrir la conversation"
        className="flex-row items-center active:opacity-60"
      >
        <MessageCircle size={12} color="#888780" />
        <Text className="ml-1 font-body text-micro text-niqo-gray-500">
          Conversation
        </Text>
      </Pressable>
    </View>
  );
}
