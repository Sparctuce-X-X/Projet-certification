import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChevronDown, ChevronUp, Phone, ShieldCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

interface Props {
  convId: string;
  /** Mode immo (annonce immobilière) → tips et titre adaptés (visites, anti-arnaque immo).
   *  Voir mig 100 + memory project_immo_no_rdv pour la règle "pas de RDV en mode Immo". */
  isImmo?: boolean;
}

const TIPS_DEFAULT: string[] = [
  "Rencontrez-vous dans un lieu public et fréquenté (centre commercial, terrasse, station-service).",
  "Inspectez bien l'article avant de payer (état, fonctionnement, accessoires).",
  "Le paiement se fait uniquement sur place, après avoir vu l'article. Niqo ne touche jamais à ton argent.",
  "Ne paie jamais par virement à distance avant la rencontre. C'est le signe n°1 d'une arnaque.",
  "Méfie-toi des prix anormalement bas, des excuses pour ne pas se rencontrer, ou des demandes de paiement en avance.",
];

const TIPS_IMMO: string[] = [
  "Visite TOUJOURS le bien en personne avant tout paiement. Méfie-toi des annonces qui refusent la visite.",
  "Demande une pièce d'identité du propriétaire ou de l'agent immobilier, et compare avec le titre de propriété ou le bail si disponible.",
  "Ne verse JAMAIS de caution, d'avance ou de frais de dossier avant d'avoir visité physiquement le logement.",
  "Méfie-toi des prix anormalement bas pour le quartier — c'est le signe n°1 d'arnaque immobilière.",
  "Préfère les paiements traçables (Mobile Money vers un compte vérifié, virement bancaire) plutôt que cash anonyme. Garde une preuve de chaque versement.",
];

const URGENCY: Record<"CI" | "CG", { label: string; number: string }[]> = {
  CI: [
    { label: "Police", number: "110" },
    { label: "Gendarmerie", number: "185" },
  ],
  CG: [{ label: "Urgences", number: "117" }],
};

const dismissKey = (convId: string) => `niqo_chat_safety_dismissed_${convId}`;

export function ChatSafetyTips({ convId, isImmo = false }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [pays, setPays] = useState<"CI" | "CG" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      AsyncStorage.getItem(dismissKey(convId)),
      AsyncStorage.getItem("niqo_country"),
    ]).then(([d, p]) => {
      if (cancelled) return;
      setDismissed(d === "1");
      setPays(p === "CI" || p === "CG" ? p : null);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [convId]);

  const handleDismiss = async () => {
    setDismissed(true);
    await AsyncStorage.setItem(dismissKey(convId), "1");
  };

  if (!hydrated || dismissed) return null;

  const numbers = pays ? URGENCY[pays] : [];
  const tips = isImmo ? TIPS_IMMO : TIPS_DEFAULT;
  const title = isImmo
    ? "Conseils anti-arnaque immobilière"
    : "Conseils de sécurité pour le RDV";
  const a11yLabelExpand = isImmo
    ? "Voir les conseils anti-arnaque immobilière"
    : "Voir les conseils de sécurité";
  const a11yLabelCollapse = isImmo
    ? "Replier les conseils anti-arnaque immobilière"
    : "Replier les conseils de sécurité";

  return (
    <View className="bg-niqo-coral-light border-b border-niqo-coral/20">
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? a11yLabelCollapse : a11yLabelExpand}
        className="flex-row items-center px-4 py-3 active:opacity-70"
      >
        <ShieldCheck size={16} color="#D85A30" />
        <Text className="ml-2 flex-1 font-display text-label text-niqo-coral">
          {title}
        </Text>
        {expanded ? (
          <ChevronUp size={16} color="#D85A30" />
        ) : (
          <ChevronDown size={16} color="#D85A30" />
        )}
      </Pressable>

      {expanded && (
        <View className="px-4 pb-4">
          {tips.map((tip, i) => (
            <View key={i} className="flex-row mb-2">
              <Text className="font-display text-label text-niqo-coral mr-2">
                {i + 1}.
              </Text>
              <Text className="flex-1 font-body text-body text-niqo-black leading-snug">
                {tip}
              </Text>
            </View>
          ))}

          {numbers.length > 0 && (
            <View className="mt-3 pt-3 border-t border-niqo-coral/20">
              <Text className="font-display text-micro text-niqo-gray-800 mb-2">
                NUMÉROS D'URGENCE
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {numbers.map(({ label, number }) => (
                  <Pressable
                    key={number}
                    onPress={() => void Linking.openURL(`tel:${number}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Appeler ${label} au ${number}`}
                    className="flex-row items-center bg-niqo-white border border-niqo-gray-200 rounded-btn px-3 h-10 active:opacity-70"
                  >
                    <Phone size={14} color="#1A1A1A" />
                    <Text className="ml-1.5 font-body text-label text-niqo-black">
                      {label} <Text className="font-mono">{number}</Text>
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <Pressable
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="J'ai lu, ne plus afficher"
            className="self-start mt-4 h-10 px-4 items-center justify-center bg-niqo-coral rounded-btn active:opacity-80"
          >
            <Text className="font-display text-label text-niqo-white">
              J'ai lu, ne plus afficher
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
