import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
  fetchCategories,
  getCategoryIcon,
  type Category,
} from "@/lib/categories";

interface Props {
  categorie_id: string | null;
  onChange: (patch: { categorie_id: string }) => void;
}

export function Step2Category({ categorie_id, onChange }: Props) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const cats = await fetchCategories();
        setCategories(cats);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
      }
    })();
  }, []);

  return (
    <View>
      {categories === null && !loadError && (
        <View className="py-8 items-center">
          <ActivityIndicator color="#D85A30" />
        </View>
      )}

      {loadError && (
        <View className="bg-niqo-status-en-litige-bg border border-niqo-danger rounded-card px-4 py-3 mb-4">
          <Text className="font-body text-caption text-niqo-status-en-litige-text mb-2">
            {loadError}
          </Text>
          <Pressable
            onPress={() => {
              setLoadError(null);
              void (async () => {
                try {
                  const cats = await fetchCategories();
                  setCategories(cats);
                } catch (err) {
                  setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
                }
              })();
            }}
            accessibilityRole="button"
            accessibilityLabel="Réessayer de charger les catégories"
            className="bg-niqo-coral rounded-btn px-4 min-h-[36px] items-center justify-center self-start active:opacity-80"
          >
            <Text className="font-body text-micro text-niqo-white">
              Réessayer
            </Text>
          </Pressable>
        </View>
      )}

      {categories !== null && (
        <View className="flex-row flex-wrap -mx-1">
          {categories.map((cat) => {
            const Icon = getCategoryIcon(cat.icone);
            const selected = cat.id === categorie_id;
            return (
              <View key={cat.id} className="w-1/2 px-1 mb-2">
                <Pressable
                  onPress={() => onChange({ categorie_id: cat.id })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={cat.nom}
                  className={`rounded-card px-3 py-4 border-2 active:opacity-80 ${
                    selected
                      ? "bg-niqo-coral-light border-niqo-coral"
                      : "bg-niqo-gray-50 border-transparent"
                  }`}
                  style={{ minHeight: 88 }}
                >
                  <Icon
                    size={24}
                    color={selected ? "#D85A30" : "#1A1A1A"}
                    strokeWidth={1.75}
                  />
                  <Text
                    className={`mt-2 font-body text-caption ${
                      selected ? "text-niqo-coral" : "text-niqo-black"
                    }`}
                    numberOfLines={2}
                  >
                    {cat.nom}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
