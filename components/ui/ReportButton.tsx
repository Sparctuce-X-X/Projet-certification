import { Flag } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Alert, Pressable } from "react-native";

import { useAuth } from "@/lib/auth/AuthProvider";
import {
  MOTIFS_PAR_CIBLE,
  submitReport,
  type CibleSignalement,
} from "@/lib/signalements";

interface ReportButtonProps {
  /** Type de la cible à signaler */
  targetType: CibleSignalement;
  /** UUID de la cible */
  targetId: string;
  /** Taille de l'icône. Default 20. */
  size?: number;
  /** Couleur de l'icône. Default gray. */
  color?: string;
}

/**
 * Bouton signaler réutilisable — affiche un Alert avec les motifs
 * prédéfinis selon le type de cible, puis soumet via la RPC.
 *
 * Usage :
 *   <ReportButton targetType="utilisateur" targetId={userId} />
 *   <ReportButton targetType="annonce" targetId={annonceId} />
 *   <ReportButton targetType="message" targetId={messageId} />
 */
export function ReportButton({
  targetType,
  targetId,
  size = 20,
  color = "#888780",
}: ReportButtonProps) {
  const { requireAuth } = useAuth();
  const [reporting, setReporting] = useState(false);

  const onPress = useCallback(() => {
    if (!requireAuth("contact")) return;

    const motifs = MOTIFS_PAR_CIBLE[targetType];

    Alert.alert(
      "Signaler",
      "Pourquoi veux-tu signaler ?",
      [
        ...motifs.map((motif) => ({
          text: motif,
          onPress: () => void doReport(motif),
        })),
        { text: "Annuler", style: "cancel" as const },
      ]
    );
  }, [requireAuth, targetType]);

  const doReport = async (motif: string) => {
    if (reporting) return;
    setReporting(true);
    try {
      const result = await submitReport(targetType, targetId, motif);
      if (result.success) {
        Alert.alert(
          "Merci",
          "Ton signalement a été envoyé. Notre équipe va l'examiner sous 24h."
        );
      } else {
        Alert.alert("Impossible", result.error ?? "Réessaie plus tard.");
      }
    } catch {
      Alert.alert("Erreur", "Vérifie ta connexion et réessaie.");
    } finally {
      setReporting(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={reporting}
      accessibilityRole="button"
      accessibilityLabel="Signaler"
      className={`min-h-[44px] min-w-[44px] items-center justify-center ${
        reporting ? "opacity-50" : "active:opacity-60"
      }`}
    >
      <Flag size={size} color={color} />
    </Pressable>
  );
}
