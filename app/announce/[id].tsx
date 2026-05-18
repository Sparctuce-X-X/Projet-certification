import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarX,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Handshake,
  Heart,
  MapPin,
  Pencil,
  PackageCheck,
  Share2,
  ShieldOff,
  Sparkles,
  Trash2,
  User,
  Zap,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  deleteAnnonce,
  fetchAnnonceById,
  type Annonce,
  type EtatObjet,
} from "@/lib/annonces";
import { formatBoostRemaining, isBoostActive } from "@/lib/boost";
import { useAuth } from "@/lib/auth/AuthProvider";
import { isFavorite, loadMyFavoriteIds, toggleFavorite } from "@/lib/favorites";
import { getOrCreateConversation } from "@/lib/messages";
import { ReportButton } from "@/components/ui/ReportButton";
import { getAnnoncePhotoUrl } from "@/lib/storage/annonces-photos";
import { supabase } from "@/lib/supabase";
import { fetchPublicUserProfile, type PublicUserProfile } from "@/lib/users";

// ── Helpers ─────────────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get("window").width;

const ETAT_LABELS: Record<EtatObjet, string> = {
  neuf: "Neuf",
  tres_bon: "Très bon",
  bon: "Bon",
  moyen: "Moyen",
};

function formatPrice(value: number): string {
  return value.toLocaleString("fr-FR").replace(/\u00A0/g, " ");
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Hier";
  if (days < 30) return `Il y a ${days} jours`;
  const months = Math.floor(days / 30);
  if (months === 1) return "Il y a 1 mois";
  return `Il y a ${months} mois`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function AnnounceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { profile, requireAuth } = useAuth();

  const [annonce, setAnnonce] = useState<Annonce | null>(null);
  const [seller, setSeller] = useState<PublicUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [marking, setMarking] = useState(false);
  const [hasMeetingConfirmed, setHasMeetingConfirmed] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const galleryRef = useRef<FlatList>(null);

  const isOwner = profile?.id === annonce?.vendeur_id;

  // ── Favori — hydrate au mount ────────────────────────────────────────────
  // Cache mémoire de lib/favorites.ts. Sur navigation rapide entre annonces,
  // on évite un round-trip.
  useEffect(() => {
    if (!id) return;
    void loadMyFavoriteIds().then(() => setIsFavorited(isFavorite(id)));
  }, [id]);

  // ── Animation cœur ──────────────────────────────────────────────────────
  const heartScale = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const onToggleFavorite = useCallback(() => {
    if (!annonce) return;
    if (!requireAuth("favorite")) return;

    if (Platform.OS === "ios") {
      void Haptics.impactAsync(
        isFavorited
          ? Haptics.ImpactFeedbackStyle.Light
          : Haptics.ImpactFeedbackStyle.Medium
      );
    }
    if (!isFavorited) {
      heartScale.value = withSequence(
        withTiming(0.5, { duration: 120 }),
        withSpring(1.25, { damping: 5, stiffness: 280 }),
        withSpring(1, { damping: 8, stiffness: 200 })
      );
    } else {
      heartScale.value = withSequence(
        withTiming(0.8, { duration: 120 }),
        withSpring(1, { damping: 10, stiffness: 250 })
      );
    }

    void (async () => {
      try {
        const newState = await toggleFavorite(annonce.id);
        setIsFavorited(newState);
      } catch {
        // toggleFavorite rollback déjà le cache mémoire
      }
    })();
  }, [annonce, requireAuth, isFavorited, heartScale]);

  // ── Partage (D2) ────────────────────────────────────────────────────────
  // URL publique web (landing/src/app/a/[id]/page.tsx) — auto-linkifiée par
  // tous les messagers (WhatsApp, iMessage, Telegram). La page web tente
  // d'ouvrir `niqo://announce/{id}` via le bouton CTA — fallback "Télécharger
  // l'app" sinon. Universal Links (ouverture directe sans passer par le web)
  // = Phase 2 (cf. docs/pre-production-checklist.md).
  const onSharePress = useCallback(() => {
    if (!annonce) return;
    const message = `Regarde cette annonce sur Niqo : ${annonce.titre}\n${formatPrice(annonce.prix)} FCFA · ${annonce.ville}\n\nhttps://niqo.africa/a/${annonce.id}`;
    void Share.share({
      message,
      title: annonce.titre,
    }).catch(() => {
      // User cancel ou share sheet indisponible — silent.
    });
  }, [annonce]);

  // ── Fetch ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const data = await fetchAnnonceById(id);
        if (cancelled) return;
        if (!data) {
          setError("Annonce introuvable");
          return;
        }
        setAnnonce(data);

        // Fetch seller profile (fire-and-forget for UI — non-blocking)
        const profile = await fetchPublicUserProfile(data.vendeur_id);
        if (!cancelled) setSeller(profile);
      } catch {
        if (!cancelled) setError("Impossible de charger l'annonce. Vérifie ta connexion.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // ── Fetch : au moins une rencontre éligible mig 88 sur cette annonce ? ──
  // Critère : rdv_confirme_at != null AND rencontre_acheteur=true AND
  //          rencontre_vendeur != false. Aligne le bouton sur la règle serveur
  //          (mark_annonce_vendue raise no_meeting_confirmed sinon).
  // Mig 101 : bypass complet pour annonces immo (type_offre != null) — pas
  //           de RDV en mode immo donc pas de rencontre possible, le vendeur
  //           peut clore son annonce à tout moment.
  useEffect(() => {
    if (!isOwner || !annonce) {
      setHasMeetingConfirmed(false);
      return;
    }
    if (annonce.type_offre != null) {
      setHasMeetingConfirmed(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("annonce_id", annonce.id)
        .not("rdv_confirme_at", "is", null)
        .eq("rencontre_acheteur", true)
        .not("rencontre_vendeur", "is", false);
      if (!cancelled) setHasMeetingConfirmed((count ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, annonce]);

  // ── Action : marquer l'annonce comme vendue/louée ────────────────────────
  // Mig 101 : libellé adapté immo location → "louée", sinon → "vendue".
  // Le statut DB reste `vendue` (state machine unique).
  const onMarkVendue = useCallback(() => {
    if (!annonce || marking) return;
    const isLocation = annonce.type_offre === "location";
    const verbPast = isLocation ? "louée" : "vendue";
    Alert.alert(
      `Marquer comme ${verbPast} ?`,
      `Ton annonce ne sera plus visible dans la recherche. L'historique des conversations et avis reste intact.`,
      [
        { text: "Non", style: "cancel" },
        {
          text: `Oui, ${verbPast}`,
          onPress: async () => {
            setMarking(true);
            const { data, error } = await supabase.rpc("mark_annonce_vendue", {
              p_annonce_id: annonce.id,
            });
            setMarking(false);
            if (error || !(data as { success?: boolean })?.success) {
              const code = (data as { error?: string })?.error ?? "";
              const msg: Record<string, string> = {
                no_meeting_confirmed:
                  "L'acheteur n'a pas encore confirmé la rencontre — demande-lui dans le chat.",
                not_owner: "Tu n'es pas le propriétaire de cette annonce.",
                invalid_state: `L'annonce ne peut plus être marquée comme ${verbPast}.`,
              };
              Alert.alert(
                "Impossible",
                msg[code] ?? `Impossible de marquer l'annonce comme ${verbPast}. Réessaie.`
              );
              return;
            }
            // Refresh local annonce statut (DB reste 'vendue', libellé géré côté UI)
            setAnnonce((prev) => (prev ? { ...prev, statut: "vendue" } : prev));
          },
        },
      ]
    );
  }, [annonce, marking]);

  // ── Gallery navigation ──────────────────────────────────────────────────
  const scrollToPhoto = useCallback(
    (index: number) => {
      if (!annonce) return;
      const clamped = Math.max(0, Math.min(index, annonce.photos.length - 1));
      galleryRef.current?.scrollToIndex({ index: clamped, animated: true });
      setPhotoIndex(clamped);
    },
    [annonce]
  );

  // ── Actions owner ───────────────────────────────────────────────────────
  const onEdit = useCallback(() => {
    if (!annonce) return;
    router.push(`/announce/${annonce.id}/edit`);
  }, [annonce]);

  const onDelete = useCallback(() => {
    if (!annonce) return;
    Alert.alert(
      "Supprimer l'annonce",
      "Cette action est irréversible. Tes photos seront aussi supprimées.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAnnonce(annonce.id);
              router.replace("/home");
            } catch {
              Alert.alert("Erreur", "Impossible de supprimer l'annonce. Réessaie.");
              setDeleting(false);
            }
          },
        },
      ]
    );
  }, [annonce]);

  // ── Buyer action ────────────────────────────────────────────────────────
  const [contacting, setContacting] = useState(false);
  const onContact = useCallback(async () => {
    if (!requireAuth("contact") || !annonce || contacting) return;
    setContacting(true);
    try {
      const result = await getOrCreateConversation(annonce.id);
      if (result.success && result.conversation) {
        router.push(`/messages/${result.conversation.id}` as never);
      } else {
        const msgs: Record<string, string> = {
          cannot_message_self: "Tu ne peux pas te contacter toi-même.",
          annonce_not_available: "Cette annonce n'est plus disponible.",
          annonce_not_found: "Annonce introuvable.",
        };
        Alert.alert("Impossible", msgs[result.error ?? ""] ?? "Réessaie plus tard.");
      }
    } catch {
      Alert.alert("Erreur", "Impossible de contacter le vendeur. Vérifie ta connexion.");
    } finally {
      setContacting(false);
    }
  }, [requireAuth, annonce, contacting]);

  // ── Loading / Error ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <View className="flex-1 bg-niqo-white items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color="#D85A30" />
      </View>
    );
  }

  if (error || !annonce) {
    return (
      <View className="flex-1 bg-niqo-white items-center justify-center px-6">
        <Stack.Screen options={{ headerShown: false }} />
        <AlertTriangle size={40} color="#E24B4A" />
        <Text className="mt-4 font-display text-h3 text-niqo-black text-center">
          {error ?? "Annonce introuvable"}
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-6 bg-niqo-coral rounded-btn px-6 min-h-[44px] items-center justify-center active:opacity-80"
        >
          <Text className="font-body text-label text-niqo-white">Retour</Text>
        </Pressable>
      </View>
    );
  }

  const photoUrls = annonce.photos.map(getAnnoncePhotoUrl);
  const currency = annonce.pays === "CI" ? "FCFA" : "XAF";

  return (
    <View
      style={{ flex: 1, paddingBottom: insets.bottom }}
      className="bg-niqo-white"
    >
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* ── Photo gallery ──────────────────────────────────────────── */}
        <View className="relative">
          <FlatList
            ref={galleryRef}
            data={photoUrls}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(
                e.nativeEvent.contentOffset.x / SCREEN_WIDTH
              );
              setPhotoIndex(idx);
            }}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <Image
                source={{ uri: item }}
                style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }}
                contentFit="cover"
                placeholder={{ blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4" }}
                transition={200}
              />
            )}
          />

          {/* Back button overlay */}
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
            accessibilityRole="button"
            accessibilityLabel="Retour"
            style={{ top: insets.top + 8 }}
            className="absolute left-3 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-niqo-white/90 items-center justify-center active:opacity-60"
          >
            <ArrowLeft size={20} color="#1A1A1A" />
          </Pressable>

          {/* Partager (D2) — top-right, à gauche du cœur. Visible aussi pour
              owner (partager sa propre annonce a du sens). Deep link niqo://
              dans le message — ne pas mettre dans `url` car iOS share sheet
              gère mal les schemes custom. */}
          <Pressable
            onPress={onSharePress}
            accessibilityRole="button"
            accessibilityLabel="Partager l'annonce"
            hitSlop={8}
            style={{ top: insets.top + 8, right: isOwner ? 12 : 64 }}
            className="absolute min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-niqo-white/90 items-center justify-center active:opacity-60"
          >
            <Share2 size={20} color="#1A1A1A" />
          </Pressable>

          {/* Favori (D1 audit) — top-right, masqué pour owner (pas de sens
              de favoriser sa propre annonce). Cohérent avec AnnouncementCard
              (animation, haptic, palette coral). */}
          {!isOwner && (
            <Pressable
              onPress={onToggleFavorite}
              accessibilityRole="button"
              accessibilityLabel={
                isFavorited ? "Retirer des favoris" : "Ajouter aux favoris"
              }
              hitSlop={8}
              style={{ top: insets.top + 8 }}
              className="absolute right-3 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-niqo-white/90 items-center justify-center active:opacity-60"
            >
              <Animated.View style={heartStyle}>
                <Heart
                  size={20}
                  color={isFavorited ? "#D85A30" : "#1A1A1A"}
                  fill={isFavorited ? "#D85A30" : "none"}
                />
              </Animated.View>
            </Pressable>
          )}

          {/* Photo counter — bottom-right pour libérer top-right au cœur */}
          {annonce.photos.length > 1 && (
            <View className="absolute bottom-3 right-3 bg-niqo-black/60 rounded-full px-3 py-1">
              <Text className="font-mono text-micro text-niqo-white">
                {photoIndex + 1}/{annonce.photos.length}
              </Text>
            </View>
          )}

          {/* Navigation arrows */}
          {annonce.photos.length > 1 && photoIndex > 0 && (
            <Pressable
              onPress={() => scrollToPhoto(photoIndex - 1)}
              accessibilityRole="button"
              accessibilityLabel="Photo précédente"
              hitSlop={6}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-niqo-white/80 items-center justify-center active:opacity-60"
            >
              <ChevronLeft size={20} color="#1A1A1A" />
            </Pressable>
          )}
          {annonce.photos.length > 1 &&
            photoIndex < annonce.photos.length - 1 && (
              <Pressable
                onPress={() => scrollToPhoto(photoIndex + 1)}
                accessibilityRole="button"
                accessibilityLabel="Photo suivante"
                hitSlop={6}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-niqo-white/80 items-center justify-center active:opacity-60"
              >
                <ChevronRight size={20} color="#1A1A1A" />
              </Pressable>
            )}

          {/* Dots indicator */}
          {annonce.photos.length > 1 && (
            <View className="absolute bottom-3 left-0 right-0 flex-row justify-center">
              {annonce.photos.map((_, i) => (
                <View
                  key={i}
                  className={`w-2 h-2 rounded-full mx-1 ${
                    i === photoIndex ? "bg-niqo-coral" : "bg-niqo-white/60"
                  }`}
                />
              ))}
            </View>
          )}
        </View>

        {/* ── Content ────────────────────────────────────────────────── */}
        <View className="px-4 pt-4 pb-6">
          {/* Prix + état */}
          <View className="flex-row items-center justify-between mb-2">
            <Text
              className="font-mono text-price text-niqo-black"
              allowFontScaling={false}
            >
              {formatPrice(annonce.prix)} {currency}
              {annonce.type_offre === "location" && (
                <Text className="font-body text-caption text-niqo-gray-500">/mois</Text>
              )}
            </Text>
            <View className="bg-niqo-gray-100 rounded-btn px-3 py-1">
              <Text className="font-body text-micro text-niqo-gray-800">
                {annonce.type_bien
                  ? annonce.type_bien.charAt(0).toUpperCase() + annonce.type_bien.slice(1)
                  : annonce.etat ? ETAT_LABELS[annonce.etat] : ""}
              </Text>
            </View>
          </View>

          {/* Badge boost (visible par tous, F09) */}
          {annonce.is_boosted &&
            annonce.boost_until &&
            new Date(annonce.boost_until) > new Date() && (
              <View className="flex-row items-center self-start bg-niqo-coral rounded-full px-3 py-1.5 mb-2">
                <Sparkles size={13} color="#FFFFFF" strokeWidth={2.4} />
                <Text className="ml-1.5 font-display text-micro text-niqo-white font-medium">
                  Sponsorisé
                </Text>
              </View>
            )}

          {/* Badge statut (en_cours / vendue) */}
          {annonce.statut === "en_cours" && (
            <View className="flex-row items-center self-start bg-niqo-coral/10 border border-niqo-coral/20 rounded-full px-3 py-1.5 mb-2">
              <Handshake size={14} color="#D85A30" />
              <Text className="ml-1.5 font-display text-micro text-niqo-coral">
                RDV en cours
              </Text>
            </View>
          )}
          {annonce.statut === "vendue" && (
            <View className="flex-row items-center self-start bg-niqo-success/10 border border-niqo-success/20 rounded-full px-3 py-1.5 mb-2">
              <CheckCircle2 size={14} color="#2D8654" />
              <Text className="ml-1.5 font-display text-micro text-niqo-success">
                {annonce.type_offre === "location" ? "Louée" : "Vendue"}
              </Text>
            </View>
          )}

          {/* Titre */}
          <Text className="font-display text-h2 text-niqo-black mb-2">
            {annonce.titre}
          </Text>

          {/* Localisation + date + vues */}
          <View className="flex-row items-center flex-wrap mb-4">
            <MapPin size={14} color="#888780" />
            <Text className="ml-1 font-body text-caption text-niqo-gray-500">
              {annonce.ville}
              {annonce.quartier ? `, ${annonce.quartier}` : ""}
            </Text>
            <Text className="mx-2 text-niqo-gray-300">·</Text>
            <Text className="font-body text-caption text-niqo-gray-500">
              {timeAgo(annonce.created_at)}
            </Text>
            <Text className="mx-2 text-niqo-gray-300">·</Text>
            <Eye size={14} color="#888780" />
            <Text className="ml-1 font-body text-caption text-niqo-gray-500">
              {annonce.nb_vues}
            </Text>
          </View>

          {/* Séparateur */}
          <View className="h-px bg-niqo-gray-150 mb-4" />

          {/* Description */}
          <Text className="font-display text-h3 text-niqo-black mb-2">
            Description
          </Text>
          <Text className="font-body text-body text-niqo-gray-800 mb-6 leading-relaxed">
            {annonce.description}
          </Text>

          {/* ── Caractéristiques immobilier ─────────────────────── */}
          {annonce.type_bien && (
            <>
              <View className="h-px bg-niqo-gray-150 mb-4" />
              <Text className="font-display text-h3 text-niqo-black mb-3">
                Caractéristiques
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-6">
                {/* Type offre */}
                <View className={`rounded-full px-3 py-1.5 ${
                  annonce.type_offre === "location"
                    ? "bg-niqo-status-escrow-bg"
                    : "bg-niqo-status-complete-bg"
                }`}>
                  <Text className={`font-body text-caption ${
                    annonce.type_offre === "location"
                      ? "text-niqo-status-escrow-text"
                      : "text-niqo-status-complete-text"
                  }`}>
                    {annonce.type_offre === "location" ? "Location" : "Vente"}
                  </Text>
                </View>
                {/* Type bien */}
                <View className="bg-niqo-gray-100 rounded-full px-3 py-1.5">
                  <Text className="font-body text-caption text-niqo-gray-800">
                    {annonce.type_bien.charAt(0).toUpperCase() + annonce.type_bien.slice(1)}
                  </Text>
                </View>
                {/* Surface */}
                {annonce.surface_m2 && (
                  <View className="bg-niqo-gray-100 rounded-full px-3 py-1.5">
                    <Text className="font-body text-caption text-niqo-gray-800">
                      {annonce.surface_m2} m²
                    </Text>
                  </View>
                )}
                {/* Pièces */}
                {annonce.nb_pieces && (
                  <View className="bg-niqo-gray-100 rounded-full px-3 py-1.5">
                    <Text className="font-body text-caption text-niqo-gray-800">
                      {annonce.nb_pieces} pièce{annonce.nb_pieces > 1 ? "s" : ""}
                    </Text>
                  </View>
                )}
                {/* Meublé */}
                {annonce.meuble !== null && (
                  <View className="bg-niqo-gray-100 rounded-full px-3 py-1.5">
                    <Text className="font-body text-caption text-niqo-gray-800">
                      {annonce.meuble ? "Meublé" : "Vide"}
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}

          {/* Séparateur */}
          <View className="h-px bg-niqo-gray-150 mb-4" />

          {/* ── Vendeur ────────────────────────────────────────────── */}
          <View className="flex-row items-center justify-between mb-3">
            <Text className="font-display text-h3 text-niqo-black">
              Vendeur
            </Text>
            {!isOwner && (
              <ReportButton targetType="annonce" targetId={annonce.id} size={18} />
            )}
          </View>
          {seller ? (
            <Pressable
              onPress={() => router.push(`/u/${annonce.vendeur_id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Voir le profil de ${seller.prenom}`}
              className="flex-row items-center bg-niqo-gray-50 rounded-card p-3 active:opacity-80"
            >
              {seller.avatar_url ? (
                <Image
                  source={{ uri: seller.avatar_url }}
                  className="w-12 h-12 rounded-full"
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View className="w-12 h-12 rounded-full bg-niqo-gray-200 items-center justify-center">
                  <User size={22} color="#888780" />
                </View>
              )}
              <View className="ml-3 flex-1">
                <Text className="font-display text-label text-niqo-black">
                  {seller.prenom} {seller.nom_initial}
                </Text>
                <View className="flex-row items-center mt-1">
                  {seller.nb_ventes >= 3 && (
                    <Text className="font-body text-micro text-niqo-gray-500 mr-2">
                      ★ {seller.note_vendeur.toFixed(1)} · {seller.nb_ventes}{" "}
                      vente{seller.nb_ventes > 1 ? "s" : ""}
                    </Text>
                  )}
                  <Text className="font-body text-micro text-niqo-gray-500">
                    {seller.ville}
                  </Text>
                </View>
              </View>
              <ChevronRight size={18} color="#888780" />
            </Pressable>
          ) : (
            <View className="bg-niqo-gray-50 rounded-card p-3 items-center">
              <ActivityIndicator size="small" color="#888780" />
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── CTA bottom-sticky ─────────────────────────────────────────── */}
      <View
        className="px-4 pt-3 border-t border-niqo-gray-100 bg-niqo-white"
        style={{ paddingBottom: 12 }}
      >
        {isOwner ? (
          /* Owner mode */
          <View className="gap-2">
            {/* Banner boost actif — owner only */}
            {isBoostActive({
              is_boosted: annonce.is_boosted,
              boost_until: annonce.boost_until,
            }) ? (
              <Pressable
                onPress={() => router.push(`/profile/boost/${annonce.id}`)}
                accessibilityRole="button"
                accessibilityLabel="Prolonger le boost"
                className="flex-row items-center gap-2.5 bg-niqo-coral-light border border-niqo-coral/30 rounded-btn px-3.5 py-2.5 active:opacity-80"
              >
                <Sparkles size={16} color="#D85A30" strokeWidth={2.4} />
                <View className="flex-1">
                  <Text className="font-display text-caption text-niqo-black">
                    Boost actif
                  </Text>
                  <Text className="font-body text-micro text-niqo-gray-800 mt-0.5">
                    {formatBoostRemaining(annonce.boost_until)} · tap pour prolonger
                  </Text>
                </View>
                <ChevronRight size={16} color="#D85A30" strokeWidth={2.2} />
              </Pressable>
            ) : annonce.statut === "active" ? (
              /* CTA "Booster cette annonce" — D3 audit. Visible si active
                 non-boostée owner. Pousse vers /profile/boost/{id}. Distinct
                 du banner Boost actif via icône Zap (vs Sparkles plein) et
                 fond plus discret (gray-50 vs coral-light). */
              <Pressable
                onPress={() => router.push(`/profile/boost/${annonce.id}`)}
                accessibilityRole="button"
                accessibilityLabel="Booster cette annonce"
                className="flex-row items-center gap-2.5 bg-niqo-gray-50 border border-niqo-gray-200 rounded-btn px-3.5 py-2.5 active:opacity-80"
              >
                <Zap size={16} color="#D85A30" strokeWidth={2.2} />
                <View className="flex-1">
                  <Text className="font-display text-caption text-niqo-black">
                    Booster cette annonce
                  </Text>
                  <Text className="font-body text-micro text-niqo-gray-800 mt-0.5">
                    Plus de visibilité dès 1 000 FCFA
                  </Text>
                </View>
                <ChevronRight size={16} color="#888780" strokeWidth={2.2} />
              </Pressable>
            ) : null}

            {/* Bouton "Marquer comme vendue/louée" — visible si ≥1 conv où l'acheteur
                a confirmé la rencontre (mig 88, voix acheteur seule).
                Mig 101 : visible direct pour annonces immo (type_offre != null,
                hasMeetingConfirmed forcé true plus haut — pas de RDV en immo) */}
            {hasMeetingConfirmed &&
              (annonce.statut === "active" || annonce.statut === "en_cours") && (
                <Pressable
                  onPress={onMarkVendue}
                  disabled={marking}
                  accessibilityRole="button"
                  accessibilityLabel={
                    annonce.type_offre === "location"
                      ? "Marquer cette annonce comme louée"
                      : "Marquer cette annonce comme vendue"
                  }
                  className={`flex-row items-center justify-center bg-niqo-success rounded-btn min-h-[48px] ${
                    marking ? "opacity-50" : "active:opacity-80"
                  }`}
                >
                  {marking ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <PackageCheck size={16} color="#FFFFFF" />
                      <Text className="ml-2 font-body text-label text-niqo-white">
                        {annonce.type_offre === "location"
                          ? "Marquer comme louée"
                          : "Marquer comme vendue"}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            <View className="flex-row gap-3">
              {annonce.statut === "active" && (
                <Pressable
                  onPress={onEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Modifier l'annonce"
                  className="flex-1 flex-row items-center justify-center bg-niqo-gray-50 border border-niqo-gray-200 rounded-btn min-h-[48px] active:opacity-80"
                >
                  <Pencil size={16} color="#1A1A1A" />
                  <Text className="ml-2 font-body text-label text-niqo-black">
                    Modifier
                  </Text>
                </Pressable>
              )}
              {["active", "expiree", "suspendue"].includes(annonce.statut) && (
                <Pressable
                  onPress={onDelete}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityLabel="Supprimer l'annonce"
                  className={`flex-1 flex-row items-center justify-center border border-niqo-danger rounded-btn min-h-[48px] ${
                    deleting ? "opacity-50" : "active:opacity-80"
                  }`}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color="#E24B4A" />
                  ) : (
                    <>
                      <Trash2 size={16} color="#E24B4A" />
                      <Text className="ml-2 font-body text-label text-niqo-danger">
                        Supprimer
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        ) : annonce.statut === "vendue" ? (
          /* Buyer mode — annonce vendue/louée : pas de contact */
          <View className="flex-row items-center justify-center gap-2 bg-niqo-gray-50 border border-niqo-gray-200 rounded-btn min-h-[48px] px-4">
            <CheckCircle2 size={16} color="#888780" />
            <Text className="font-body text-label text-niqo-gray-800 text-center">
              {annonce.type_offre === "location"
                ? "Cette annonce a été louée"
                : "Cette annonce a été vendue"}
            </Text>
          </View>
        ) : annonce.statut === "expiree" ? (
          /* Buyer mode — annonce expirée (D2 audit) : pas de contact, info
             explicite plutôt que tap → erreur muette serveur. */
          <View className="flex-row items-center justify-center gap-2 bg-niqo-gray-50 border border-niqo-gray-200 rounded-btn min-h-[48px] px-4">
            <CalendarX size={16} color="#888780" />
            <Text className="font-body text-label text-niqo-gray-800 text-center">
              Cette annonce a expiré
            </Text>
          </View>
        ) : annonce.statut === "suspendue" ? (
          /* Buyer mode — annonce retirée par modération (D2 audit). */
          <View className="flex-row items-center justify-center gap-2 bg-niqo-gray-50 border border-niqo-gray-200 rounded-btn min-h-[48px] px-4">
            <ShieldOff size={16} color="#888780" />
            <Text className="font-body text-label text-niqo-gray-800 text-center">
              Cette annonce a été retirée
            </Text>
          </View>
        ) : (
          /* Buyer mode — active ou en_cours : contact possible */
          <View className="flex-row gap-3">
            <Pressable
              onPress={onContact}
              disabled={contacting}
              accessibilityRole="button"
              accessibilityLabel="Contacter le vendeur"
              className={`flex-1 flex-row items-center justify-center bg-niqo-black rounded-btn min-h-[48px] ${contacting ? "opacity-50" : "active:opacity-80"}`}
            >
              {contacting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="font-body text-label text-niqo-white">
                  Contacter le vendeur
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
