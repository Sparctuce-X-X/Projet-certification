import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Clock, X } from "lucide-react-native";

import { AnnouncementCard } from "@/components/ui/AnnouncementCard";
import { BottomNav, type TabKey } from "@/components/ui/BottomNav";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useBlockedUsers } from "@/lib/hooks/useBlockedUsers";
import { fetchAnnonces, type AnnonceListItem, type Pays } from "@/lib/annonces";
import {
  fetchCategories,
  getCategoryIcon,
  type Category,
} from "@/lib/categories";
import { fetchFavorites, toggleFavorite } from "@/lib/favorites";

const RECENT_STORAGE_KEY = "niqo_recent_searches";
const MAX_RECENT = 8;

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { requireAuth, isAuthenticated } = useAuth();
  const { blockedIds } = useBlockedUsers();
  const blockedKey = Array.from(blockedIds).sort().join(",");
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [country, setCountry] = useState<Pays>("CI");
  const [categories, setCategories] = useState<Category[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  // Search results state
  const [results, setResults] = useState<AnnonceListItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Source unique de vérité — on est en mode résultats dès qu'il y a une query.
  const showResults = query.trim().length > 0;

  // ── Init: country + recent + categories ───────────────────────────────
  useEffect(() => {
    void (async () => {
      const [stored, recentRaw] = await Promise.all([
        AsyncStorage.getItem("niqo_country").catch(() => null),
        AsyncStorage.getItem(RECENT_STORAGE_KEY).catch(() => null),
      ]);
      if (stored === "CI" || stored === "CG") setCountry(stored);
      if (recentRaw) {
        try {
          const parsed = JSON.parse(recentRaw) as string[];
          if (Array.isArray(parsed)) setRecent(parsed.slice(0, MAX_RECENT));
        } catch { /* ignore corrupt data */ }
      }
      try {
        const cats = await fetchCategories();
        setCategories(cats);
      } catch { /* pills hidden */ }
    })();
  }, []);

  // ── Persist recent searches ───────────────────────────────────────────
  const addRecent = useCallback((value: string) => {
    setRecent((prev) => {
      const next = [value, ...prev.filter((q) => q !== value)].slice(
        0,
        MAX_RECENT
      );
      void AsyncStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Charger les favoris (uniquement si authentifié) ──────────────────
  useEffect(() => {
    if (!isAuthenticated) {
      setFavIds(new Set());
      return;
    }
    void (async () => {
      try {
        const ids = await fetchFavorites();
        setFavIds(new Set(ids));
      } catch {
        // silent — un fetch favoris foiré n'empêche pas la recherche
      }
    })();
  }, [isAuthenticated]);

  // ── Search (debounced) ────────────────────────────────────────────────
  const doSearch = useCallback(
    async (searchQuery: string) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const items = await fetchAnnonces({
          pays: country,
          search: trimmed,
          limit: 40,
          excludeVendeurIds: blockedKey ? blockedKey.split(",") : undefined,
        });
        setResults(items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [country, blockedKey]
  );

  const onChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length === 0) {
        setResults([]);
        return;
      }
      debounceRef.current = setTimeout(() => {
        void doSearch(text);
      }, 300);
    },
    [doSearch]
  );

  const onSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    addRecent(trimmed);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void doSearch(trimmed);
  }, [query, addRecent, doSearch]);

  // ── Suggestion / category pick ────────────────────────────────────────
  const onPickSuggestion = useCallback(
    (value: string) => {
      setQuery(value);
      addRecent(value);
      inputRef.current?.blur();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void doSearch(value);
    },
    [addRecent, doSearch]
  );

  const onCategoryPress = useCallback((catId: string) => {
    // Navigue vers Home avec la catégorie pré-sélectionnée (lue par
    // home.tsx via useLocalSearchParams au mount).
    router.replace({ pathname: "/home", params: { categoryId: catId } });
  }, []);

  // ── UI actions ────────────────────────────────────────────────────────
  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, []);

  const onClearInput = useCallback(() => {
    setQuery("");
    setResults([]);
    inputRef.current?.focus();
  }, []);

  const onClearRecent = useCallback(() => {
    setRecent([]);
    void AsyncStorage.removeItem(RECENT_STORAGE_KEY);
  }, []);

  const onRemoveRecent = useCallback((value: string) => {
    setRecent((prev) => {
      const next = prev.filter((q) => q !== value);
      void AsyncStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const onAnnouncementPress = useCallback((id: string) => {
    router.push(`/announce/${id}`);
  }, []);

  const onFavoritePress = useCallback(
    (id: string) => {
      if (!requireAuth("favorite")) return;
      // Optimistic UI : toggle local d'abord, puis sync DB.
      setFavIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      void (async () => {
        try {
          const newState = await toggleFavorite(id);
          // Rollback si l'état serveur diffère de notre optimistic
          setFavIds((prev) => {
            const next = new Set(prev);
            if (newState) next.add(id);
            else next.delete(id);
            return next;
          });
        } catch {
          // silent — l'user verra le state correct au prochain refresh
        }
      })();
    },
    [requireAuth]
  );

  const onTabPress = useCallback(
    (tab: TabKey) => {
      if (tab === "search") return;
      if (tab === "home") {
        router.replace("/home");
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

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
      <StatusBar style="dark" />

      {/* ── Search bar header ──────────────────────────────────────────── */}
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-niqo-gray-150">
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={8}
          className="w-11 h-11 items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={24} color="#1A1A1A" />
        </Pressable>

        <View className="flex-1 flex-row items-center bg-niqo-gray-50 rounded-card px-4 h-12">
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={onChangeText}
            onSubmitEditing={onSubmit}
            placeholder="Rechercher un article…"
            placeholderTextColor="#888780"
            autoFocus
            returnKeyType="search"
            clearButtonMode="never"
            className="flex-1 font-body text-body text-niqo-black"
            accessibilityLabel="Champ de recherche"
          />
          {query.length > 0 && (
            <Pressable
              onPress={onClearInput}
              accessibilityRole="button"
              accessibilityLabel="Effacer la recherche"
              hitSlop={8}
              className="w-7 h-7 rounded-full bg-niqo-gray-200 items-center justify-center ml-2 active:opacity-60"
            >
              <X size={14} color="#444441" />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Results or idle content ────────────────────────────────────── */}
      {showResults ? (
        /* Results mode */
        <>
          {searching && results.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#D85A30" />
            </View>
          ) : (
            <FlatList
              data={results}
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
              renderItem={({ item }) => (
                <AnnouncementCard
                  item={item}
                  onPress={onAnnouncementPress}
                  onFavorite={onFavoritePress}
                  isFavorited={favIds.has(item.id)}
                />
              )}
              ListHeaderComponent={
                searching ? (
                  <View className="py-2 items-center">
                    <ActivityIndicator size="small" color="#D85A30" />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                !searching ? (
                  <View className="items-center justify-center py-16 px-4">
                    <Text className="font-display text-h3 text-niqo-gray-800 text-center">
                      Aucun résultat
                    </Text>
                    <Text className="font-body text-body text-niqo-gray-500 text-center mt-2">
                      Essaie un autre mot-clé ou vérifie l'orthographe.
                    </Text>
                  </View>
                ) : null
              }
            />
          )}
        </>
      ) : (
        /* Idle mode: recent + trending + categories */
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Recent searches */}
          {recent.length > 0 && (
            <View className="px-4 pt-6">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="font-display text-h3 text-niqo-black">
                  Recherches récentes
                </Text>
                <Pressable
                  onPress={onClearRecent}
                  accessibilityRole="button"
                  accessibilityLabel="Effacer toutes les recherches récentes"
                  hitSlop={8}
                  className="active:opacity-60"
                >
                  <Text className="font-body text-caption text-niqo-coral">
                    Tout effacer
                  </Text>
                </Pressable>
              </View>

              <View>
                {recent.map((value) => (
                  <View
                    key={value}
                    className="flex-row items-center justify-between min-h-[44px]"
                  >
                    <Pressable
                      onPress={() => onPickSuggestion(value)}
                      accessibilityRole="button"
                      accessibilityLabel={`Rechercher ${value}`}
                      className="flex-1 flex-row items-center gap-3 active:opacity-60"
                    >
                      <Clock size={18} color="#888780" />
                      <Text className="font-body text-body text-niqo-black">
                        {value}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onRemoveRecent(value)}
                      accessibilityRole="button"
                      accessibilityLabel={`Supprimer ${value}`}
                      hitSlop={8}
                      className="w-9 h-9 items-center justify-center active:opacity-60"
                    >
                      <X size={16} color="#888780" />
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Categories grid */}
          {categories.length > 0 && (
            <View className="px-4 pt-8">
              <Text className="font-display text-h3 text-niqo-black mb-3">
                Parcourir par catégorie
              </Text>

              <FlatList
                // Exclut Immobilier (icone "building-2") : a son onglet dédié sur /home,
                // un click ici routerait vers /home avec un filtre contradictoire (excludeImmo).
                data={categories.filter((c) => c.icone !== "building-2")}
                keyExtractor={(item) => item.id}
                numColumns={2}
                scrollEnabled={false}
                columnWrapperStyle={{ gap: 12 }}
                contentContainerStyle={{ gap: 12 }}
                renderItem={({ item }) => {
                  const Icon = getCategoryIcon(item.icone);
                  return (
                    <Pressable
                      onPress={() => onCategoryPress(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Catégorie ${item.nom}`}
                      className="flex-1 flex-row items-center gap-3 bg-niqo-gray-50 rounded-card px-4 min-h-[64px] active:opacity-60"
                    >
                      <View className="w-10 h-10 rounded-full bg-niqo-white items-center justify-center">
                        <Icon size={20} color="#1A1A1A" />
                      </View>
                      <Text
                        className="font-body text-label text-niqo-black flex-1"
                        numberOfLines={1}
                        allowFontScaling={false}
                      >
                        {item.nom}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            </View>
          )}
        </ScrollView>
      )}

      <BottomNav active="search" onTabPress={onTabPress} />
    </View>
  );
}
