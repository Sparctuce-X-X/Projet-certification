import { ShieldOff, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { blockUser } from "@/lib/blocking";

interface Props {
  visible: boolean;
  targetUserId: string;
  targetPrenom: string;
  onClose: () => void;
  /** Callback after successful block. Use to refresh list or pop screen. */
  onBlocked?: () => void;
}

const REASON_MAX = 500;

export function BlockUserSheet({
  visible,
  targetUserId,
  targetPrenom,
  onClose,
  onBlocked,
}: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset state quand le sheet se ferme/rouvre — sinon le reason d'un précédent
  // block reste affiché si on rouvre le sheet sur un autre user.
  useEffect(() => {
    if (!visible) {
      setReason("");
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [visible]);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const trimmed = reason.trim();
      const result = await blockUser(
        targetUserId,
        trimmed.length > 0 ? trimmed : undefined
      );
      if (result.success) {
        onBlocked?.();
        onClose();
      } else {
        setErrorMsg(result.error ?? "Échec du blocage. Réessaie.");
      }
    } catch {
      setErrorMsg("Vérifie ta connexion et réessaie.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <Pressable
          accessibilityLabel="Fermer"
          onPress={handleClose}
          className="absolute inset-0"
        />

        <View
          style={{ paddingBottom: insets.bottom + 16, maxHeight: "90%" }}
          className="bg-niqo-white rounded-t-3xl"
        >
          {/* Header */}
          <View className="px-4 h-14 flex-row items-center justify-between border-b border-niqo-gray-150">
            <View className="flex-row items-center flex-1">
              <ShieldOff size={20} color="#E24B4A" />
              <Text
                className="ml-2 font-display text-h3 text-niqo-black flex-1"
                numberOfLines={1}
              >
                Bloquer {targetPrenom} ?
              </Text>
            </View>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              className="min-h-[44px] min-w-[44px] items-center justify-center -mr-2 active:opacity-60"
            >
              <X size={22} color="#1A1A1A" />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {/* Explication précise — Apple Review va vérifier que l'utilisateur
                comprend les effets du block avant de confirmer. */}
            <View className="px-4 pt-4">
              <Text className="font-body text-body text-niqo-gray-800 leading-snug">
                Si tu confirmes :
              </Text>
              <View className="mt-2 gap-1.5">
                <Text className="font-body text-body text-niqo-gray-800 leading-snug">
                  • Ses annonces disparaissent de ton fil instantanément
                </Text>
                <Text className="font-body text-body text-niqo-gray-800 leading-snug">
                  • Cette personne ne pourra plus t'envoyer de message
                </Text>
                <Text className="font-body text-body text-niqo-gray-800 leading-snug">
                  • Notre équipe modération sera informée
                </Text>
              </View>
              <Text className="font-body text-caption text-niqo-gray-500 mt-3 leading-snug">
                Tu peux annuler ce blocage à tout moment depuis ton profil → Utilisateurs bloqués.
              </Text>
            </View>

            {/* Motif facultatif */}
            <View className="px-4 pt-5">
              <View className="flex-row items-baseline justify-between mb-2">
                <Text className="font-body text-label text-niqo-gray-800">
                  Motif{" "}
                  <Text className="text-niqo-gray-500">(facultatif)</Text>
                </Text>
                <Text className="font-mono text-micro text-niqo-gray-500">
                  {reason.length}/{REASON_MAX}
                </Text>
              </View>
              <View className="bg-niqo-gray-50 border border-niqo-gray-150 rounded-xl px-3 py-2.5">
                <TextInput
                  value={reason}
                  onChangeText={(t) => setReason(t.slice(0, REASON_MAX))}
                  placeholder="Pourquoi bloques-tu cette personne ?"
                  placeholderTextColor="#A8A89F"
                  className="font-body text-body text-niqo-black"
                  multiline
                  maxLength={REASON_MAX}
                  style={{ minHeight: 88, textAlignVertical: "top" }}
                  accessibilityLabel="Motif du blocage, facultatif"
                />
              </View>
              <Text className="font-body text-micro text-niqo-gray-500 mt-1.5">
                Ce motif aide notre équipe modération à examiner ce profil.
              </Text>
            </View>

            {/* Erreur inline */}
            {errorMsg && (
              <View
                className="mx-4 mt-4 bg-niqo-status-en-litige-bg border border-niqo-danger/30 rounded-xl px-3 py-2.5"
                accessibilityLiveRegion="polite"
              >
                <Text className="font-body text-caption text-niqo-status-en-litige-text">
                  {errorMsg}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* CTAs */}
          <View className="flex-row gap-3 px-4 pt-4">
            <Pressable
              onPress={handleClose}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Annuler"
              className="flex-1 h-12 items-center justify-center border border-niqo-gray-200 rounded-xl active:opacity-60"
            >
              <Text className="font-display text-label text-niqo-black">
                Annuler
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={`Confirmer le blocage de ${targetPrenom}`}
              accessibilityState={{ disabled: submitting }}
              className={`flex-1 h-12 flex-row items-center justify-center rounded-xl ${
                submitting ? "bg-niqo-coral/60" : "bg-niqo-coral active:opacity-80"
              }`}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="font-display text-label text-niqo-white">
                  Bloquer
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
