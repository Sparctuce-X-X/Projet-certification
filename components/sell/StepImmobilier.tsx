import { Building2, Home, Landmark, MapPin, Store } from "lucide-react-native";
import { Pressable, Text, TextInput, View } from "react-native";

import type { TypeBien, TypeOffreImmo } from "@/lib/annonces";

interface Props {
  typeBien: TypeBien | null;
  typeOffre: TypeOffreImmo | null;
  surfaceM2: string;
  nbPieces: string;
  meuble: boolean | null;
  onChange: (patch: {
    type_bien?: TypeBien | null;
    type_offre?: TypeOffreImmo | null;
    surface_m2?: string;
    nb_pieces?: string;
    meuble?: boolean | null;
  }) => void;
}

const TYPES_BIEN: { value: TypeBien; label: string; icon: typeof Building2 }[] = [
  { value: "studio", label: "Studio", icon: Home },
  { value: "chambre", label: "Chambre", icon: Home },
  { value: "appartement", label: "Appartement", icon: Building2 },
  { value: "maison", label: "Maison", icon: Home },
  { value: "bureau", label: "Bureau", icon: Landmark },
  { value: "magasin", label: "Magasin", icon: Store },
  { value: "terrain", label: "Terrain", icon: MapPin },
];

const TYPES_OFFRE: { value: TypeOffreImmo; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "vente", label: "Vente" },
];

export function StepImmobilier({
  typeBien,
  typeOffre,
  surfaceM2,
  nbPieces,
  meuble,
  onChange,
}: Props) {
  const isTerrain = typeBien === "terrain";

  return (
    <View>
      {/* ── Type d'offre ─────────────────────────────────────────────── */}
      <Text className="font-display text-h3 text-niqo-black mb-3">
        Type d'offre
      </Text>
      <View className="flex-row gap-3 mb-6">
        {TYPES_OFFRE.map((opt) => {
          const selected = typeOffre === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange({ type_offre: opt.value })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`flex-1 rounded-card py-4 border-2 items-center active:opacity-80 ${
                selected
                  ? "bg-niqo-coral-light border-niqo-coral"
                  : "bg-niqo-gray-50 border-transparent"
              }`}
            >
              <Text
                className={`font-display text-label ${
                  selected ? "text-niqo-coral" : "text-niqo-black"
                }`}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Type de bien ─────────────────────────────────────────────── */}
      <Text className="font-display text-h3 text-niqo-black mb-3">
        Type de bien
      </Text>
      <View className="flex-row flex-wrap -mx-1 mb-6">
        {TYPES_BIEN.map((opt) => {
          const selected = typeBien === opt.value;
          const Icon = opt.icon;
          return (
            <View key={opt.value} className="w-1/3 px-1 mb-2">
              <Pressable
                onPress={() => onChange({ type_bien: opt.value })}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className={`rounded-card py-3 items-center border-2 active:opacity-80 ${
                  selected
                    ? "bg-niqo-coral-light border-niqo-coral"
                    : "bg-niqo-gray-50 border-transparent"
                }`}
                style={{ minHeight: 72 }}
              >
                <Icon
                  size={22}
                  color={selected ? "#D85A30" : "#1A1A1A"}
                  strokeWidth={1.75}
                />
                <Text
                  className={`mt-1 font-body text-micro text-center ${
                    selected ? "text-niqo-coral" : "text-niqo-black"
                  }`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* ── Surface ──────────────────────────────────────────────────── */}
      <Text className="font-body text-caption text-niqo-gray-800 mb-1">
        Surface (m²)
      </Text>
      <View className="flex-row items-center bg-niqo-gray-50 rounded-card mb-4 border border-transparent">
        <TextInput
          value={surfaceM2}
          onChangeText={(t) => onChange({ surface_m2: t.replace(/\D/g, "") })}
          placeholder="Ex : 35"
          placeholderTextColor="#888780"
          keyboardType="number-pad"
          returnKeyType="done"
          accessibilityLabel="Surface en mètres carrés"
          className="flex-1 px-4 h-12 font-body text-body text-niqo-black"
        />
        <Text className="pr-4 font-body text-label text-niqo-gray-500">m²</Text>
      </View>

      {/* ── Nombre de pièces (pas pour terrain) ──────────────────────── */}
      {!isTerrain && (
        <>
          <Text className="font-body text-caption text-niqo-gray-800 mb-2">
            Nombre de pièces
          </Text>
          <View className="flex-row gap-2 mb-6">
            {["1", "2", "3", "4", "5", "6+"].map((n) => {
              const selected = nbPieces === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => onChange({ nb_pieces: n })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  className={`flex-1 rounded-btn py-3 items-center ${
                    selected
                      ? "bg-niqo-coral"
                      : "bg-niqo-gray-50"
                  }`}
                  style={{ minHeight: 44 }}
                >
                  <Text
                    className={`font-mono text-label ${
                      selected ? "text-niqo-white" : "text-niqo-black"
                    }`}
                  >
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── Meublé / Vide (seulement pour location, pas terrain) ──── */}
      {typeOffre === "location" && !isTerrain && (
        <>
          <Text className="font-body text-caption text-niqo-gray-800 mb-2">
            Ameublement
          </Text>
          <View className="flex-row gap-3 mb-4">
            {[
              { value: true, label: "Meublé" },
              { value: false, label: "Vide" },
            ].map((opt) => {
              const selected = meuble === opt.value;
              return (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => onChange({ meuble: opt.value })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  className={`flex-1 rounded-card py-3 border-2 items-center active:opacity-80 ${
                    selected
                      ? "bg-niqo-coral-light border-niqo-coral"
                      : "bg-niqo-gray-50 border-transparent"
                  }`}
                >
                  <Text
                    className={`font-body text-label ${
                      selected ? "text-niqo-coral" : "text-niqo-black"
                    }`}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}
