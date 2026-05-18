import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  MapPin,
  Sparkles,
  TrendingUp,
} from "lucide-react-native";

import { AnnouncementCard } from "@/components/ui/AnnouncementCard";
import { BottomNav, type TabKey } from "@/components/ui/BottomNav";
import { CategoryPill } from "@/components/ui/CategoryPill";
import { EmailVerificationBanner } from "@/components/ui/EmailVerificationBanner";
import { HomeActionsBanner } from "@/components/home/HomeActionsBanner";
import { HomeHeader, type HomeMode } from "@/components/ui/HomeHeader";
import { AnnoncesFiltersModal } from "@/components/ui/AnnoncesFiltersModal";
import { ImmoFilters } from "@/components/ui/ImmoFilters";
import { SearchBar } from "@/components/ui/SearchBar";
import {
  fetchAnnonces,
  type AnnonceListItem,
  type EtatObjet,
  type Pays,
  type SortOrder,
  type TypeBien,
  type TypeOffreImmo,
} from "@/lib/annonces";
import {
  fetchCategories,
  getCategoryIcon,
  type Category,
} from "@/lib/categories";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useBlockedUsers } from "@/lib/hooks/useBlockedUsers";
import { useUnreadCount } from "@/lib/hooks/useUnreadCount";
import {
  loadMyFavoriteIds,
  toggleFavorite,
} from "@/lib/favorites";
import { CITIES_BY_COUNTRY } from "@/lib/locations";
import { supabase } from "@/lib/supabase";
import { getAnnoncePhotoUrl } from "@/lib/storage/annonces-photos";

const PAGE_SIZE = 20;
const SCREEN_WIDTH = Dimensions.get("window").width;
const RECENT_VIEWS_KEY = "niqo_viewed_annonces";

// ── Skeleton Card ───────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <View className="flex-1">
      <View className="aspect-square rounded-card bg-niqo-gray-100 mb-2" />
      <View className="h-4 bg-niqo-gray-100 rounded-full w-3/4 mb-1.5" />
      <View className="h-5 bg-niqo-gray-100 rounded-full w-1/2 mb-1" />
      <View className="h-3 bg-niqo-gray-100 rounded-full w-2/3" />
    </View>
  );
}

function SkeletonRow() {
  return (
    <View className="flex-row gap-3 px-4">
      <SkeletonCard />
      <SkeletonCard />
    </View>
  );
}

// ── Section Header ──────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  iconColor = "#D85A30",
  onSeeAll,
}: {
  icon: typeof TrendingUp;
  title: string;
  iconColor?: string;
  onSeeAll?: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between px-4 mb-3 mt-6">
      <View className="flex-row items-center gap-2">
        <Icon size={18} color={iconColor} />
        <Text className="font-display text-h3 text-niqo-black">{title}</Text>
      </View>
      {onSeeAll && (
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          className="flex-row items-center active:opacity-60"
        >
          <Text className="font-body text-micro text-niqo-coral">Voir tout</Text>
          <ChevronRight size={14} color="#D85A30" />
        </Pressable>
      )}
    </View>
  );
}

// ── Horizontal Carousel ─────────────────────────────────────────────────────

function HorizontalCarousel({
  data,
  onPress,
  onFavorite,
  favIds,
}: {
  data: AnnonceListItem[];
  onPress: (id: string) => void;
  onFavorite: (id: string) => void;
  favIds: Set<string>;
}) {
  if (data.length === 0) return null;
  const cardWidth = (SCREEN_WIDTH - 48) / 2.3;

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      renderItem={({ item }) => (
        <View style={{ width: cardWidth }}>
          <AnnouncementCard
            item={item}
            onPress={onPress}
            onFavorite={onFavorite}
            isFavorited={favIds.has(item.id)}
          />
        </View>
      )}
    />
  );
}

// ── Recently Viewed (from AsyncStorage) ─────────────────────────────────────

