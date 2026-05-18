import { Image } from "expo-image";
import { Check, User } from "lucide-react-native";
import { View } from "react-native";

import { isTrustedSeller } from "@/lib/users";

interface TrustedAvatarProps {
  avatarUrl: string | null;
  prenom: string;
  /** Nombre de ventes — pour le badge confiance (cf. TRUSTED_SELLER_THRESHOLDS) */
  nbVentes: number;
  /** Note vendeur — pour le badge confiance (cf. TRUSTED_SELLER_THRESHOLDS) */
  noteVendeur: number;
  /** Taille de l'avatar en pixels. Default 48. */
  size?: number;
}

/**
 * Avatar avec anneau vert + badge check si vendeur fiable.
 * Réutilisable dans : liste conversations, chat header, profil vendeur.
 */
export function TrustedAvatar({
  avatarUrl,
  prenom,
  nbVentes,
  noteVendeur,
  size = 48,
}: TrustedAvatarProps) {
  const trusted = isTrustedSeller(nbVentes, noteVendeur);
  const ringSize = trusted ? size + 8 : size;
  const badgeSize = size >= 64 ? 22 : 16;
  const initialsSize = size >= 64 ? 28 : size >= 48 ? 18 : 14;

  return (
    <View style={{ width: ringSize, height: ringSize }} className="relative">
      {/* Anneau vert si trusted */}
      <View
        style={{
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: trusted ? 2.5 : 0,
          borderColor: "#1D9E75",
          padding: trusted ? 2 : 0,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View
            style={{ width: size, height: size, borderRadius: size / 2 }}
            className="bg-niqo-gray-200 items-center justify-center"
          >
            <User size={initialsSize} color="#888780" />
          </View>
        )}
      </View>

      {/* Badge check — cercle vert avec ✓ blanc */}
      {trusted && (
        <View
          className="absolute -bottom-0.5 -right-0.5 bg-niqo-white rounded-full"
          style={{ padding: 1.5 }}
        >
          <View
            style={{
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: "#1D9E75",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check size={badgeSize * 0.6} color="#FFFFFF" strokeWidth={3.5} />
          </View>
        </View>
      )}
    </View>
  );
}
