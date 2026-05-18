import { Check, CircleDot, Sparkles, ThumbsUp, Wrench } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { EtatObjet } from "@/lib/annonces";

interface Props {
  etat: EtatObjet | null;
  onChange: (patch: { etat: EtatObjet }) => void;
}

const ETATS: {
  value: EtatObjet;
  label: string;
  hint: string;
  color: string;
  bgSelected: string;
  borderSelected: string;
  icon: typeof Sparkles;
}[] = [
  {
    value: "neuf",
    label: "Neuf",
    hint: "Jamais utilisé, emballage d'origine",
    color: "#1D9E75",
    bgSelected: "bg-niqo-status-complete-bg",
    borderSelected: "border-niqo-success",
    icon: Sparkles,
  },
  {
    value: "tres_bon",
    label: "Très bon",
    hint: "Quelques signes d'usage légers",
    color: "#185FA5",
    bgSelected: "bg-niqo-status-escrow-bg",
    borderSelected: "border-niqo-info",
    icon: ThumbsUp,
  },
  {
    value: "bon",
    label: "Bon",
    hint: "Fonctionnel, marques visibles",
    color: "#BA7517",
    bgSelected: "bg-niqo-status-code-envoye-bg",
    borderSelected: "border-niqo-warning",
    icon: CircleDot,
  },
  {
    value: "moyen",
    label: "Moyen",
    hint: "Réparations possibles, à savoir",
    color: "#E24B4A",
    bgSelected: "bg-niqo-status-en-litige-bg",
    borderSelected: "border-niqo-danger",
    icon: Wrench,
  },
];

export function Step3Condition({ etat, onChange }: Props) {
  return (
    <View className="gap-3">
      {ETATS.map((e) => {
        const selected = e.value === etat;
        const EtatIcon = e.icon;
        return (
          <Pressable
            key={e.value}
            onPress={() => onChange({ etat: e.value })}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${e.label}. ${e.hint}`}
            className={`rounded-card px-4 py-4 border-2 flex-row items-center active:opacity-80 ${
              selected
                ? `${e.bgSelected} ${e.borderSelected}`
                : "bg-niqo-gray-50 border-transparent"
            }`}
            style={{ minHeight: 72 }}
          >
            <View
              className={`w-12 h-12 rounded-full items-center justify-center mr-4 ${
                selected ? "" : "bg-niqo-gray-100"
              }`}
              style={selected ? { backgroundColor: e.color + "18" } : undefined}
            >
              <EtatIcon size={24} color={selected ? e.color : "#888780"} />
            </View>
            <View className="flex-1">
              <Text className="font-display text-label text-niqo-black">
                {e.label}
              </Text>
              <Text className="font-body text-caption text-niqo-gray-500 mt-1">
                {e.hint}
              </Text>
            </View>
            {selected && (
              <View
                className="w-7 h-7 rounded-full items-center justify-center ml-2"
                style={{ backgroundColor: e.color }}
              >
                <Check size={16} color="#FFFFFF" strokeWidth={3} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
