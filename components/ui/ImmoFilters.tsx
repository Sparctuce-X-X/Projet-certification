import { Building2, Home, Landmark, MapPin, RotateCcw, SlidersHorizontal, Store } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import type { TypeBien, TypeOffreImmo } from "@/lib/annonces";

interface ImmoFiltersProps {
  typeOffre: TypeOffreImmo | null;
  typeBien: TypeBien | null;
  nbPieces: number | null;
  meuble: boolean | null;
  prixMin: string;
  prixMax: string;
  surfaceMin: string;
  surfaceMax: string;
  onTypeOffreChange: (v: TypeOffreImmo | null) => void;
  onTypeBienChange: (v: TypeBien | null) => void;
  onNbPiecesChange: (v: number | null) => void;
  onMeubleChange: (v: boolean | null) => void;
  onPrixMinChange: (v: string) => void;
  onPrixMaxChange: (v: string) => void;
  onSurfaceMinChange: (v: string) => void;
  onSurfaceMaxChange: (v: string) => void;
}

const OFFRE_OPTIONS: { value: TypeOffreImmo; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "vente", label: "Vente" },
];

const BIEN_OPTIONS: { value: TypeBien; label: string; icon: typeof Building2 }[] = [
  { value: "studio", label: "Studio", icon: Home },
  { value: "chambre", label: "Chambre", icon: Home },
  { value: "appartement", label: "Appart", icon: Building2 },
  { value: "maison", label: "Maison", icon: Home },
  { value: "bureau", label: "Bureau", icon: Landmark },
  { value: "magasin", label: "Magasin", icon: Store },
  { value: "terrain", label: "Terrain", icon: MapPin },
];

const PIECES_OPTIONS = [1, 2, 3, 4, 5];

