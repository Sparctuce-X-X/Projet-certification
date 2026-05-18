import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  MapPin,
  ShieldOff,
  ShoppingBag,
  Sparkles,
  Star,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
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

import { BlockUserSheet } from "@/components/blocking/BlockUserSheet";
import { AnnouncementCard } from "@/components/ui/AnnouncementCard";
import { AvisCard } from "@/components/notation/AvisCard";
import { ReportButton } from "@/components/ui/ReportButton";
import { fetchAnnonces, type AnnonceListItem } from "@/lib/annonces";
import { useAuth } from "@/lib/auth/AuthProvider";
import { unblockUser } from "@/lib/blocking";
import { loadMyFavoriteIds, toggleFavorite } from "@/lib/favorites";
import { useBlockedUsers } from "@/lib/hooks/useBlockedUsers";
import {
  fetchPublicUserProfile,
  isTrustedSeller,
  MIN_ACHATS_FOR_NOTE,
  MIN_VENTES_FOR_NOTE,
  type PublicUserProfile,
} from "@/lib/users";

// ── Helpers ─────────────────────────────────────────────────────────────────

const COUNTRY_LABELS: Record<string, { label: string; flag: string }> = {
  CI: { label: "Côte d'Ivoire", flag: "🇨🇮" },
  CG: { label: "Congo", flag: "🇨🇬" },
};

