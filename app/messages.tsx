import { useFocusEffect } from "@react-navigation/native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  ImageOff,
  MessageCircle,
  MessageSquareWarning,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomNav, type TabKey } from "@/components/ui/BottomNav";
import { TrustedAvatar } from "@/components/ui/TrustedAvatar";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useUnreadCount } from "@/lib/hooks/useUnreadCount";
import {
  deriveConvBadge,
  fetchMyConversations,
  subscribeToAllMessages,
  type ConvBadgeKind,
  type ConversationListItem,
} from "@/lib/messages";

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(isoDate: string | null): string {
  if (!isoDate) return "";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Hier";
  if (days < 7) return `${days}j`;
  return new Date(isoDate).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

/** Format compact pour le badge "RDV · {date}". Auj/Demain + heure si proche,
 *  sinon date courte. Toujours en heure locale du device. */
function formatRdvShort(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const time = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `Auj. · ${time}`;
  if (isTomorrow) return `Demain · ${time}`;
  return (
    date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) +
    ` · ${time}`
  );
}

// ── Badge état RDV par card de conv ────────────────────────────────────────
//
// Cohérent avec les pills AchatFooter (px-2 / h-6 ici car contexte dense en
// liste, vs h-8 sur la card Mes achats). Couleurs respectent la palette
// `niqo-status-*` (bleu/vert/gris) + `niqo-warning` / `niqo-danger` pour
// signaler l'urgence d'une action user.

interface ConvRdvBadgeProps {
  badge: ConvBadgeKind;
}

function ConvRdvBadge({ badge }: ConvRdvBadgeProps) {
  if (badge.kind === "none") return null;

  if (badge.kind === "sold" || badge.kind === "rented") {
    return (
      <View className="self-start flex-row items-center bg-niqo-status-complete-bg rounded-full px-2 h-6 mt-1">
        <CheckCircle2 size={11} color="#1D9E75" />
        <Text className="ml-1 font-display text-2xs text-niqo-status-complete-text">
          {badge.kind === "rented" ? "Louée" : "Vendue"}
        </Text>
      </View>
    );
  }

  if (badge.kind === "rdv_proposed") {
    return (
      <View className="self-start flex-row items-center bg-niqo-status-escrow-bg rounded-full px-2 h-6 mt-1">
        <Clock size={11} color="#185FA5" />
        <Text className="ml-1 font-display text-2xs text-niqo-status-escrow-text">
          RDV proposé
        </Text>
      </View>
    );
  }

  if (badge.kind === "rdv_confirmed") {
    return (
      <View className="self-start flex-row items-center bg-niqo-status-complete-bg rounded-full px-2 h-6 mt-1">
        <CalendarCheck size={11} color="#1D9E75" />
        <Text className="ml-1 font-display text-2xs text-niqo-status-complete-text">
          RDV · {formatRdvShort(badge.date)}
        </Text>
      </View>
    );
  }

  if (badge.kind === "pending_meeting") {
    return (
      <View className="self-start flex-row items-center bg-niqo-warning/10 border border-niqo-warning/30 rounded-full px-2 h-6 mt-1">
        <MessageSquareWarning size={11} color="#BA7517" />
        <Text className="ml-1 font-display text-2xs text-niqo-warning">
          Confirme la rencontre
        </Text>
      </View>
    );
  }

  // disputed — gris si admin a tranché, rouge sinon
  if (badge.admin_decided) {
    return (
      <View className="self-start flex-row items-center bg-niqo-gray-100 rounded-full px-2 h-6 mt-1">
        <CheckCircle2 size={11} color="#888780" />
        <Text className="ml-1 font-display text-2xs text-niqo-gray-800">
          RDV examiné
        </Text>
      </View>
    );
  }
  return (
    <View className="self-start flex-row items-center bg-niqo-danger/10 border border-niqo-danger/30 rounded-full px-2 h-6 mt-1">
      <AlertTriangle size={11} color="#E24B4A" />
      <Text className="ml-1 font-display text-2xs text-niqo-danger">
        Désaccord
      </Text>
    </View>
  );
}

