import { Check } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { LEGAL_ROUTES, LEGAL_VERSIONS } from "@/lib/legal";

interface CgvConsentCheckboxProps {
  checked: boolean;
  onToggle: () => void;
  /** Pour accessibility — ex: "Cocher la renonciation au droit de rétractation pour ce boost" */
  accessibilityHint?: string;
}

/**
 * Case obligatoire avant tout paiement Niqo (boost / KYC / etc).
 * Conforme Code Conso CI (Loi 2016-410 art. L221-28 équivalent OHADA) :
 * sur un service numérique qui commence immédiatement après paiement, l'user
 * doit RENONCER EXPRESSÉMENT à son droit de rétractation 14j.
 *
 * Comportement :
 *   - Pré-décochée par défaut (jamais pré-cochée — exigence CNIL & Conso)
 *   - Tap → bascule coché/décoché
 *   - Lien "Lire les CGV" ouvre /legal/cgv (LEGAL_ROUTES.cgv)
 *   - Version persistée côté DB via paiements_niqo.cgv_accepted_version
 */
export function CgvConsentCheckbox({ checked, onToggle, accessibilityHint }: CgvConsentCheckboxProps) {
  return (
    <View className="flex-row gap-3 items-start mt-4">
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityHint={accessibilityHint}
        hitSlop={8}
        className={`h-6 w-6 rounded border-2 items-center justify-center mt-0.5 ${
          checked
            ? "bg-niqo-coral border-niqo-coral"
            : "bg-niqo-white border-niqo-gray-300"
        }`}
      >
        {checked && <Check size={16} color="#FFFFFF" strokeWidth={3} />}
      </Pressable>
      <Pressable onPress={onToggle} className="flex-1">
        <Text className="font-body text-caption text-niqo-gray-800 leading-relaxed">
          Je reconnais que ce service numérique commence immédiatement après le
          paiement et j&apos;accepte expressément de renoncer à mon droit de
          rétractation de 14 jours.
        </Text>
        <Text
          onPress={(e) => {
            e.stopPropagation?.();
            router.push(LEGAL_ROUTES.cgv);
          }}
          className="font-body text-caption text-niqo-coral underline mt-1"
        >
          Lire les CGV v{LEGAL_VERSIONS.cgv.version}
        </Text>
      </Pressable>
    </View>
  );
}