function RecentlyViewedSection({
  country,
  onPress,
  onFavorite,
  favIds,
}: {
  country: Pays;
  onPress: (id: string) => void;
  onFavorite: (id: string) => void;
  favIds: Set<string>;
}) {
  const [items, setItems] = useState<AnnonceListItem[]>([]);

  useEffect(() => {
    // Reset immédiat pour ne pas afficher d'anciennes données
    setItems([]);

    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(RECENT_VIEWS_KEY);
        if (!raw) return;
        const viewed: string[] = JSON.parse(raw);
        // Extraire les annonce IDs (format "annonceId:date")
        const ids = [...new Set(viewed.map((v) => v.split(":")[0]))].slice(0, 10);
        if (ids.length === 0) return;

        // Fetch en une seule requête — filtre pays + statut
        const { data } = await supabase
          .from("annonces")
          .select("id, titre, prix, photos, ville, statut, created_at, type_offre, pays")
          .in("id", ids)
          .eq("statut", "active")
          .eq("pays", country);

        if (!data || data.length === 0) return;

        // Garder l'ordre de consultation (ids est trié par récence)
        const byId = new Map(data.map((d) => [d.id, d]));
        const ordered = ids
          .filter((id) => byId.has(id))
          .map((id) => {
            const d = byId.get(id)!;
            return {
              id: d.id,
              titre: d.titre,
              prix: typeof d.prix === "string" ? Number(d.prix) : d.prix,
              cover_url: getAnnoncePhotoUrl((d.photos as string[])[0] ?? ""),
              ville: d.ville,
              statut: d.statut,
              created_at: d.created_at,
              type_offre: d.type_offre ?? null,
            } as AnnonceListItem;
          });
        setItems(ordered);
      } catch {
        // silent
      }
    })();
  }, [country]);

  if (items.length === 0) return null;

  return (
    <>
      <SectionHeader icon={Eye} title="Récemment consultées" iconColor="#888780" />
      <HorizontalCarousel
        data={items}
        onPress={onPress}
        onFavorite={onFavorite}
        favIds={favIds}
      />
    </>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { requireAuth, profile } = useAuth();
  const { blockedIds } = useBlockedUsers();
  const unreadCount = useUnreadCount();

  const [country, setCountry] = useState<Pays | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [annonces, setAnnonces] = useState<AnnonceListItem[]>([]);
  const [nearbyAnnonces, setNearbyAnnonces] = useState<AnnonceListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Pré-sélection de catégorie depuis search.tsx (router.replace avec param).
  // Lu 1 seul fois au mount — si l'user navigue ailleurs et revient, on
  // garde le state local (pas de re-trigger).
  const params = useLocalSearchParams<{ categoryId?: string }>();
  useEffect(() => {
    if (params.categoryId && typeof params.categoryId === "string") {
      setActiveCategory(params.categoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeVille, setActiveVille] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const hasMoreRef = useRef(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // ── Mode Annonces / Immo ──
  const [homeMode, setHomeMode] = useState<HomeMode>("annonces");
  const [immoTypeOffre, setImmoTypeOffre] = useState<TypeOffreImmo | null>(null);
  const [immoTypeBien, setImmoTypeBien] = useState<TypeBien | null>(null);
  const [immoNbPieces, setImmoNbPieces] = useState<number | null>(null);
  const [immoMeuble, setImmoMeuble] = useState<boolean | null>(null);
  const [immoPrixMin, setImmoPrixMin] = useState("");
  const [immoPrixMax, setImmoPrixMax] = useState("");
  const [immoSurfaceMin, setImmoSurfaceMin] = useState("");
  const [immoSurfaceMax, setImmoSurfaceMax] = useState("");
  // ── Filtres avancés Annonces ──
  const [annoncePrixMin, setAnnoncePrixMin] = useState("");
  const [annoncePrixMax, setAnnoncePrixMax] = useState("");
  const [annonceEtat, setAnnonceEtat] = useState<EtatObjet | null>(null);

  // ── Load country on focus ─────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      AsyncStorage.getItem("niqo_country")
        .then((stored) => {
          if (cancelled) return;
          if (stored === "CI" || stored === "CG") setCountry(stored);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // ── Fetch categories once ─────────────────────────────────────────────
  useEffect(() => {
    void fetchCategories().then(setCategories).catch(() => {});
  }, []);

  // ── Load favorite IDs on focus ──────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(
    useCallback(() => {
      void loadMyFavoriteIds().then((ids) => setFavIds(new Set(ids)));
      setRefreshKey((k) => k + 1);
    }, [])
  );

  // ── Fetch "Près de chez toi" ──────────────────────────────────────────
  // Stabilise la dep tableau→string : sinon useEffect re-fire à chaque render
  // car blockedIds est un nouveau Set chaque fois que useBlockedUsers refresh.
  const blockedKey = Array.from(blockedIds).sort().join(",");
  useEffect(() => {
    if (!country || !profile?.ville) return;
    void (async () => {
      try {
        const items = await fetchAnnonces({
          pays: country,
          ville: profile.ville,
          limit: 10,
          excludeVendeurIds: blockedKey ? blockedKey.split(",") : undefined,
        });
        setNearbyAnnonces(items);
      } catch {
        // silent
      }
    })();
  }, [country, profile?.ville, blockedKey]);

  // ── Fetch main annonces ───────────────────────────────────────────────
  const loadAnnonces = useCallback(
    async (opts?: { cursor?: string; append?: boolean }) => {
      if (!country) return;
      try {
        const items = await fetchAnnonces({
          pays: country,
          categorieId: homeMode === "annonces" ? (activeCategory ?? undefined) : undefined,
          ville: activeVille ?? undefined,
          sort: sortOrder,
          cursor: opts?.cursor,
          limit: PAGE_SIZE,
          immoOnly: homeMode === "immo" || undefined,
          excludeImmo: homeMode === "annonces" || undefined,
          typeOffre: homeMode === "immo" ? (immoTypeOffre ?? undefined) : undefined,
          typeBien: homeMode === "immo" ? (immoTypeBien ?? undefined) : undefined,
          nbPieces: homeMode === "immo" && immoNbPieces ? immoNbPieces : undefined,
          meuble: homeMode === "immo" && immoMeuble !== null ? immoMeuble : undefined,
          prixMin: (homeMode === "immo" ? immoPrixMin : annoncePrixMin)
            ? parseInt((homeMode === "immo" ? immoPrixMin : annoncePrixMin).replace(/\s/g, ""), 10)
            : undefined,
          prixMax: (homeMode === "immo" ? immoPrixMax : annoncePrixMax)
            ? parseInt((homeMode === "immo" ? immoPrixMax : annoncePrixMax).replace(/\s/g, ""), 10)
            : undefined,
          etat: homeMode === "annonces" && annonceEtat ? annonceEtat : undefined,
          surfaceMin: immoSurfaceMin ? parseInt(immoSurfaceMin, 10) : undefined,
          surfaceMax: immoSurfaceMax ? parseInt(immoSurfaceMax, 10) : undefined,
          excludeVendeurIds: blockedKey ? blockedKey.split(",") : undefined,
        });
        hasMoreRef.current = items.length === PAGE_SIZE;
        if (opts?.append) {
          setAnnonces((prev) => [...prev, ...items]);
        } else {
          setAnnonces(items);
        }
        setError(null);
      } catch {
        if (!opts?.append) {
          setError("Impossible de charger les annonces. Vérifie ta connexion.");
        }
      }
    },
    [country, activeCategory, activeVille, sortOrder, homeMode, immoTypeOffre, immoTypeBien, immoNbPieces, immoMeuble, immoPrixMin, immoPrixMax, immoSurfaceMin, immoSurfaceMax, annoncePrixMin, annoncePrixMax, annonceEtat, blockedKey]
  );

  useEffect(() => {
    if (!country) return;
    setLoading(true);
    void loadAnnonces().finally(() => setLoading(false));
  }, [country, activeCategory, activeVille, sortOrder, homeMode, immoTypeOffre, immoTypeBien, immoNbPieces, immoMeuble, immoPrixMin, immoPrixMax, immoSurfaceMin, immoSurfaceMax, annoncePrixMin, annoncePrixMax, annonceEtat, loadAnnonces]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    hasMoreRef.current = true;
    await loadAnnonces();
    setRefreshKey((k) => k + 1);
    setRefreshing(false);
  }, [loadAnnonces]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || !hasMoreRef.current || annonces.length === 0) return;
    setLoadingMore(true);
    const cursor = annonces[annonces.length - 1].created_at;
    await loadAnnonces({ cursor, append: true });
    setLoadingMore(false);
  }, [loadingMore, annonces, loadAnnonces]);

  // ── Navigation ────────────────────────────────────────────────────────
  const onAnnouncementPress = useCallback((id: string) => {
    router.push(`/announce/${id}`);
  }, []);

  const onFavoritePress = useCallback(
    (id: string) => {
      if (!requireAuth("favorite")) return;
      void (async () => {
        try {
          const newState = await toggleFavorite(id);
          setFavIds(new Set(favIds).add(id));
          if (!newState) {
            setFavIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        } catch {
          // silent
        }
      })();
    },
    [requireAuth, favIds]
  );

  const onCategoryPress = useCallback((catId: string) => {
    setActiveCategory((current) => (current === catId ? null : catId));
  }, []);

  const onVillePress = useCallback(() => {
    if (!country) return;
    const cities = CITIES_BY_COUNTRY[country];
    Alert.alert("Filtrer par ville", undefined, [
      { text: "Toutes les villes", onPress: () => setActiveVille(null) },
      ...cities.map((city) => ({
        text: city,
        onPress: () => setActiveVille(city),
      })),
      { text: "Annuler", style: "cancel" as const },
    ]);
  }, [country]);

  const SORT_OPTIONS: { key: SortOrder; label: string }[] = [
    { key: "recent", label: "Plus récentes" },
    { key: "price_asc", label: "Prix croissant" },
    { key: "price_desc", label: "Prix décroissant" },
  ];

  const onSortPress = useCallback(() => {
    Alert.alert("Trier par", undefined, [
      ...SORT_OPTIONS.map((opt) => ({
        text: opt.label,
        onPress: () => setSortOrder(opt.key),
      })),
      { text: "Annuler", style: "cancel" as const },
    ]);
  }, []);

  const onSearchPress = useCallback(() => router.push("/search"), []);
  const onFavoritesPress = useCallback(() => {
    if (!requireAuth("favorite")) return;
    router.push("/profile/favorites" as never);
  }, [requireAuth]);

  const onTabPress = useCallback(
    (tab: TabKey) => {
      if (tab === "home") { setActiveTab("home"); return; }
      if (tab === "search") { router.push("/search"); return; }
      if (!requireAuth(tab)) return;
      if (tab === "profile") { router.push("/profile"); return; }
      if (tab === "sell") { router.push("/sell"); return; }
      if (tab === "messages") { router.push("/messages"); return; }
    },
    [requireAuth]
  );

  // ── Loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
        <HomeHeader
        onFavoritesPress={onFavoritesPress}
        mode={homeMode}
        onModeChange={(m) => {
          setHomeMode(m);
          setActiveCategory(null);
          setActiveVille(null);
          setSortOrder("recent");
          setImmoTypeOffre(null);
          setImmoTypeBien(null);
          setImmoNbPieces(null);
          setImmoMeuble(null);
          setImmoPrixMin("");
          setImmoPrixMax("");
          setImmoSurfaceMin("");
          setImmoSurfaceMax("");
          setAnnoncePrixMin("");
          setAnnoncePrixMax("");
          setAnnonceEtat(null);
        }}
      />
        <View className="px-4 mt-4 mb-6">
          <SearchBar onPress={onSearchPress} />
        </View>
        <SkeletonRow />
        <View className="mt-4">
          <SkeletonRow />
        </View>
      </View>
    );
  }

  if (!country) {
    router.replace("/country-picker");
    return null;
  }

  // Séparer les annonces : nouvelles (< 24h) vs toutes
  const now = Date.now();
  const newAnnonces = annonces.filter(
    (a) => now - new Date(a.created_at).getTime() < 24 * 60 * 60 * 1000
  );
  const hasFilters = activeCategory || activeVille || annoncePrixMin || annoncePrixMax || annonceEtat;

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
      <StatusBar style="dark" />
      <HomeHeader
        onFavoritesPress={onFavoritesPress}
        mode={homeMode}
        onModeChange={(m) => {
          setHomeMode(m);
          setActiveCategory(null);
          setActiveVille(null);
          setSortOrder("recent");
          setImmoTypeOffre(null);
          setImmoTypeBien(null);
          setImmoNbPieces(null);
          setImmoMeuble(null);
          setImmoPrixMin("");
          setImmoPrixMax("");
          setImmoSurfaceMin("");
          setImmoSurfaceMax("");
          setAnnoncePrixMin("");
          setAnnoncePrixMax("");
          setAnnonceEtat(null);
        }}
      />
      <EmailVerificationBanner />

      <FlatList
        data={annonces}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 32,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D85A30" />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        extraData={`${country}-${refreshKey}-${homeMode}`}
        ListHeaderComponent={
          <View className="mb-2">
            {/* Bannière actions pendantes (auth uniquement) — D, mig 93 */}
            <HomeActionsBanner />

            {/* Search bar */}
            <View className="mb-3">
              <SearchBar onPress={onSearchPress} />
            </View>

            {/* Catégories pills (mode annonces) OU filtres immo */}
            {homeMode === "annonces" ? (
              categories.length > 0 && (
                <FlatList
                  // Exclut la catégorie Immobilier (icone "building-2", stable mig 32)
                  // car elle a son propre onglet dédié. Sans ce filter, cliquer la pill
                  // envoyait categorieId=<immo> + excludeImmo=true → toujours 0 résultat.
                  data={categories.filter((c) => c.icone !== "building-2")}
                  keyExtractor={(item) => item.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, marginBottom: 12 }}
                  renderItem={({ item }) => (
                    <CategoryPill
                      label={item.nom}
                      Icon={getCategoryIcon(item.icone)}
                      active={activeCategory === item.id}
                      onPress={() => onCategoryPress(item.id)}
                    />
                  )}
                />
              )
            ) : (
              <View className="mb-2">
                <ImmoFilters
                  typeOffre={immoTypeOffre}
                  typeBien={immoTypeBien}
                  nbPieces={immoNbPieces}
                  meuble={immoMeuble}
                  prixMin={immoPrixMin}
                  prixMax={immoPrixMax}
                  onTypeOffreChange={setImmoTypeOffre}
                  onTypeBienChange={setImmoTypeBien}
                  onNbPiecesChange={setImmoNbPieces}
                  onMeubleChange={setImmoMeuble}
                  onPrixMinChange={setImmoPrixMin}
                  onPrixMaxChange={setImmoPrixMax}
                  surfaceMin={immoSurfaceMin}
                  surfaceMax={immoSurfaceMax}
                  onSurfaceMinChange={setImmoSurfaceMin}
                  onSurfaceMaxChange={setImmoSurfaceMax}
                />
              </View>
            )}

            {/* Filtres ville + tri + filtres avancés annonces */}
            <View className="flex-row gap-2 mb-2">
              <Pressable
                onPress={onVillePress}
                accessibilityRole="button"
                className={`flex-row items-center rounded-full px-3 min-h-[36px] ${
                  activeVille
                    ? "bg-niqo-coral-light border border-niqo-coral"
                    : "bg-niqo-gray-50 border border-transparent"
                }`}
              >
                <MapPin size={14} color={activeVille ? "#D85A30" : "#888780"} />
                <Text className={`ml-1.5 font-body text-micro ${activeVille ? "text-niqo-coral" : "text-niqo-gray-800"}`} numberOfLines={1}>
                  {activeVille ?? "Ville"}
                </Text>
                <ChevronDown size={14} color={activeVille ? "#D85A30" : "#888780"} />
              </Pressable>
              <Pressable
                onPress={onSortPress}
                accessibilityRole="button"
                className={`flex-row items-center rounded-full px-3 min-h-[36px] ${
                  sortOrder !== "recent"
                    ? "bg-niqo-coral-light border border-niqo-coral"
                    : "bg-niqo-gray-50 border border-transparent"
                }`}
              >
                {sortOrder === "price_asc" ? (
                  <ArrowUpNarrowWide size={14} color="#D85A30" />
                ) : sortOrder === "price_desc" ? (
                  <ArrowDownNarrowWide size={14} color="#D85A30" />
                ) : (
                  <Clock size={14} color="#888780" />
                )}
                <Text className={`ml-1.5 font-body text-micro ${sortOrder !== "recent" ? "text-niqo-coral" : "text-niqo-gray-800"}`}>
                  {SORT_OPTIONS.find((o) => o.key === sortOrder)?.label}
                </Text>
              </Pressable>
              {homeMode === "annonces" && (
                <AnnoncesFiltersModal
                  prixMin={annoncePrixMin}
                  prixMax={annoncePrixMax}
                  etat={annonceEtat}
                  onPrixMinChange={setAnnoncePrixMin}
                  onPrixMaxChange={setAnnoncePrixMax}
                  onEtatChange={setAnnonceEtat}
                />
              )}
            </View>

            {/* ── Sections engagement (seulement en mode annonces sans filtres) ── */}
            {!hasFilters && homeMode === "annonces" && (
              <View className="-mx-4">
                {/* Section "Récemment consultées" */}
                <RecentlyViewedSection
                  key={`recent-${country}-${refreshKey}`}
                  country={country}
                  onPress={onAnnouncementPress}
                  onFavorite={onFavoritePress}
                  favIds={favIds}
                />

                {/* Section "Près de chez toi" */}
                {nearbyAnnonces.length > 0 && profile?.ville && (
                  <>
                    <SectionHeader
                      icon={MapPin}
                      title={`À ${profile.ville}`}
                      onSeeAll={() => setActiveVille(profile.ville)}
                    />
                    <HorizontalCarousel
                      data={nearbyAnnonces}
                      onPress={onAnnouncementPress}
                      onFavorite={onFavoritePress}
                      favIds={favIds}
                    />
                  </>
                )}

                {/* Section "Nouveautés" (si des annonces < 24h existent) */}
                {newAnnonces.length > 0 && (
                  <>
                    <SectionHeader icon={Sparkles} title="Nouveautés" />
                    <HorizontalCarousel
                      data={newAnnonces.slice(0, 10)}
                      onPress={onAnnouncementPress}
                      onFavorite={onFavoritePress}
                      favIds={favIds}
                    />
                  </>
                )}
              </View>
            )}

            {/* Titre section principale */}
            <View className="flex-row items-center justify-between mt-4 mb-1">
              <View className="flex-row items-center gap-2">
                <TrendingUp size={18} color="#D85A30" />
                <Text className="font-display text-h3 text-niqo-black">
                  {hasFilters ? "Résultats" : "Toutes les annonces"}
                </Text>
              </View>
              {annonces.length > 0 && (
                <Text className="font-body text-micro text-niqo-gray-500">
                  {annonces.length} annonce{annonces.length > 1 ? "s" : ""}
                  {activeVille ? ` à ${activeVille}` : ""}
                </Text>
              )}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <AnnouncementCard
            item={item}
            onPress={onAnnouncementPress}
            onFavorite={onFavoritePress}
            isFavorited={favIds.has(item.id)}
          />
        )}
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center">
              <ActivityIndicator size="small" color="#D85A30" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-16 px-4">
            {error ? (
              <>
                <Text className="font-display text-h3 text-niqo-gray-800 text-center">Oups !</Text>
                <Text className="font-body text-body text-niqo-gray-500 text-center mt-2">{error}</Text>
                <Pressable onPress={onRefresh} className="mt-4 bg-niqo-coral rounded-btn px-6 min-h-[44px] items-center justify-center active:opacity-80">
                  <Text className="font-body text-label text-niqo-white">Réessayer</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text className="font-display text-h3 text-niqo-gray-800 text-center">
                  {activeCategory ? "Aucune annonce dans cette catégorie" : "Aucune annonce pour l'instant"}
                </Text>
                <Text className="font-body text-body text-niqo-gray-500 text-center mt-2">
                  {activeCategory ? "Sois le premier à vendre !" : "Reviens plus tard ou tire pour rafraîchir."}
                </Text>
              </>
            )}
          </View>
        }
      />

      <BottomNav active={activeTab} onTabPress={onTabPress} unreadCount={unreadCount} />
    </View>
  );
}