// ── Groupement par vendeur/acheteur ─────────────────────────────────────────

interface ConversationGroup {
  other_user_id: string;
  other_user_prenom: string;
  other_user_avatar_url: string | null;
  conversations: ConversationListItem[];
  /** Total unread dans le groupe */
  total_unread: number;
  /** Timestamp du dernier message du groupe (pour le tri) */
  latest_message_at: string | null;
}

function groupByUser(items: ConversationListItem[]): ConversationGroup[] {
  const map = new Map<string, ConversationGroup>();

  for (const conv of items) {
    let group = map.get(conv.other_user_id);
    if (!group) {
      group = {
        other_user_id: conv.other_user_id,
        other_user_prenom: conv.other_user_prenom,
        other_user_avatar_url: conv.other_user_avatar_url,
        conversations: [],
        total_unread: 0,
        latest_message_at: null,
      };
      map.set(conv.other_user_id, group);
    }
    group.conversations.push(conv);
    group.total_unread += conv.unread_count;
    if (
      !group.latest_message_at ||
      (conv.last_message_at && conv.last_message_at > group.latest_message_at)
    ) {
      group.latest_message_at = conv.last_message_at;
    }
  }

  // Tri par dernier message le plus récent
  return [...map.values()].sort((a, b) => {
    if (!a.latest_message_at) return 1;
    if (!b.latest_message_at) return -1;
    return b.latest_message_at.localeCompare(a.latest_message_at);
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated, requireAuth } = useAuth();
  const unreadCount = useUnreadCount();

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Auth gate — redirige les anonymes vers home avec AuthGate
  useEffect(() => {
    if (!isAuthenticated) {
      requireAuth("messages");
      router.replace("/home");
    }
  }, [isAuthenticated, requireAuth]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) {
        setLoading(false);
        return;
      }
      let cancelled = false;
      void (async () => {
        try {
          const items = await fetchMyConversations();
          if (!cancelled) setConversations(items);
        } catch {
          // silent
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // ── Realtime : re-fetch la liste quand un nouveau message arrive ──────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const channel = subscribeToAllMessages(() => {
      // Debounce 1.5s — si plusieurs messages arrivent rapidement,
      // on ne re-fetch la liste qu'une fois.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void fetchMyConversations()
          .then(setConversations)
          .catch(() => {});
      }, 1500);
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      channel.unsubscribe();
    };
  }, [isAuthenticated]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const items = await fetchMyConversations();
      setConversations(items);
    } catch {
      // silent
    }
    setRefreshing(false);
  }, []);

  const onTabPress = useCallback(
    (tab: TabKey) => {
      if (tab === "messages") return;
      if (tab === "home") {
        router.replace("/home");
        return;
      }
      if (tab === "search") {
        router.push("/search");
        return;
      }
      if (!requireAuth(tab)) return;
      if (tab === "profile") {
        router.push("/profile");
        return;
      }
      if (tab === "sell") {
        router.push("/sell");
        return;
      }
    },
    [requireAuth]
  );

  if (loading) {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-niqo-white items-center justify-center"
      >
        <ActivityIndicator size="large" color="#D85A30" />
      </View>
    );
  }

  const groups = groupByUser(conversations);

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
      <StatusBar style="dark" />

      {/* Header */}
      <View className="bg-niqo-white border-b border-niqo-gray-150 px-4 h-14 flex-row items-center">
        <Text className="font-display text-h3 text-niqo-black">Messages</Text>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(item) => item.other_user_id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#D85A30"
          />
        }
        renderItem={({ item: group }) => (
          <View className="border-b border-niqo-gray-100">
            {/* En-tête du groupe : avatar + nom — Pressable vers profil public (M3) */}
            <View className="flex-row items-center px-4 pt-3 pb-1">
              <Pressable
                onPress={() =>
                  router.push(`/u/${group.other_user_id}` as never)
                }
                accessibilityRole="button"
                accessibilityLabel={`Voir le profil de ${group.other_user_prenom}`}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                className="flex-1 flex-row items-center active:opacity-60"
              >
                <TrustedAvatar
                  avatarUrl={group.other_user_avatar_url}
                  prenom={group.other_user_prenom}
                  nbVentes={group.conversations[0]?.other_user_nb_ventes ?? 0}
                  noteVendeur={group.conversations[0]?.other_user_note_vendeur ?? 0}
                  size={40}
                />
                <Text
                  className="ml-3 font-display text-label text-niqo-black flex-1"
                  numberOfLines={1}
                >
                  {group.other_user_prenom}
                </Text>
              </Pressable>
              {group.total_unread > 0 && (
                <View className="bg-niqo-coral min-w-[20px] h-5 rounded-full items-center justify-center px-1.5 ml-2">
                  <Text
                    className="font-mono text-2xs text-niqo-white"
                    allowFontScaling={false}
                  >
                    {group.total_unread > 99 ? "99+" : group.total_unread}
                  </Text>
                </View>
              )}
            </View>

            {/* Conversations du groupe (1 par annonce) */}
            {group.conversations.map((conv) => {
              const badge = deriveConvBadge(conv);
              const annonceDeleted = conv.annonce_deleted;
              return (
                <Pressable
                  key={conv.id}
                  onPress={() => router.push(`/messages/${conv.id}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${conv.annonce_titre} — ${conv.last_message_preview ?? "Pas de message"}`}
                  className="flex-row items-start pl-16 pr-4 py-2.5 active:opacity-80"
                  style={{ minHeight: 56 }}
                >
                  {/* Mini cover annonce — placeholder grisé si annonce supprimée (M4) */}
                  {annonceDeleted ? (
                    <View
                      style={{ width: 36, height: 36, borderRadius: 6 }}
                      className="bg-niqo-gray-100 items-center justify-center"
                    >
                      <ImageOff size={16} color="#888780" />
                    </View>
                  ) : conv.annonce_cover_url ? (
                    <Image
                      source={{ uri: conv.annonce_cover_url }}
                      style={{ width: 36, height: 36, borderRadius: 6 }}
                      contentFit="cover"
                      transition={100}
                    />
                  ) : (
                    <View
                      style={{ width: 36, height: 36, borderRadius: 6 }}
                      className="bg-niqo-gray-100"
                    />
                  )}

                  <View className="flex-1 ml-3">
                    <View className="flex-row items-center justify-between">
                      <Text
                        className={`font-body text-caption flex-1 ${
                          annonceDeleted
                            ? "text-niqo-gray-500 italic"
                            : conv.unread_count > 0
                              ? "text-niqo-black"
                              : "text-niqo-gray-800"
                        }`}
                        numberOfLines={1}
                      >
                        {conv.annonce_titre}
                      </Text>
                      <Text className="font-body text-2xs text-niqo-gray-500 ml-2">
                        {timeAgo(conv.last_message_at)}
                      </Text>
                    </View>
                    {conv.last_message_preview && (
                      <Text
                        className={`font-body text-micro mt-0.5 ${
                          conv.unread_count > 0 && !annonceDeleted
                            ? "text-niqo-black"
                            : "text-niqo-gray-500"
                        }`}
                        numberOfLines={1}
                      >
                        {conv.last_message_preview}
                      </Text>
                    )}
                    <ConvRdvBadge badge={badge} />
                  </View>

                  {conv.unread_count > 0 && (
                    <View className="ml-2 mt-2 w-2 h-2 rounded-full bg-niqo-coral" />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-20 px-6">
            <MessageCircle size={40} color="#888780" />
            <Text className="mt-4 font-display text-h3 text-niqo-gray-800 text-center">
              Pas encore de messages
            </Text>
            <Text className="font-body text-body text-niqo-gray-500 text-center mt-2">
              Explore les annonces et contacte un vendeur pour démarrer une conversation.
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

      <BottomNav
        active="messages"
        onTabPress={onTabPress}
        unreadCount={unreadCount}
      />
    </View>
  );
}
