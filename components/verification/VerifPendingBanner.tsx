import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import {
  AlertCircle,
  ChevronRight,
  Clock,
  RotateCcw,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  fetchMyLastVerification,
  VERIFICATION_SLA_HOURS,
  type MyVerificationStatus,
} from "@/lib/verification";

/**
 * Banner persistant à mettre en haut de l'écran profil (pattern repris de
 * `<EmailVerificationBanner>`).
 *
 * Affichage selon le statut de la dernière soumission :
 *   - `pending`  → bandeau coral-light "En cours de validation, 24h max"
 *   - `rejected` → bandeau rouge avec raison + bouton "Recommencer"
 *   - `verified` ou `null` → null (le badge BadgeCheck est ailleurs)
 *
 * Le tap ouvre la route `/profile/verification` :
 *   - Si pending : montre l'écran d'attente détaillé
 *   - Si rejected : ré-entre dans le wizard
 */
export function VerifPendingBanner() {
  const [status, setStatus] = useState<MyVerificationStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchMyLastVerification()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          // silent — pas critique, le banner ne s'affiche juste pas
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (!status) return null;
  if (status.statut === "verified") return null;

  if (status.statut === "pending") {
    return (
      <Pressable
        onPress={() => router.push("/profile/verification")}
        accessibilityRole="button"
        accessibilityLabel="Vérification d'identité en cours"
        className="flex-row items-center gap-3 bg-niqo-coral-light border-b border-niqo-coral/20 px-4 py-3 active:opacity-70"
      >
        <View className="w-9 h-9 rounded-full bg-niqo-coral/15 items-center justify-center">
          <Clock size={18} color="#D85A30" strokeWidth={2.2} />
        </View>
        <View className="flex-1">
          <Text className="font-display text-label text-niqo-black">
            Vérification en cours
          </Text>
          <Text className="font-body text-micro text-niqo-gray-800 mt-0.5">
            On valide ton dossier sous {VERIFICATION_SLA_HOURS}h. Tu recevras
            une notification.
          </Text>
        </View>
        <ChevronRight size={16} color="#D85A30" />
      </Pressable>
    );
  }

  // rejected
  return (
    <Pressable
      onPress={() => router.push("/profile/verification")}
      accessibilityRole="button"
      accessibilityLabel="Vérification refusée, recommencer"
      className="flex-row items-start gap-3 bg-niqo-danger/10 border-b border-niqo-danger/20 px-4 py-3 active:opacity-70"
    >
      <View className="w-9 h-9 rounded-full bg-niqo-danger/15 items-center justify-center mt-0.5">
        <AlertCircle size={18} color="#E24B4A" strokeWidth={2.2} />
      </View>
      <View className="flex-1">
        <Text className="font-display text-label text-niqo-danger">
          Vérification refusée
        </Text>
        {status.reject_reason ? (
          <Text
            className="font-body text-micro text-niqo-gray-800 mt-0.5"
            numberOfLines={2}
          >
            {status.reject_reason}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-1 mt-1.5">
          <RotateCcw size={12} color="#E24B4A" strokeWidth={2.2} />
          <Text className="font-body text-micro font-semibold text-niqo-danger">
            Recommencer
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