function formatPriceShort(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function ImmoFilters({
  typeOffre,
  typeBien,
  nbPieces,
  meuble,
  prixMin,
  prixMax,
  onTypeOffreChange,
  onTypeBienChange,
  onNbPiecesChange,
  onMeubleChange,
  onPrixMinChange,
  onPrixMaxChange,
  surfaceMin,
  surfaceMax,
  onSurfaceMinChange,
  onSurfaceMaxChange,
}: ImmoFiltersProps) {
  const [showMore, setShowMore] = useState(false);

  // ── State local modal (draft) — ne propage qu'au "Appliquer" ──────
  const [draftNbPieces, setDraftNbPieces] = useState(nbPieces);
  const [draftMeuble, setDraftMeuble] = useState(meuble);
  const [draftPrixMin, setDraftPrixMin] = useState(prixMin);
  const [draftPrixMax, setDraftPrixMax] = useState(prixMax);
  const [draftSurfaceMin, setDraftSurfaceMin] = useState(surfaceMin);
  const [draftSurfaceMax, setDraftSurfaceMax] = useState(surfaceMax);

  // Sync draft quand la modal s'ouvre
  const openModal = () => {
    setDraftNbPieces(nbPieces);
    setDraftMeuble(meuble);
    setDraftPrixMin(prixMin);
    setDraftPrixMax(prixMax);
    setDraftSurfaceMin(surfaceMin);
    setDraftSurfaceMax(surfaceMax);
    setShowMore(true);
  };

  const applyFilters = () => {
    onNbPiecesChange(draftNbPieces);
    onMeubleChange(draftMeuble);
    onPrixMinChange(draftPrixMin);
    onPrixMaxChange(draftPrixMax);
    onSurfaceMinChange(draftSurfaceMin);
    onSurfaceMaxChange(draftSurfaceMax);
    setShowMore(false);
  };

  // Compteur de filtres avancés actifs
  const advancedCount =
    (nbPieces !== null ? 1 : 0) +
    (meuble !== null ? 1 : 0) +
    (prixMin !== "" ? 1 : 0) +
    (prixMax !== "" ? 1 : 0) +
    (surfaceMin !== "" ? 1 : 0) +
    (surfaceMax !== "" ? 1 : 0);

  const resetAdvanced = () => {
    setDraftNbPieces(null);
    setDraftMeuble(null);
    setDraftPrixMin("");
    setDraftPrixMax("");
    setDraftSurfaceMin("");
    setDraftSurfaceMax("");
  };

  return (
    <View className="gap-2">
      {/* Location / Vente toggle */}
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => onTypeOffreChange(null)}
          accessibilityRole="tab"
          accessibilityLabel="Tout type d'offre"
          accessibilityState={{ selected: typeOffre === null }}
          className={`rounded-full px-4 min-h-[44px] justify-center ${
            typeOffre === null ? "bg-niqo-black" : "bg-niqo-gray-50"
          }`}
        >
          <Text className={`font-body text-micro ${typeOffre === null ? "text-niqo-white" : "text-niqo-gray-800"}`}>
            Tout
          </Text>
        </Pressable>
        {OFFRE_OPTIONS.map((opt) => {
          const selected = typeOffre === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onTypeOffreChange(selected ? null : opt.value)}
              accessibilityRole="tab"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected }}
              className={`rounded-full px-4 min-h-[44px] justify-center ${
                selected
                  ? opt.value === "location"
                    ? "bg-niqo-status-escrow-bg border border-niqo-info"
                    : "bg-niqo-status-complete-bg border border-niqo-success"
                  : "bg-niqo-gray-50 border border-transparent"
              }`}
            >
              <Text className={`font-body text-micro ${
                selected
                  ? opt.value === "location" ? "text-niqo-status-escrow-text" : "text-niqo-status-complete-text"
                  : "text-niqo-gray-800"
              }`}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}

        {/* Bouton filtres avancés */}
        <Pressable
          onPress={openModal}
          accessibilityRole="button"
          accessibilityLabel={`Filtres avancés${advancedCount > 0 ? `, ${advancedCount} actifs` : ""}`}
          className={`flex-row items-center gap-1.5 rounded-full px-3 min-h-[44px] justify-center ${
            advancedCount > 0
              ? "bg-niqo-coral-light border border-niqo-coral"
              : "bg-niqo-gray-50 border border-transparent"
          }`}
        >
          <SlidersHorizontal size={14} color={advancedCount > 0 ? "#D85A30" : "#888780"} />
          {advancedCount > 0 && (
            <View className="bg-niqo-coral w-5 h-5 rounded-full items-center justify-center">
              <Text className="font-mono text-2xs text-niqo-white" allowFontScaling={false}>
                {advancedCount}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Type de bien pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {BIEN_OPTIONS.map((opt) => {
          const selected = typeBien === opt.value;
          const Icon = opt.icon;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onTypeBienChange(selected ? null : opt.value)}
              accessibilityRole="tab"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected }}
              className={`flex-row items-center gap-1.5 rounded-full px-3 min-h-[44px] ${
                selected
                  ? "bg-niqo-coral-light border border-niqo-coral"
                  : "bg-niqo-gray-50 border border-transparent"
              }`}
            >
              <Icon size={14} color={selected ? "#D85A30" : "#888780"} />
              <Text className={`font-body text-micro ${selected ? "text-niqo-coral" : "text-niqo-gray-800"}`}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── Modal filtres avancés ──────────────────────────────────────── */}
      <Modal visible={showMore} transparent animationType="fade" onRequestClose={() => setShowMore(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}
        >
          {/* Backdrop */}
          <Pressable
            onPress={() => setShowMore(false)}
            accessibilityLabel="Fermer"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            className="bg-black/50"
          />
          {/* Card modale flottante */}
          <View
            onStartShouldSetResponder={() => true}
            className="bg-niqo-white rounded-card"
            style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 }}
          >
            {/* Header avec reset */}
            <View className="flex-row items-center justify-between mb-5">
              <Text className="font-display text-h3 text-niqo-black">
                Filtres avancés
              </Text>
              {advancedCount > 0 && (
                <Pressable
                  onPress={resetAdvanced}
                  accessibilityRole="button"
                  accessibilityLabel="Réinitialiser les filtres"
                  className="flex-row items-center gap-1.5 active:opacity-60"
                >
                  <RotateCcw size={14} color="#888780" />
                  <Text className="font-body text-micro text-niqo-gray-500">
                    Réinitialiser
                  </Text>
                </Pressable>
              )}
            </View>

            {/* Nombre de pièces */}
            <Text className="font-body text-caption text-niqo-gray-800 mb-2">
              Nombre de pièces
            </Text>
            <View className="flex-row gap-2 mb-5">
              <Pressable
                onPress={() => setDraftNbPieces(null)}
                accessibilityRole="tab"
                accessibilityLabel="Tout nombre de pièces"
                className={`flex-1 rounded-btn min-h-[44px] items-center justify-center ${
                  draftNbPieces === null ? "bg-niqo-black" : "bg-niqo-gray-50"
                }`}
              >
                <Text className={`font-mono text-label ${draftNbPieces === null ? "text-niqo-white" : "text-niqo-black"}`}>
                  Tout
                </Text>
              </Pressable>
              {PIECES_OPTIONS.map((n) => {
                const selected = draftNbPieces === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => setDraftNbPieces(selected ? null : n)}
                    accessibilityRole="tab"
                    accessibilityLabel={`${n} pièce${n > 1 ? "s" : ""}`}
                    className={`flex-1 rounded-btn min-h-[44px] items-center justify-center ${
                      selected ? "bg-niqo-coral" : "bg-niqo-gray-50"
                    }`}
                  >
                    <Text className={`font-mono text-label ${selected ? "text-niqo-white" : "text-niqo-black"}`}>
                      {n}{n === 5 ? "+" : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Meublé / Vide */}
            {typeOffre === "location" && (
              <>
                <Text className="font-body text-caption text-niqo-gray-800 mb-2">
                  Ameublement
                </Text>
                <View className="flex-row gap-2 mb-5">
                  {([
                    { value: null as boolean | null, label: "Tout" },
                    { value: true as boolean | null, label: "Meublé" },
                    { value: false as boolean | null, label: "Vide" },
                  ]).map((opt) => {
                    const selected = draftMeuble === opt.value;
                    return (
                      <Pressable
                        key={String(opt.value)}
                        onPress={() => setDraftMeuble(selected && opt.value !== null ? null : opt.value)}
                        accessibilityRole="tab"
                        accessibilityLabel={opt.label}
                        className={`flex-1 rounded-btn min-h-[44px] items-center justify-center ${
                          selected
                            ? opt.value === null ? "bg-niqo-black" : "bg-niqo-coral"
                            : "bg-niqo-gray-50"
                        }`}
                      >
                        <Text className={`font-body text-label ${
                          selected ? "text-niqo-white" : "text-niqo-black"
                        }`}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {/* Surface min/max */}
            <Text className="font-body text-caption text-niqo-gray-800 mb-2">
              Surface (m²)
            </Text>
            <View className="flex-row gap-3 mb-5">
              <View className="flex-1 bg-niqo-gray-50 rounded-card flex-row items-center px-3 min-h-[48px]">
                <Text className="font-body text-micro text-niqo-gray-500 mr-2">Min</Text>
                <TextInput
                  value={draftSurfaceMin}
                  onChangeText={(t) => setDraftSurfaceMin(t.replace(/\D/g, ""))}
                  placeholder="0"
                  placeholderTextColor="#888780"
                  keyboardType="number-pad"
                  accessibilityLabel="Surface minimum en m²"
                  className="flex-1 font-mono text-body text-niqo-black"
                />
                <Text className="font-body text-micro text-niqo-gray-500">m²</Text>
              </View>
              <View className="flex-1 bg-niqo-gray-50 rounded-card flex-row items-center px-3 min-h-[48px]">
                <Text className="font-body text-micro text-niqo-gray-500 mr-2">Max</Text>
                <TextInput
                  value={draftSurfaceMax}
                  onChangeText={(t) => setDraftSurfaceMax(t.replace(/\D/g, ""))}
                  placeholder="∞"
                  placeholderTextColor="#888780"
                  keyboardType="number-pad"
                  accessibilityLabel="Surface maximum en m²"
                  className="flex-1 font-mono text-body text-niqo-black"
                />
                <Text className="font-body text-micro text-niqo-gray-500">m²</Text>
              </View>
            </View>

            {/* Fourchette de prix */}
            <Text className="font-body text-caption text-niqo-gray-800 mb-2">
              Fourchette de prix (FCFA)
            </Text>
            <View className="flex-row gap-3 mb-6">
              <View className="flex-1 bg-niqo-gray-50 rounded-card flex-row items-center px-3 min-h-[48px]">
                <Text className="font-body text-micro text-niqo-gray-500 mr-2">Min</Text>
                <TextInput
                  value={draftPrixMin}
                  onChangeText={(t) => setDraftPrixMin(formatPriceShort(t))}
                  placeholder="0"
                  placeholderTextColor="#888780"
                  keyboardType="number-pad"
                  accessibilityLabel="Prix minimum"
                  className="flex-1 font-mono text-body text-niqo-black"
                />
              </View>
              <View className="flex-1 bg-niqo-gray-50 rounded-card flex-row items-center px-3 min-h-[48px]">
                <Text className="font-body text-micro text-niqo-gray-500 mr-2">Max</Text>
                <TextInput
                  value={draftPrixMax}
                  onChangeText={(t) => setDraftPrixMax(formatPriceShort(t))}
                  placeholder="∞"
                  placeholderTextColor="#888780"
                  keyboardType="number-pad"
                  accessibilityLabel="Prix maximum"
                  className="flex-1 font-mono text-body text-niqo-black"
                />
              </View>
            </View>

            {/* Bouton appliquer */}
            <Pressable
              onPress={applyFilters}
              accessibilityRole="button"
              accessibilityLabel="Appliquer les filtres"
              className="bg-niqo-black rounded-btn min-h-[48px] items-center justify-center active:opacity-80"
            >
              <Text className="font-body text-label text-niqo-white">
                Appliquer les filtres
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
