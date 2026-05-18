import { router } from "expo-router";
import { ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { CityPicker } from "@/components/ui/CityPicker";
import type { Pays } from "@/lib/annonces";
import { LEGAL_ROUTES } from "@/lib/legal";
import { CITIES_BY_COUNTRY } from "@/lib/locations";

interface Props {
  prix: string;
  ville: string;
  quartier: string;
  country: Pays;
  onChange: (patch: { prix?: string; ville?: string; quartier?: string }) => void;
  isFirstPost: boolean;
  cguAccepted: boolean;
  onCguChange: (accepted: boolean) => void;
}

const CURRENCY_BY_COUNTRY: Record<Pays, string> = {
  CI: "FCFA",
  CG: "XAF",
};

/** Cap client à 12 chiffres = numeric(12,0) DB. Au-delà, le DB rejetterait
 *  avec un overflow numerique pas user-friendly. On bloque la saisie ici. */
const PRICE_MAX_DIGITS = 12;

function formatPrice(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, PRICE_MAX_DIGITS);
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function Step5Price({ prix, ville, quartier, country, onChange, isFirstPost, cguAccepted, onCguChange }: Props) {
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const currency = CURRENCY_BY_COUNTRY[country];

  return (
    <View>
      {/* ── Prix ──────────────────────────────────────────────────────── */}
      <Text className="font-body text-caption text-niqo-gray-800 mb-1">
        Prix
      </Text>
      <View className="flex-row items-center bg-niqo-gray-50 rounded-card mb-1 border border-transparent">
        <TextInput
          value={prix}
          onChangeText={(t) => onChange({ prix: formatPrice(t) })}
          placeholder="0"
          placeholderTextColor="#888780"
          keyboardType="number-pad"
          returnKeyType="done"
          accessibilityLabel="Prix de l'article"
          className="flex-1 px-4 h-12 font-mono text-h3 text-niqo-black"
        />
        <Text className="pr-4 font-body text-label text-niqo-gray-500">
          {currency}
        </Text>
      </View>
      <Text className="mb-4 font-body text-micro text-niqo-gray-500">
        Indique ton prix en {currency}
      </Text>

      {/* ── Ville ─────────────────────────────────────────────────────── */}
      <Text className="font-body text-caption text-niqo-gray-800 mb-1">
        Ville
      </Text>
      <Pressable
        onPress={() => setCityPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={ville ? `Ville : ${ville}` : "Choisir la ville"}
        className="flex-row items-center bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 active:opacity-80"
      >
        <Text
          className={`flex-1 font-body text-body ${
            ville ? "text-niqo-black" : "text-niqo-gray-500"
          }`}
        >
          {ville || "Choisir une ville"}
        </Text>
        <ChevronDown size={18} color="#888780" />
      </Pressable>

      {/* ── Quartier (optionnel) ──────────────────────────────────────── */}
      <Text className="font-body text-caption text-niqo-gray-800 mb-1">
        Quartier <Text className="text-niqo-gray-500">(optionnel)</Text>
      </Text>
      <TextInput
        value={quartier}
        onChangeText={(t) => onChange({ quartier: t.slice(0, 50) })}
        placeholder="Ex : Cocody, Plateau, Bacongo…"
        placeholderTextColor="#888780"
        maxLength={50}
        returnKeyType="done"
        className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 font-body text-body text-niqo-black border border-transparent"
      />

      {/* ── CGU checkbox — 1er post uniquement ───────────────────────── */}
      {isFirstPost && (
        <Pressable
          onPress={() => onCguChange(!cguAccepted)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: cguAccepted }}
          accessibilityLabel="Accepter les conditions générales d'utilisation"
          className="flex-row items-start mt-4 active:opacity-80"
        >
          <View
            className={`w-5 h-5 rounded-sm border-2 mr-3 mt-0.5 items-center justify-center ${
              cguAccepted
                ? "bg-niqo-coral border-niqo-coral"
                : "bg-niqo-white border-niqo-gray-300"
            }`}
          >
            {cguAccepted && (
              <Text className="text-niqo-white font-body text-micro leading-none">
                ✓
              </Text>
            )}
          </View>
          <Text className="flex-1 font-body text-caption text-niqo-gray-800">
            J'accepte les{" "}
            <Text
              className="text-niqo-coral underline"
              onPress={() => router.push(LEGAL_ROUTES.terms)}
            >
              conditions générales
            </Text>
            {" "}et la{" "}
            <Text
              className="text-niqo-coral underline"
              onPress={() => router.push(LEGAL_ROUTES.privacy)}
            >
              politique de confidentialité
            </Text>
            . Je m'engage à ne publier que des articles autorisés.
          </Text>
        </Pressable>
      )}

      <CityPicker
        visible={cityPickerOpen}
        cities={CITIES_BY_COUNTRY[country]}
        selected={ville}
        onSelect={(c) => onChange({ ville: c })}
        onClose={() => setCityPickerOpen(false)}
      />
    </View>
  );
}
