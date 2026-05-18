import { Check, CircleDot, RotateCcw, SlidersHorizontal, Sparkles, ThumbsUp, Wrench } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";

import type { EtatObjet } from "@/lib/annonces";

interface Props {
  prixMin: string;
  prixMax: string;
  etat: EtatObjet | null;
  onPrixMinChange: (v: string) => void;
  onPrixMaxChange: (v: string) => void;
  onEtatChange: (v: EtatObjet | null) => void;
}

const ETATS: { value: EtatObjet; label: string; color: string; icon: typeof Sparkles }[] = [
  { value: "neuf", label: "Neuf", color: "#1D9E75", icon: Sparkles },
  { value: "tres_bon", label: "Très bon", color: "#185FA5", icon: ThumbsUp },
  { value: "bon", label: "Bon", color: "#BA7517", icon: CircleDot },
  { value: "moyen", label: "Moyen", color: "#E24B4A", icon: Wrench },
];

function formatPriceShort(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function AnnoncesFiltersModal({ prixMin, prixMax, etat, onPrixMinChange, onPrixMaxChange, onEtatChange }: Props) {
  const [showModal, setShowModal] = useState(false);

  // Draft state local
  const [draftPrixMin, setDraftPrixMin] = useState(prixMin);
  const [draftPrixMax, setDraftPrixMax] = useState(prixMax);
  const [draftEtat, setDraftEtat] = useState(etat);

  const advancedCount =
    (prixMin !== "" ? 1 : 0) +
    (prixMax !== "" ? 1 : 0) +
    (etat !== null ? 1 : 0);

  const openModal = () => {
    setDraftPrixMin(prixMin);
    setDraftPrixMax(prixMax);
    setDraftEtat(etat);
    setShowModal(true);
  };

  const applyFilters = () => {
    onPrixMinChange(draftPrixMin);
    onPrixMaxChange(draftPrixMax);
    onEtatChange(draftEtat);
    setShowModal(false);
  };

  const resetFilters = () => {
    setDraftPrixMin("");
    setDraftPrixMax("");
    setDraftEtat(null);
  };

  return (
    <>
      {/* Bouton inline */}
      <Pressable
        onPress={openModal}
        accessibilityRole="button"
        accessibilityLabel={`Filtres${advancedCount > 0 ? `, ${advancedCount} actifs` : ""}`}
        className={`flex-row items-center gap-1.5 rounded-full px-3 min-h-[36px] ${
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

      {/* Modal flottante */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, justifyContent: "center", paddingHorizontal: 20 }}
        >
          <Pressable
            onPress={() => setShowModal(false)}
            accessibilityLabel="Fermer"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            className="bg-black/50"
          />
          <View
            onStartShouldSetResponder={() => true}
            className="bg-niqo-white rounded-card"
            style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 }}
          >
            {/* Header */}
            <View className="flex-row items-center justify-between mb-5">
              <Text className="font-display text-h3 text-niqo-black">
                Filtres
              </Text>
              {advancedCount > 0 && (
                <Pressable
                  onPress={resetFilters}
                  accessibilityRole="button"
                  accessibilityLabel="Réinitialiser"
                  className="flex-row items-center gap-1.5 active:opacity-60"
                >
                  <RotateCcw size={14} color="#888780" />
                  <Text className="font-body text-micro text-niqo-gray-500">Réinitialiser</Text>
                </Pressable>
              )}
            </View>

            {/* État */}
            <Text className="font-body text-caption text-niqo-gray-800 mb-2">
              État de l'article
            </Text>
            <View className="flex-row gap-2 mb-5">
              <Pressable
                onPress={() => setDraftEtat(null)}
                className={`rounded-btn min-h-[44px] px-3 items-center justify-center ${
                  draftEtat === null ? "bg-niqo-black" : "bg-niqo-gray-50"
                }`}
              >
                <Text className={`font-body text-micro ${draftEtat === null ? "text-niqo-white" : "text-niqo-black"}`}>
                  Tout
                </Text>
              </Pressable>
              {ETATS.map((e) => {
                const selected = draftEtat === e.value;
                const Icon = e.icon;
                return (
                  <Pressable
                    key={e.value}
                    onPress={() => setDraftEtat(selected ? null : e.value)}
                    className={`flex-1 flex-row items-center justify-center gap-1 rounded-btn min-h-[44px] ${
                      selected ? "bg-niqo-coral-light border border-niqo-coral" : "bg-niqo-gray-50"
                    }`}
                  >
                    <Icon size={12} color={selected ? e.color : "#888780"} />
                    <Text className={`font-body text-2xs ${selected ? "text-niqo-coral" : "text-niqo-gray-800"}`}>
                      {e.label}
                    </Text>
                  </Pressable>
                );
              })}
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

            {/* Appliquer */}
            <Pressable
              onPress={applyFilters}
              accessibilityRole="button"
              accessibilityLabel="Appliquer les filtres"
              className="bg-niqo-black rounded-btn min-h-[48px] items-center justify-center active:opacity-80"
            >
              <Text className="font-body text-label text-niqo-white">
                Appliquer
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
