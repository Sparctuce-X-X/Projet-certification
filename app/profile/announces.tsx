import { Image } from "expo-image";
import { Stack, router } from "expo-router";
import { ArrowLeft, Plus, RefreshCw, ShieldOff, Sparkles, Trash2, Zap } from "lucide-react-native";

import { formatBoostRemaining } from "@/lib/boost";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  deleteAnnonce,
  fetchMyAnnonces,
  prolongerAnnonce,
  type Annonce,
  type StatutAnnonce,
} from "@/lib/annonces";
import { annonceErrorToFr, prolongationErrorToFr } from "@/lib/annonces/errors";
import { getAnnoncePhotoUrl } from "@/lib/storage/annonces-photos";

// ── Helpers ─────────────────────────────────────────────────────────────────

const STATUT_CONFIG: Record<
  StatutAnnonce,
  { label: string; bg: string; text: string }
> = {
  active: {
    label: "Active",
    bg: "bg-niqo-status-complete-bg",
    text: "text-niqo-status-complete-text",
  },
  en_cours: {
    label: "RDV en cours",
    bg: "bg-niqo-status-escrow-bg",
    text: "text-niqo-status-escrow-text",
  },
  vendue: {
    label: "Vendue",
    bg: "bg-niqo-status-en-attente-bg",
    text: "text-niqo-status-en-attente-text",
  },
  suspendue: {
    label: "Suspendue",
    bg: "bg-niqo-status-en-litige-bg",
    text: "text-niqo-status-en-litige-text",
  },
  expiree: {
    label: "Expirée",
    bg: "bg-niqo-status-expire-bg",
    text: "text-niqo-status-expire-text",
  },
};

function formatPrice(value: number): string {
  return value.toLocaleString("fr-FR").replace(/\u00A0/g, " ") + " FCFA";
}

function canProlong(annonce: Annonce): boolean {
  if (annonce.statut !== "expiree") return false;
  const deadline = new Date(annonce.expires_at).getTime() + 28 * 86400 * 1000;
  return Date.now() < deadline;
}

// Tri composite : boostées actives → autres actives → en_cours → vendue → suspendue → expiree.
// Cohérent avec le tri Home (boost paie sa place) sans casser la logique "filtrer ses suspendues".
const STATUT_PRIO: Record<StatutAnnonce, number> = {
  active: 0,
  en_cours: 1,
  vendue: 2,
  suspendue: 3,
  expiree: 4,
};

function isActiveBoost(a: Annonce): boolean {
  return !!(a.is_boosted && a.boost_until && new Date(a.boost_until) > new Date());
}

// ── Component ───────────────────────────────────────────────────────────────

type FilterTab = "all" | "active" | "vendue" | "suspendue" | "expiree";

const FILTERS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "active", label: "Actives" },
  { id: "vendue", label: "Vendues" },
  { id: "suspendue", label: "Suspendues" },
  { id: "expiree", label: "Expirées" },
];

