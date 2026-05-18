import { Check, X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

import {
  MOTIFS_RDV,
  submitRdvReport,
  type MotifSignalementRdv,
} from "@/lib/signalements";

interface Props {
  visible: boolean;
  conversationId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const DESCRIPTION_MAX = 1000;

export function RdvReportSheet({
  visible,
  conversationId,
  onClose,
  onSubmitted,
}: Props) {
  const insets = useSafeAreaInsets();
  const [motif, setMotif] = useState<MotifSignalementRdv | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedOption = motif ? MOTIFS_RDV.find((o) => o.value === motif) : null;
  const descriptionRequired = selectedOption?.requiresDescription ?? false;
  const trimmedDescription = description.trim();
  const canSubmit =
    !!motif &&
    !submitting &&
    (!descriptionRequired || trimmedDescription.length > 0);

  function reset() {
    setMotif(null);
    setDescription("");
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!motif || submitting) return;
    if (descriptionRequired && trimmedDescription.length === 0) {
      Alert.alert("Description requise", "Décris la situation pour ce motif.");
      return;
    }
    setSubmitting(true);
    const r = await submitRdvReport(
      conversationId,
      motif,
      trimmedDescription.length > 0 ? trimmedDescription : undefined
    );
    setSubmitting(false);
    if (!r.success) {
      Alert.alert("Erreur", r.error ?? "Impossible d'envoyer le signalement.");
      return;
    }
    Alert.alert(
      "Signalement envoyé",
      "Notre équipe l'examinera sous 48h. Merci pour ta vigilance."
    );
    reset();
    onSubmitted();
    onClose();
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
            <Text
              className="font-display text-h3 text-niqo-black flex-1"
              numberOfLines={1}
            >
              Signaler ce RDV
            </Text>
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
            {/* Sous-titre */}
            <View className="px-4 pt-4">
              <Text className="font-body text-body text-niqo-gray-800 leading-snug">
                Choisis le motif qui décrit le mieux ce qui s&apos;est passé. Notre
                équipe modération examinera ton signalement sous 48h.
              </Text>
            </View>

            {/* Motifs */}
            <View className="px-4 pt-4">
              {MOTIFS_RDV.map((option) => {
                const selected = motif === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setMotif(option.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    className={`flex-row items-start rounded-xl border px-3 py-3 mb-2 active:opacity-70 ${
                      selected
                        ? "bg-niqo-coral-light border-niqo-coral"
                        : "bg-niqo-white border-niqo-gray-200"
                    }`}
                  >
                    <View
                      className={`w-5 h-5 rounded-full border items-center justify-center mt-0.5 mr-3 ${
                        selected
                          ? "bg-niqo-coral border-niqo-coral"
                          : "bg-niqo-white border-niqo-gray-200"
                      }`}
                    >
                      {selected && <Check size={12} color="#FFFFFF" />}
                    </View>
                    <View className="flex-1">
                      <Text
                        className={`font-display text-label ${
                          selected ? "text-niqo-coral" : "text-niqo-black"
                        }`}
                      >
                        {option.label}
                      </Text>
                      <Text className="font-body text-micro text-niqo-gray-800 mt-0.5">
                        {option.description}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Description */}
            <View className="px-4 pt-3">
              <View className="flex-row items-baseline justify-between mb-2">
                <Text className="font-body text-label text-niqo-gray-800">
                  Description{" "}
                  <Text className="text-niqo-gray-500">
                    {descriptionRequired ? "(requise)" : "(optionnelle)"}
                  </Text>
                </Text>
                <Text className="font-body text-micro text-niqo-gray-500">
                  {description.length}/{DESCRIPTION_MAX}
                </Text>
              </View>
              <View className="bg-niqo-gray-50 border border-niqo-gray-150 rounded-xl px-3 py-2.5">
                <TextInput
                  value={description}
                  onChangeText={(t) => setDescription(t.slice(0, DESCRIPTION_MAX))}
                  placeholder="Donne-nous des détails (lieu, comportement, contexte)…"
                  placeholderTextColor="#A8A89F"
                  className="font-body text-body text-niqo-black"
                  multiline
                  maxLength={DESCRIPTION_MAX}
                  style={{ minHeight: 80 }}
                />
              </View>
            </View>
          </ScrollView>

          {/* CTAs */}
          <View className="flex-row gap-3 px-4 pt-4">
            <Pressable
              onPress={handleClose}
              disabled={submitting}
              className="flex-1 h-12 items-center justify-center border border-niqo-gray-200 rounded-xl active:opacity-60"
            >
              <Text className="font-display text-label text-niqo-black">
                Annuler
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              className={`flex-1 h-12 flex-row items-center justify-center rounded-xl ${
                canSubmit ? "bg-niqo-coral active:opacity-80" : "bg-niqo-gray-200"
              }`}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="font-display text-label text-niqo-white">
                  Envoyer
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
