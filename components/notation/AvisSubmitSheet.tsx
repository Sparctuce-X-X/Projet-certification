import { X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StarRating } from "@/components/notation/StarRating";
import {
  notationErrorToFr,
  submitAvis,
  type AvisNote,
} from "@/lib/notation";

interface Props {
  visible: boolean;
  conversationId: string;
  /** Prénom de la personne notée — affiché dans le titre. */
  cibleName: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const COMMENT_MAX = 200;

export function AvisSubmitSheet({
  visible,
  conversationId,
  cibleName,
  onClose,
  onSubmitted,
}: Props) {
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState<0 | AvisNote>(0);
  const [commentaire, setCommentaire] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setNote(0);
    setCommentaire("");
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (note === 0 || submitting) return;
    setSubmitting(true);
    const cleaned = commentaire.trim();
    const r = await submitAvis(
      conversationId,
      note as AvisNote,
      cleaned.length > 0 ? cleaned : null
    );
    setSubmitting(false);
    if (!r.success) {
      Alert.alert("Erreur", notationErrorToFr(r.error));
      return;
    }
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
          style={{ paddingBottom: insets.bottom + 16 }}
          className="bg-niqo-white rounded-t-3xl"
        >
          {/* Header */}
          <View className="px-4 h-14 flex-row items-center justify-between border-b border-niqo-gray-150">
            <Text
              className="font-display text-h3 text-niqo-black flex-1"
              numberOfLines={1}
            >
              Note la rencontre
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

          {/* Étoiles */}
          <View className="px-4 pt-5">
            <Text className="font-body text-label text-niqo-gray-800 mb-3 text-center">
              Comment ça s&apos;est passé avec {cibleName} ?
            </Text>
            <View className="items-center">
              <StarRating
                value={note}
                onChange={(n) => setNote(n)}
                size={36}
                gap={6}
              />
            </View>
            {note > 0 && (
              <Text className="font-body text-micro text-niqo-gray-500 text-center mt-2">
                {labelForNote(note as AvisNote)}
              </Text>
            )}
          </View>

          {/* Commentaire optionnel */}
          <View className="px-4 pt-5">
            <Text className="font-body text-label text-niqo-gray-800 mb-2">
              Commentaire <Text className="text-niqo-gray-500">(optionnel)</Text>
            </Text>
            <View className="bg-niqo-gray-50 border border-niqo-gray-150 rounded-xl px-3 py-2.5">
              <TextInput
                value={commentaire}
                onChangeText={(t) => setCommentaire(t.slice(0, COMMENT_MAX))}
                placeholder="Ex : Très sympa, marchandise conforme à l'annonce."
                placeholderTextColor="#A8A89F"
                className="font-body text-body text-niqo-black"
                multiline
                maxLength={COMMENT_MAX}
                style={{ minHeight: 60 }}
              />
            </View>
            <Text className="font-body text-micro text-niqo-gray-500 mt-1 self-end">
              {commentaire.length}/{COMMENT_MAX}
            </Text>
          </View>

          {/* CTAs */}
          <View className="flex-row gap-3 px-4 pt-5">
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
              disabled={submitting || note === 0}
              className={`flex-1 h-12 flex-row items-center justify-center rounded-xl ${
                submitting || note === 0
                  ? "bg-niqo-gray-200"
                  : "bg-niqo-coral active:opacity-80"
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

function labelForNote(n: AvisNote): string {
  switch (n) {
    case 1:
      return "Très décevant";
    case 2:
      return "Décevant";
    case 3:
      return "Correct";
    case 4:
      return "Bien";
    case 5:
      return "Excellent";
  }
}