function formatMemberSince(isoDate: string): string {
  const date = new Date(isoDate);
  const months = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function getInitials(prenom: string, nomInitial: string): string {
  return (prenom[0] ?? "U") + (nomInitial[0] ?? "");
}

// Badge "Vendeur fiable" — seuils centralisés dans lib/users.ts

/** Nouveau vendeur : inscrit depuis moins de 30 jours */
function isNewSeller(seller: PublicUserProfile): boolean {
  const daysSinceCreation = Math.floor(
    (Date.now() - new Date(seller.created_at).getTime()) / 86_400_000
  );
  return daysSinceCreation < 30;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { profile: myProfile, requireAuth } = useAuth();

  const [seller, setSeller] = useState<PublicUserProfile | null>(null);
  const [annonces, setAnnonces] = useState<AnnonceListItem[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [blockSheetVisible, setBlockSheetVisible] = useState(false);

  const { blockedIds, refresh: refreshBlocked } = useBlockedUsers();
  const isBlocked = id ? blockedIds.has(id) : false;

  const isOwner = myProfile?.id === id;

  // Hydrate la liste des favoris du user au mount — sinon le cœur sur les
  // cards annonces de ce profil reste toujours vide même si la fav existe
  // déjà (cache mémoire de lib/favorites.ts).
  useEffect(() => {
    void loadMyFavoriteIds().then((ids) => setFavIds(new Set(ids)));
  }, []);

  const loadProfile = useCallback(async () => {
    if (!id) return;
    try {
      const profile = await fetchPublicUserProfile(id);
      if (!profile) return;
      setSeller(profile);
      const items = await fetchAnnonces({
        pays: profile.pays as "CI" | "CG",
        vendeurId: id,
        limit: 40,
      });
      setAnnonces(items);
    } catch {
      // silent
    }
  }, [id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const profile = await fetchPublicUserProfile(id);
        if (cancelled) return;
        if (!profile) {
          setError("Profil introuvable");
          return;
        }
        setSeller(profile);

        const items = await fetchAnnonces({
          pays: profile.pays as "CI" | "CG",
          vendeurId: id,
          limit: 40,
        });
        if (!cancelled) setAnnonces(items);
      } catch {
        if (!cancelled) setError("Impossible de charger le profil. Vérifie ta connexion.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  const onAnnouncementPress = useCallback((annonceId: string) => {
    router.push(`/announce/${annonceId}`);
  }, []);

  const onBlockPress = useCallback(() => {
    if (!requireAuth("contact")) return;
    setBlockSheetVisible(true);
  }, [requireAuth]);

  const onUnblockPress = useCallback(() => {
    if (!id || !seller) return;
    Alert.alert(
      `Débloquer ${seller.prenom} ?`,
      "Cette personne pourra à nouveau te contacter et voir tes annonces.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Débloquer",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                const result = await unblockUser(id);
                if (!result.success) {
                  Alert.alert(
                    "Erreur",
                    result.error ?? "Le déblocage a échoué."
                  );
                  return;
                }
                void refreshBlocked();
              } catch {
                Alert.alert(
                  "Erreur",
                  "Vérifie ta connexion et réessaie."
                );
              }
            })();
          },
        },
      ]
    );
  }, [id, seller, refreshBlocked]);

  const onFavoritePress = useCallback(
    (annonceId: string) => {
      if (!requireAuth("favorite")) return;
      void (async () => {
        try {
          const newState = await toggleFavorite(annonceId);
          setFavIds((prev) => {
            const next = new Set(prev);
            if (newState) next.add(annonceId);
            else next.delete(annonceId);
            return next;
          });
        } catch {
          // silent — toggleFavorite rollback déjà le cache mémoire
        }
      })();
    },
    [requireAuth]
  );

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View className="flex-1 bg-niqo-gray-50 items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color="#D85A30" />
      </View>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────
  if (error || !seller) {
    return (
      <View className="flex-1 bg-niqo-white items-center justify-center px-6">
        <Stack.Screen options={{ headerShown: false }} />
        <AlertTriangle size={40} color="#E24B4A" />
        <Text className="mt-4 font-display text-h3 text-niqo-black text-center">
          {error ?? "Profil introuvable"}
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="mt-6 bg-niqo-coral rounded-btn px-6 min-h-[44px] items-center justify-center active:opacity-80"
        >
          <Text className="font-body text-label text-niqo-white">Retour</Text>
        </Pressable>
      </View>
    );
  }

  const countryInfo = COUNTRY_LABELS[seller.pays] ?? { label: seller.pays, flag: "" };
  const initials = getInitials(seller.prenom, seller.nom_initial);
  const trusted = isTrustedSeller(seller.nb_ventes, seller.note_vendeur);
  const newSeller = isNewSeller(seller);

  return (
    <View
      style={{ flex: 1, paddingTop: insets.top }}
      className="bg-niqo-gray-50"
    >
      <Stack.Screen options={{ headerShown: false }} />

      <FlatList
        data={annonces}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 32,
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
        ListHeaderComponent={
          <View>
            {/* ── Header bar ────────────────────────────────────────────── */}
            <View className="flex-row items-center py-2 mb-2">
              <Pressable
                onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
                accessibilityRole="button"
                accessibilityLabel="Retour"
                className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
              >
                <ArrowLeft size={22} color="#1A1A1A" />
              </Pressable>
              <View className="flex-1" />
              {!isOwner && id && (
                <ReportButton targetType="utilisateur" targetId={id} />
              )}
            </View>

            {/* ── Hero section ──────────────────────────────────────────── */}
            <View className="px-1 pb-4 mb-2">
              {/* Avatar + badge confiance */}
              <View className="items-center">
                <View className="relative">
                  {/* Anneau vert autour de l'avatar si vendeur fiable */}
                  <View
                    style={{
                      width: trusted ? 104 : 96,
                      height: trusted ? 104 : 96,
                      borderRadius: trusted ? 52 : 48,
                      borderWidth: trusted ? 3 : 0,
                      borderColor: "#1D9E75",
                      padding: trusted ? 2 : 0,
                    }}
                  >
                    {seller.avatar_url ? (
                      <Image
                        source={{ uri: seller.avatar_url }}
                        style={{ width: 96, height: 96, borderRadius: 48 }}
                        contentFit="cover"
                        transition={150}
                      />
                    ) : (
                      <View
                        style={{ width: 96, height: 96, borderRadius: 48 }}
                        className="bg-niqo-coral items-center justify-center"
                      >
                        <Text className="font-display text-h1 text-niqo-white" allowFontScaling={false}>
                          {initials.toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                  {/* Badge check vendeur fiable */}
                  {trusted && (
                    <View
                      className="absolute -bottom-1 -right-1 bg-niqo-white rounded-full p-1"
                      style={{ shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 }}
                    >
                      <CheckCircle2 size={24} color="#1D9E75" fill="#1D9E75" />
                    </View>
                  )}
                </View>

                {/* Nom + badge Vérifié inline (style Instagram) */}
                <View className="flex-row items-center justify-center gap-1.5 mt-3">
                  <Text className="font-display text-h2 text-niqo-black text-center">
                    {seller.prenom} {seller.nom_initial}
                  </Text>
                  {seller.is_verified && (
                    <View
                      accessibilityLabel="Vendeur Vérifié"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: "#D85A30",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Check size={13} color="#FFFFFF" strokeWidth={3.2} />
                    </View>
                  )}
                </View>

                {/* Badges textes — Vérifié, Fiable, Nouveau côte à côte.
                    Cohabite avec le badge inline coral (Vérifié) et l'anneau
                    vert (Fiable) — double signalisation rassurante. */}
                {(seller.is_verified || trusted || newSeller) && (
                  <View className="flex-row items-center flex-wrap justify-center gap-2 mt-2">
                    {seller.is_verified && (
                      <View className="flex-row items-center bg-niqo-coral-light rounded-full px-3 py-1">
                        <CheckCircle2 size={12} color="#D85A30" />
                        <Text className="ml-1 font-body text-micro text-niqo-coral">
                          Vendeur Vérifié
                        </Text>
                      </View>
                    )}
                    {trusted && (
                      <View className="flex-row items-center bg-niqo-success/10 rounded-full px-3 py-1">
                        <CheckCircle2 size={12} color="#1D9E75" />
                        <Text className="ml-1 font-body text-micro text-niqo-success">
                          Vendeur Fiable
                        </Text>
                      </View>
                    )}
                    {newSeller && (
                      <View className="flex-row items-center bg-niqo-gray-100 rounded-full px-3 py-1">
                        <Sparkles size={12} color="#888780" />
                        <Text className="ml-1 font-body text-micro text-niqo-gray-800">
                          Nouveau
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Localisation */}
                <View className="flex-row items-center mt-2">
                  <MapPin size={14} color="#888780" />
                  <Text className="ml-1 font-body text-caption text-niqo-gray-500">
                    {seller.ville}
                  </Text>
                  <Text className="mx-1.5 text-niqo-gray-300">·</Text>
                  <Text className="font-body text-caption text-niqo-gray-500">
                    {countryInfo.flag} {countryInfo.label}
                  </Text>
                </View>

                {/* Membre depuis */}
                <View className="flex-row items-center mt-1">
                  <Calendar size={12} color="#888780" />
                  <Text className="ml-1 font-body text-micro text-niqo-gray-500">
                    Membre depuis {formatMemberSince(seller.created_at)}
                  </Text>
                </View>
              </View>

              {/* ── Stats bento — vendeur + acheteur ─────────────────────── */}
              <View className="flex-row gap-3 mt-5">
                {/* Comme vendeur */}
                <View className="flex-1 bg-niqo-gray-50 rounded-card p-4">
                  <Text className="font-body text-micro text-niqo-gray-500 uppercase tracking-wide">
                    Vendeur
                  </Text>
                  <View className="flex-row items-center mt-2">
                    <Star
                      size={18}
                      color="#D85A30"
                      fill={seller.nb_ventes >= MIN_VENTES_FOR_NOTE ? "#D85A30" : "none"}
                      strokeWidth={seller.nb_ventes >= MIN_VENTES_FOR_NOTE ? 1.5 : 2}
                    />
                    <Text className="ml-1.5 font-mono text-h2 text-niqo-black">
                      {seller.nb_ventes >= MIN_VENTES_FOR_NOTE
                        ? seller.note_vendeur.toFixed(1)
                        : "—"}
                    </Text>
                  </View>
                  <Text className="font-body text-caption text-niqo-gray-800 mt-1">
                    {seller.nb_ventes} vente{seller.nb_ventes !== 1 ? "s" : ""}
                  </Text>
                </View>

                {/* Comme acheteur */}
                <View className="flex-1 bg-niqo-gray-50 rounded-card p-4">
                  <Text className="font-body text-micro text-niqo-gray-500 uppercase tracking-wide">
                    Acheteur
                  </Text>
                  <View className="flex-row items-center mt-2">
                    <Star
                      size={18}
                      color="#D85A30"
                      fill={seller.nb_achats >= MIN_ACHATS_FOR_NOTE ? "#D85A30" : "none"}
                      strokeWidth={seller.nb_achats >= MIN_ACHATS_FOR_NOTE ? 1.5 : 2}
                    />
                    <Text className="ml-1.5 font-mono text-h2 text-niqo-black">
                      {seller.nb_achats >= MIN_ACHATS_FOR_NOTE
                        ? seller.note_acheteur.toFixed(1)
                        : "—"}
                    </Text>
                  </View>
                  <Text className="font-body text-caption text-niqo-gray-800 mt-1">
                    {seller.nb_achats} achat{seller.nb_achats !== 1 ? "s" : ""}
                  </Text>
                </View>
              </View>

              {/* Annonces actives — ligne discrète sous le bento */}
              {annonces.length > 0 && (
                <View className="flex-row items-center mt-3">
                  <ShoppingBag size={12} color="#888780" />
                  <Text className="ml-1.5 font-body text-micro text-niqo-gray-500">
                    {annonces.length} annonce{annonces.length !== 1 ? "s" : ""} active{annonces.length !== 1 ? "s" : ""}
                  </Text>
                </View>
              )}

              {/* ── CTA ──────────────────────────────────────────────────── */}
              {/* Owner uniquement : bouton "Modifier mon profil" → /profile/edit
                  direct (au lieu de /profile qui force un 2e tap). Pas de bouton
                  "Contacter" générique côté visiteur : Niqo est annonces-centric
                  (get_or_create_conversation exige annonce_id). Le visiteur passe
                  par les cards annonce ci-dessous pour démarrer une conv ciblée. */}
              {isOwner && (
                <View className="mt-5">
                  <Pressable
                    onPress={() => router.push("/profile/edit")}
                    accessibilityRole="button"
                    accessibilityLabel="Modifier mon profil"
                    className="bg-niqo-gray-50 border border-niqo-gray-200 rounded-btn min-h-[48px] items-center justify-center active:opacity-80"
                  >
                    <Text className="font-body text-label text-niqo-black">
                      Modifier mon profil
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* ── Action "Bloquer / Débloquer" (visiteur non-owner uniquement)
                Discret, posé après l'identité du vendeur — pas un gros bouton,
                pour rester cohérent avec le bouton Signaler (drapeau) qui est
                aussi inline. Apple Guideline 1.2 UGC : block CTA visible. */}
            {!isOwner && id && (
              <View className="mb-6">
                <Pressable
                  onPress={isBlocked ? onUnblockPress : onBlockPress}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isBlocked
                      ? `Débloquer ${seller.prenom}`
                      : `Bloquer ${seller.prenom}`
                  }
                  className={`flex-row items-center justify-center gap-2 rounded-btn min-h-[48px] px-4 border active:opacity-60 ${
                    isBlocked
                      ? "bg-niqo-gray-50 border-niqo-gray-200"
                      : "bg-niqo-white border-niqo-danger"
                  }`}
                >
                  <ShieldOff
                    size={20}
                    color={isBlocked ? "#444441" : "#E24B4A"}
                    strokeWidth={2.2}
                  />
                  <Text
                    className={`font-display text-label ${
                      isBlocked ? "text-niqo-black" : "text-niqo-danger"
                    }`}
                  >
                    {isBlocked
                      ? "Débloquer cet utilisateur"
                      : "Bloquer cet utilisateur"}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* ── Section avis reçus ───────────────────────────────────── */}
            {seller.recent_avis && seller.recent_avis.length > 0 && (
              <View className="mb-6">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="font-display text-h3 text-niqo-black">
                    Avis reçus
                  </Text>
                  <Text className="font-body text-micro text-niqo-gray-500">
                    {seller.recent_avis.length}
                    {seller.recent_avis.length === 10 ? "+" : ""}
                  </Text>
                </View>
                <View className="gap-2">
                  {seller.recent_avis.map((a) => (
                    <AvisCard key={a.id} avis={a} />
                  ))}
                </View>
              </View>
            )}

            {/* ── Section annonces ─────────────────────────────────────── */}
            <View className="flex-row items-center justify-between mb-2">
              <Text className="font-display text-h3 text-niqo-black">
                Annonces
              </Text>
              {annonces.length > 0 && (
                <Text className="font-body text-micro text-niqo-gray-500">
                  {annonces.length} active{annonces.length !== 1 ? "s" : ""}
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
        ListEmptyComponent={
          <View className="items-center justify-center py-12 px-4 bg-niqo-white rounded-card">
            <ShoppingBag size={32} color="#888780" />
            <Text className="mt-3 font-body text-body text-niqo-gray-500 text-center">
              {isOwner
                ? "Tu n'as pas encore d'annonce active"
                : "Ce vendeur n'a pas d'annonce active"}
            </Text>
            {isOwner && (
              <Pressable
                onPress={() => router.push("/sell")}
                accessibilityRole="button"
                className="mt-4 bg-niqo-coral rounded-btn px-6 min-h-[44px] items-center justify-center active:opacity-80"
              >
                <Text className="font-body text-label text-niqo-white">
                  Vendre un article
                </Text>
              </Pressable>
            )}
          </View>
        }
      />

      {/* Bottom sheet de blocage. id & seller garantis non-null car le composant
          a déjà early-return en loading/error états plus haut. */}
      {id && seller && (
        <BlockUserSheet
          visible={blockSheetVisible}
          targetUserId={id}
          targetPrenom={seller.prenom}
          onClose={() => setBlockSheetVisible(false)}
          onBlocked={() => void refreshBlocked()}
        />
      )}
    </View>
  );
}
