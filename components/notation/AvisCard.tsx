import { Image } from "expo-image";
import { User } from "lucide-react-native";
import { Text, View } from "react-native";

import { StarRating } from "@/components/notation/StarRating";
import type { AvisWithAuteur } from "@/lib/notation";

interface Props {
  avis: AvisWithAuteur;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} j`;
  if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem`;
  if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
  return d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
}

export function AvisCard({ avis }: Props) {
  const roleLabel = avis.role_auteur === "acheteur" ? "a acheté" : "a vendu";

  return (
    <View className="bg-niqo-white rounded-2xl border border-niqo-gray-150 p-4">
      {/* Header : avatar + prenom + role + date */}
      <View className="flex-row items-center mb-2">
        {avis.auteur_avatar_url ? (
          <Image
            source={{ uri: avis.auteur_avatar_url }}
            style={{ width: 32, height: 32, borderRadius: 16 }}
            contentFit="cover"
          />
        ) : (
          <View className="w-8 h-8 rounded-full bg-niqo-gray-200 items-center justify-center">
            <User size={16} color="#888780" />
          </View>
        )}
        <View className="ml-2.5 flex-1">
          <Text
            className="font-display text-label text-niqo-black"
            numberOfLines={1}
          >
            {avis.auteur_prenom}
          </Text>
          <Text
            className="font-body text-micro text-niqo-gray-500"
            numberOfLines={1}
          >
            {roleLabel} · {formatRelative(avis.created_at)}
          </Text>
        </View>
        <StarRating value={avis.note} size={14} gap={2} />
      </View>

      {/* Commentaire */}
      {avis.commentaire ? (
        <Text className="font-body text-body text-niqo-gray-800 mt-1">
          {avis.commentaire}
        </Text>
      ) : (
        <Text className="font-body text-micro text-niqo-gray-500 italic mt-1">
          Sans commentaire
        </Text>
      )}
    </View>
  );
}
