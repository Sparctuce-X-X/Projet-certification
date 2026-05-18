import * as ImagePicker from "expo-image-picker";
import { ImagePlus, Star, X } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

import { moderateImage } from "@/lib/moderation";
import { MAX_PHOTOS_PER_ANNONCE } from "@/lib/storage/annonces-photos";

interface Props {
  photoUris: string[];
  onChange: (patch: { photoUris: string[] }) => void;
}

export function Step4Photos({ photoUris, onChange }: Props) {
  const pickingRef = useRef(false);
  const [scanning, setScanning] = useState(false);

  const canAddMore = photoUris.length < MAX_PHOTOS_PER_ANNONCE;

  // Scan chaque URI via moderate-image. Retourne uniquement les URIs qui
  // passent. Affiche un Alert FR si certaines sont rejetées. Fail-open
  // identique à lib/moderation.ts moderateImage : si l'EF / le réseau /
  // la compression échouent silencieusement, on laisse passer (le user
  // honnête en zone 3G instable ne doit pas être bloqué — la couche
  // signalements F08 rattrape les ratés).
  const filterUrisByModeration = useCallback(
    async (uris: string[]): Promise<string[]> => {
      const results = await Promise.allSettled(
        uris.map((uri) => moderateImage({ uri, surface: "annonce.create" })),
      );
      const passed: string[] = [];
      const rejected: { uri: string; hint: string }[] = [];
      results.forEach((res, idx) => {
        const uri = uris[idx];
        if (res.status === "rejected") {
          passed.push(uri); // fail-open
          return;
        }
        if (res.value.ok) {
          passed.push(uri);
        } else {
          rejected.push({
            uri,
            hint:
              res.value.hint ??
              "L'image a été rejetée par notre système de modération.",
          });
        }
      });
      if (rejected.length > 0) {
        const title =
          rejected.length === 1
            ? "Photo rejetée"
            : `${rejected.length} photos rejetées`;
        // Si plusieurs photos rejetées pour des raisons différentes, on
        // affiche le premier hint (le plus probable cas usage = une seule
        // ou toutes même raison). Le détail par photo serait surcharge UX.
        Alert.alert(title, rejected[0].hint);
      }
      return passed;
    },
    [],
  );

  const pickFromLibrary = useCallback(async () => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert(
          "Accès refusé",
          "Active l'accès à tes photos dans les réglages de l'appareil pour en ajouter."
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS_PER_ANNONCE - photoUris.length,
      });
      if (result.canceled) return;
      const newUris = result.assets.map((a) => a.uri);
      setScanning(true);
      try {
        const accepted = await filterUrisByModeration(newUris);
        if (accepted.length === 0) return;
        onChange({
          photoUris: [...photoUris, ...accepted].slice(
            0,
            MAX_PHOTOS_PER_ANNONCE,
          ),
        });
      } finally {
        setScanning(false);
      }
    } finally {
      pickingRef.current = false;
    }
  }, [photoUris, onChange, filterUrisByModeration]);

  const pickFromCamera = useCallback(async () => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert(
          "Accès refusé",
          "Active l'accès à l'appareil photo dans les réglages pour prendre une photo."
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 1,
        allowsEditing: false,
      });
      if (result.canceled) return;
      setScanning(true);
      try {
        const accepted = await filterUrisByModeration([result.assets[0].uri]);
        if (accepted.length === 0) return;
        onChange({
          photoUris: [...photoUris, accepted[0]].slice(
            0,
            MAX_PHOTOS_PER_ANNONCE,
          ),
        });
      } finally {
        setScanning(false);
      }
    } finally {
      pickingRef.current = false;
    }
  }, [photoUris, onChange, filterUrisByModeration]);

  // ActionSheetIOS sur iOS, Alert sur Android — pas de Modal RN,
  // donc pas de conflit de ViewControllers avec le picker.
  const onAddPhoto = useCallback(() => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Prendre une photo", "Choisir dans la galerie", "Annuler"],
          cancelButtonIndex: 2,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) void pickFromCamera();
          else if (buttonIndex === 1) void pickFromLibrary();
        }
      );
    } else {
      Alert.alert("Ajouter une photo", undefined, [
        { text: "Prendre une photo", onPress: () => void pickFromCamera() },
        {
          text: "Choisir dans la galerie",
          onPress: () => void pickFromLibrary(),
        },
        { text: "Annuler", style: "cancel" },
      ]);
    }
  }, [pickFromCamera, pickFromLibrary]);

  const onRemove = useCallback(
    (idx: number) => {
      onChange({ photoUris: photoUris.filter((_, i) => i !== idx) });
    },
    [photoUris, onChange]
  );

  return (
    <View>
      {/* Liste des photos */}
      <View className="gap-3 mb-4">
        {photoUris.map((uri, idx) => (
          <View
            key={`${uri}-${idx}`}
            className="bg-niqo-gray-50 rounded-card overflow-hidden"
          >
            <View className="aspect-square">
              <Image
                source={{ uri }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
              />
              {idx === 0 && (
                <View className="absolute top-2 left-2 flex-row items-center bg-niqo-coral rounded-full px-2 py-1">
                  <Star size={12} color="#FFFFFF" fill="#FFFFFF" />
                  <Text className="ml-1 font-body text-micro text-niqo-white">
                    Couverture
                  </Text>
                </View>
              )}
              <Pressable
                onPress={() => onRemove(idx)}
                accessibilityRole="button"
                accessibilityLabel={`Retirer la photo ${idx + 1}`}
                hitSlop={6}
                className="absolute top-2 right-2 w-9 h-9 rounded-full bg-niqo-black/70 items-center justify-center active:opacity-80"
              >
                <X size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {/* Bouton ajouter */}
      {canAddMore && (
        <Pressable
          onPress={onAddPhoto}
          disabled={scanning}
          accessibilityRole="button"
          accessibilityLabel="Ajouter une photo"
          accessibilityState={{ disabled: scanning }}
          className={`bg-niqo-gray-50 rounded-card border-2 border-dashed border-niqo-gray-300 py-8 items-center ${
            scanning ? "opacity-50" : "active:opacity-80"
          }`}
        >
          {scanning ? (
            <>
              <ActivityIndicator size="small" color="#888780" />
              <Text className="mt-2 font-body text-label text-niqo-gray-800">
                Analyse en cours…
              </Text>
              <Text className="mt-1 font-body text-micro text-niqo-gray-500">
                Vérification de la photo
              </Text>
            </>
          ) : (
            <>
              <ImagePlus size={28} color="#888780" strokeWidth={1.75} />
              <Text className="mt-2 font-body text-label text-niqo-gray-800">
                Ajouter une photo
              </Text>
              <Text className="mt-1 font-body text-micro text-niqo-gray-500">
                {photoUris.length}/{MAX_PHOTOS_PER_ANNONCE} — JPG, PNG ou WebP
              </Text>
            </>
          )}
        </Pressable>
      )}

      {!canAddMore && (
        <View className="bg-niqo-gray-50 rounded-card py-4 items-center">
          <Text className="font-body text-caption text-niqo-gray-500">
            Limite atteinte ({MAX_PHOTOS_PER_ANNONCE} photos max).
          </Text>
        </View>
      )}

      {photoUris.length > 0 && (
        <Text className="mt-3 font-body text-micro text-niqo-gray-500">
          La première photo est ta couverture — c'est elle qui s'affiche dans
          la liste des annonces. Pour la changer, retire-la et ajoute-la
          dans l'ordre voulu.
        </Text>
      )}
    </View>
  );
}