export default function MyAnnoncesScreen() {
  const insets = useSafeAreaInsets();
  const [annonces, setAnnonces] = useState<Annonce[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");

  const sortedAnnonces = useMemo(() => {
    return [...annonces].sort((a, b) => {
      const aBoost = isActiveBoost(a);
      const bBoost = isActiveBoost(b);
      if (aBoost !== bBoost) return aBoost ? -1 : 1;
      const prioDiff = STATUT_PRIO[a.statut] - STATUT_PRIO[b.statut];
      if (prioDiff !== 0) return prioDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [annonces]);

  const filteredAnnonces =
    filter === "all"
      ? sortedAnnonces
      : filter === "active"
        ? sortedAnnonces.filter((a) => a.statut === "active" || a.statut === "en_cours")
        : sortedAnnonces.filter((a) => a.statut === filter);

  const load = useCallback(async () => {
    try {
      const items = await fetchMyAnnonces();
      setAnnonces(items);
    } catch {
      // silent — user sees empty state
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

  const onDelete = useCallback(
    (annonce: Annonce) => {
      Alert.alert(
        "Supprimer l'annonce",
        `"${annonce.titre}" sera supprimée définitivement.`,
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Supprimer",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteAnnonce(annonce.id);
                setAnnonces((prev) => prev.filter((a) => a.id !== annonce.id));
              } catch (err) {
                Alert.alert("Erreur", annonceErrorToFr(err));
              }
            },
          },
        ]
      );
    },
    []
  );

  const onExplainSuspended = useCallback((annonce: Annonce) => {
    Alert.alert(
      "Annonce suspendue",
      `"${annonce.titre}" a été retirée par notre équipe de modération (signalements validés ou décision admin).\n\nElle n'apparaît plus dans la recherche. Tes conversations existantes restent accessibles.\n\nSi tu penses qu'il y a une erreur, écris-nous.`,
      [
        { text: "Fermer", style: "cancel" },
        {
          text: "Écrire au support",
          onPress: () => {
            const subject = encodeURIComponent(`Suspension annonce — ${annonce.titre}`);
            const body = encodeURIComponent(
              `Bonjour,\n\nMon annonce "${annonce.titre}" (id: ${annonce.id}) a été suspendue.\n\nJe pense qu'il y a une erreur car :\n[...]\n\nMerci.`
            );
            void Linking.openURL(`mailto:support@niqo.africa?subject=${subject}&body=${body}`);
          },
        },
      ]
    );
  }, []);

  const onProlong = useCallback(
    async (annonce: Annonce) => {
      try {
        const result = await prolongerAnnonce(annonce.id);
        if (result.success) {
          Alert.alert("Annonce réactivée", "Ton annonce est de nouveau visible pendant 60 jours.");
          await load();
        } else {
          Alert.alert("Impossible", prolongationErrorToFr(result.error ?? "unknown"));
        }
      } catch (err) {
        Alert.alert("Erreur", annonceErrorToFr(err));
      }
    },
    [load]
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

      {/* ── Header ───────────────────────────────────────────────────── */}
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
          Mes annonces
        </Text>
        <Pressable
          onPress={() => router.push("/sell")}
          accessibilityRole="button"
          accessibilityLabel="Nouvelle annonce"
          className="min-h-[44px] min-w-[44px] items-center justify-center -mr-2 active:opacity-60"
        >
          <Plus size={22} color="#D85A30" />
        </Pressable>
      </View>

      {/* ── Filter pills ─────────────────────────────────────────────── */}
      <View className="flex-row gap-2 px-4 pb-3 pt-1">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count =
            f.id === "all"
              ? annonces.length
              : f.id === "active"
                ? annonces.filter((a) => a.statut === "active" || a.statut === "en_cours").length
                : annonces.filter((a) => a.statut === f.id).length;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              accessibilityRole="button"
              accessibilityLabel={`Filtrer ${f.label}`}
              className={`min-h-[36px] px-3 rounded-full items-center justify-center border ${
                active
                  ? "bg-niqo-black border-niqo-black"
                  : "bg-niqo-white border-niqo-gray-200 active:opacity-60"
              }`}
            >
              <Text
                className={`font-body text-micro ${
                  active ? "text-niqo-white" : "text-niqo-gray-800"
                }`}
              >
                {f.label} · {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── List ─────────────────────────────────────────────────────── */}
      <FlatList
        data={filteredAnnonces}
        keyExtractor={(item) => item.id}
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
          const config = STATUT_CONFIG[item.statut];
          const coverUrl = getAnnoncePhotoUrl(item.photos[0] ?? "");

          return (
            <Pressable
              onPress={() => router.push(`/announce/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${item.titre}, ${formatPrice(item.prix)}`}
              className="flex-row bg-niqo-white border-b border-niqo-gray-100 py-3 active:opacity-80"
            >
              {/* Cover */}
              <View className="w-20 h-20 rounded-card overflow-hidden bg-niqo-gray-100">
                <Image
                  source={{ uri: coverUrl }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  placeholder={{ blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4" }}
                  transition={150}
                />
              </View>

              {/* Info */}
              <View className="flex-1 ml-3 justify-between">
                <View>
                  <Text
                    className="font-body text-body text-niqo-black"
                    numberOfLines={2}
                  >
                    {item.titre}
                  </Text>
                  <Text
                    className="mt-1 font-mono text-caption text-niqo-black"
                    allowFontScaling={false}
                  >
                    {formatPrice(item.prix)}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2 mt-1 flex-wrap">
                  {item.statut === "suspendue" ? (
                    <Pressable
                      onPress={() => onExplainSuspended(item)}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Pourquoi mon annonce est-elle suspendue ?"
                      className={`${config.bg} rounded-full px-2 py-0.5 flex-row items-center gap-1 active:opacity-60`}
                    >
                      <ShieldOff size={10} color="#E24B4A" />
                      <Text className={`font-body text-micro ${config.text}`}>
                        {config.label}
                      </Text>
                    </Pressable>
                  ) : (
                    <View className={`${config.bg} rounded-full px-2 py-0.5`}>
                      <Text className={`font-body text-micro ${config.text}`}>
                        {config.label}
                      </Text>
                    </View>
                  )}
                  {item.type_offre && (
                    <View
                      className={`rounded-full px-2 py-0.5 ${
                        item.type_offre === "location"
                          ? "bg-niqo-status-escrow-bg"
                          : "bg-niqo-status-complete-bg"
                      }`}
                    >
                      <Text
                        className={`font-body text-micro ${
                          item.type_offre === "location"
                            ? "text-niqo-status-escrow-text"
                            : "text-niqo-status-complete-text"
                        }`}
                      >
                        {item.type_offre === "location" ? "Location" : "Vente"}
                      </Text>
                    </View>
                  )}
                  <Text className="font-body text-micro text-niqo-gray-500">
                    {item.ville}
                  </Text>
                </View>
                {item.is_boosted &&
                  item.boost_until &&
                  new Date(item.boost_until) > new Date() && (
                    <View className="flex-row items-center gap-1 mt-1">
                      <Sparkles size={11} color="#D85A30" strokeWidth={2.4} />
                      <Text className="font-body text-micro text-niqo-coral font-medium">
                        Boostée · {formatBoostRemaining(item.boost_until)}
                      </Text>
                    </View>
                  )}
              </View>

              {/* Actions */}
              <View className="justify-center gap-2 ml-2">
                {item.statut === "active" && (
                  <Pressable
                    onPress={() => router.push(`/profile/boost/${item.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel="Booster l'annonce"
                    hitSlop={4}
                    className="w-9 h-9 rounded-full bg-niqo-coral-light items-center justify-center active:opacity-60"
                  >
                    {item.is_boosted &&
                    item.boost_until &&
                    new Date(item.boost_until) > new Date() ? (
                      <Sparkles size={16} color="#D85A30" />
                    ) : (
                      <Zap size={16} color="#D85A30" />
                    )}
                  </Pressable>
                )}
                {canProlong(item) && (
                  <Pressable
                    onPress={() => void onProlong(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Prolonger l'annonce"
                    hitSlop={4}
                    className="w-9 h-9 rounded-full bg-niqo-status-complete-bg items-center justify-center active:opacity-60"
                  >
                    <RefreshCw size={16} color="#1D9E75" />
                  </Pressable>
                )}
                {["active", "expiree", "suspendue"].includes(item.statut) && (
                  <Pressable
                    onPress={() => onDelete(item)}
                    accessibilityRole="button"
                    accessibilityLabel="Supprimer l'annonce"
                    hitSlop={4}
                    className="w-9 h-9 rounded-full bg-niqo-status-en-litige-bg items-center justify-center active:opacity-60"
                  >
                    <Trash2 size={16} color="#E24B4A" />
                  </Pressable>
                )}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View className="items-center justify-center py-20 px-4">
            <Text className="font-display text-h3 text-niqo-gray-800 text-center">
              Tu n&apos;as pas encore d&apos;annonce
            </Text>
            <Text className="font-body text-body text-niqo-gray-500 text-center mt-2">
              Publie ton premier article en quelques minutes !
            </Text>
            <Pressable
              onPress={() => router.push("/sell")}
              className="mt-6 bg-niqo-coral rounded-btn px-8 min-h-[48px] items-center justify-center active:opacity-80"
            >
              <Text className="font-body text-label text-niqo-white">
                Vendre un article
              </Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}
