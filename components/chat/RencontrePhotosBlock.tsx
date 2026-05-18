import { Image } from "expo-image";
import { Camera, ImageOff, Plus, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  captureAndUploadRencontrePhoto,
  fetchMyRencontrePhotos,
  getRencontrePhotoSignedUrl,
  RENCONTRE_PHOTOS_MAX,
  type RencontrePhoto,
} from "@/lib/rencontre";

interface Props {
  conversationId: string;
  /** Si true (= admin a tranché un signalement post-RDV sur cette conv, mig 96/102),
   *  masque le bouton "+ Ajouter" et affiche un message de verrouillage.
   *  Defense in depth : la RPC backend reject aussi avec `signalement_decided`. */
  locked?: boolean;
}

export function RencontrePhotosBlock({ conversationId, locked = false }: Props) {
  const [photos, setPhotos] = useState<RencontrePhoto[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Fetch initial + après upload
  const refresh = useCallback(async () => {
    try {
      const list = await fetchMyRencontrePhotos(conversationId);
      setPhotos(list);
      // Resolve signed URLs en parallèle
      const urls = await Promise.all(
        list.map(async (p) => ({
          path: p.storage_path,
          url: await getRencontrePhotoSignedUrl(p.storage_path),
        }))
      );
      setSignedUrls(
        Object.fromEntries(urls.filter((u) => u.url !== null).map((u) => [u.path, u.url!]))
      );
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCapture = useCallback(async () => {
    if (uploading) return;
    setUploading(true);
    const r = await captureAndUploadRencontrePhoto(conversationId);
    setUploading(false);

    if ("canceled" in r) return; // user a annulé, silencieux
    if (!r.success) {
      Alert.alert("Photo non ajoutée", r.error);
      return;
    }
    void refresh();
  }, [conversationId, refresh, uploading]);

  if (loading) {
    return (
      <View className="mt-3 px-3 py-2 bg-niqo-white rounded-btn">
        <ActivityIndicator size="small" color="#888780" />
      </View>
    );
  }

  const canAdd = !locked && photos.length < RENCONTRE_PHOTOS_MAX;

  return (
    <>
      <View className="mt-3 bg-niqo-white rounded-btn px-3 py-3 border border-niqo-gray-150">
        <View className="flex-row items-center mb-2">
          <Camera size={14} color="#444441" />
          <Text className="ml-1.5 font-display text-micro text-niqo-gray-800">
            PREUVES PHOTO ({photos.length}/{RENCONTRE_PHOTOS_MAX})
          </Text>
        </View>

        {photos.length === 0 ? (
          <Text className="font-body text-micro text-niqo-gray-800 leading-snug mb-2">
            Capture une photo (produit, contexte) en preuve. Visible uniquement
            par toi et l&apos;équipe modération si tu signales.
          </Text>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
          className="-mx-1 px-1"
        >
          {photos.map((p) => {
            const url = signedUrls[p.storage_path];
            return (
              <Pressable
                key={p.id}
                onPress={() => url && setPreviewUrl(url)}
                accessibilityRole="button"
                accessibilityLabel="Voir la photo"
                disabled={!url}
                className="active:opacity-70"
              >
                {url ? (
                  <Image
                    source={{ uri: url }}
                    style={{ width: 64, height: 64, borderRadius: 8 }}
                    contentFit="cover"
                    transition={120}
                  />
                ) : (
                  <View
                    style={{ width: 64, height: 64 }}
                    className="bg-niqo-gray-100 rounded-lg items-center justify-center"
                  >
                    <ImageOff size={20} color="#888780" />
                  </View>
                )}
              </Pressable>
            );
          })}

          {canAdd ? (
            <Pressable
              onPress={handleCapture}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Ajouter une photo"
              className={`items-center justify-center border border-dashed rounded-lg ${
                uploading
                  ? "bg-niqo-gray-100 border-niqo-gray-200"
                  : "bg-niqo-coral-light border-niqo-coral active:opacity-70"
              }`}
              style={{ width: 64, height: 64 }}
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#D85A30" />
              ) : (
                <Plus size={22} color="#D85A30" />
              )}
            </Pressable>
          ) : null}
        </ScrollView>

        {locked ? (
          <Text className="font-body text-micro text-niqo-gray-500 mt-2">
            RDV examiné par notre équipe — plus de nouvelles preuves possibles.
          </Text>
        ) : !canAdd ? (
          <Text className="font-body text-micro text-niqo-gray-500 mt-2">
            Limite de {RENCONTRE_PHOTOS_MAX} photos atteinte pour cette conversation.
          </Text>
        ) : null}
      </View>

      {/* Lightbox preview */}
      <PhotoLightbox
        url={previewUrl}
        onClose={() => setPreviewUrl(null)}
      />
    </>
  );
}

// ── Lightbox plein écran ────────────────────────────────────────────────────

function PhotoLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={url !== null}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Fermer la photo"
        className="flex-1 bg-black items-center justify-center"
      >
        {url ? (
          <Image
            source={{ uri: url }}
            style={{ width: "100%", height: "80%" }}
            contentFit="contain"
          />
        ) : null}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          style={{ top: insets.top + 12, right: 12 }}
          className="absolute w-11 h-11 rounded-full bg-black/60 items-center justify-center active:opacity-70"
        >
          <X size={22} color="#FFFFFF" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
