import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { CalendarDays, Clock, MapPin, X } from "lucide-react-native";
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

import { proposeRdv, rdvErrorToFr } from "@/lib/rdv";

interface Props {
  visible: boolean;
  conversationId: string;
  /** Pré-rempli si l'utilisateur re-propose après modification */
  initialLieu?: string;
  initialDate?: Date;
  onClose: () => void;
  onProposed: () => void;
}

const LIEU_MAX = 100;

function defaultDate(): Date {
  // Demain à 14h00, par défaut
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(14, 0, 0, 0);
  return d;
}

function formatDateFr(d: Date): string {
  return d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimeFr(d: Date): string {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function RdvProposeSheet({
  visible,
  conversationId,
  initialLieu,
  initialDate,
  onClose,
  onProposed,
}: Props) {
  const insets = useSafeAreaInsets();
  const [lieu, setLieu] = useState(initialLieu ?? "");
  const [date, setDate] = useState<Date>(initialDate ?? defaultDate());
  const [submitting, setSubmitting] = useState(false);

  const minDate = new Date(Date.now() + 31 * 60 * 1000); // now + 31 min
  const maxDate = new Date(Date.now() + 90 * 24 * 3600 * 1000); // now + 90j

  // ── Picker Android : appel impératif (un par mode) ──────────────────────
  function openAndroidPicker(mode: "date" | "time") {
    DateTimePickerAndroid.open({
      value: date,
      mode,
      minimumDate: mode === "date" ? minDate : undefined,
      maximumDate: mode === "date" ? maxDate : undefined,
      onChange: (_, picked) => {
        if (!picked) return;
        setDate((current) => {
          const next = new Date(current);
          if (mode === "date") {
            next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
          } else {
            next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
          }
          return next;
        });
      },
    });
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    const trimmedLieu = lieu.trim();
    if (!trimmedLieu) {
      Alert.alert("Lieu manquant", "Indique un lieu pour le RDV.");
      return;
    }
    if (date.getTime() < Date.now() + 30 * 60 * 1000) {
      Alert.alert(
        "Date trop proche",
        "Le RDV doit être au moins 30 minutes après maintenant."
      );
      return;
    }

    setSubmitting(true);
    const result = await proposeRdv(conversationId, trimmedLieu, date);
    setSubmitting(false);

    if (!result.success) {
      Alert.alert("Erreur", rdvErrorToFr(result.error));
      return;
    }

    onProposed();
    onClose();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <Pressable
          accessibilityLabel="Fermer"
          onPress={onClose}
          className="absolute inset-0"
        />

        <View
          style={{ paddingBottom: insets.bottom + 16 }}
          className="bg-niqo-white rounded-t-3xl"
        >
          {/* Header */}
          <View className="px-4 h-14 flex-row items-center justify-between border-b border-niqo-gray-150">
            <Text className="font-display text-h3 text-niqo-black">
              Proposer un RDV
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              className="min-h-[44px] min-w-[44px] items-center justify-center -mr-2 active:opacity-60"
            >
              <X size={22} color="#1A1A1A" />
            </Pressable>
          </View>

          {/* Date + Heure */}
          <View className="px-4 pt-5">
            <Text className="font-body text-label text-niqo-gray-800 mb-2">
              Date et heure
            </Text>

            {Platform.OS === "ios" ? (
              <View className="flex-row items-center justify-between bg-niqo-gray-50 border border-niqo-gray-150 rounded-xl px-3 py-3">
                <View className="flex-row items-center">
                  <CalendarDays size={18} color="#888780" />
                  <View className="ml-2">
                    <DateTimePicker
                      value={date}
                      mode="date"
                      display="compact"
                      themeVariant="light"
                      locale="fr-FR"
                      minimumDate={minDate}
                      maximumDate={maxDate}
                      accentColor="#D85A30"
                      onChange={(_, picked) => {
                        if (!picked) return;
                        setDate((current) => {
                          const next = new Date(current);
                          next.setFullYear(
                            picked.getFullYear(),
                            picked.getMonth(),
                            picked.getDate()
                          );
                          return next;
                        });
                      }}
                    />
                  </View>
                </View>
                <View className="flex-row items-center">
                  <Clock size={18} color="#888780" />
                  <View className="ml-1">
                    <DateTimePicker
                      value={date}
                      mode="time"
                      display="compact"
                      themeVariant="light"
                      locale="fr-FR"
                      accentColor="#D85A30"
                      onChange={(_, picked) => {
                        if (!picked) return;
                        setDate((current) => {
                          const next = new Date(current);
                          next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
                          return next;
                        });
                      }}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <View className="flex-row gap-3">
                <Pressable
                  onPress={() => openAndroidPicker("date")}
                  className="flex-1 flex-row items-center bg-niqo-gray-50 border border-niqo-gray-150 rounded-xl px-3 py-3 active:opacity-70"
                >
                  <CalendarDays size={18} color="#888780" />
                  <Text className="font-body text-body text-niqo-black ml-2 flex-1">
                    {formatDateFr(date)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => openAndroidPicker("time")}
                  className="w-24 flex-row items-center justify-center bg-niqo-gray-50 border border-niqo-gray-150 rounded-xl px-3 py-3 active:opacity-70"
                >
                  <Text className="font-mono text-body text-niqo-black">
                    {formatTimeFr(date)}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Lieu */}
          <View className="px-4 pt-5">
            <Text className="font-body text-label text-niqo-gray-800 mb-2">
              Lieu
            </Text>
            <View className="flex-row items-start bg-niqo-gray-50 border border-niqo-gray-150 rounded-xl px-3 py-2.5">
              <MapPin size={18} color="#888780" style={{ marginTop: 2 }} />
              <TextInput
                value={lieu}
                onChangeText={(t) => setLieu(t.slice(0, LIEU_MAX))}
                placeholder="Ex : Marché de Cocody, devant la pharmacie"
                placeholderTextColor="#A8A89F"
                className="flex-1 font-body text-body text-niqo-black ml-2"
                multiline
                maxLength={LIEU_MAX}
                autoCorrect
              />
            </View>
            <Text className="font-body text-micro text-niqo-gray-500 mt-1 self-end">
              {lieu.length}/{LIEU_MAX}
            </Text>
          </View>

          {/* CTAs */}
          <View className="flex-row gap-3 px-4 pt-5">
            <Pressable
              onPress={onClose}
              disabled={submitting}
              className="flex-1 h-12 items-center justify-center border border-niqo-gray-200 rounded-xl active:opacity-60"
            >
              <Text className="font-display text-label text-niqo-black">
                Annuler
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={submitting || lieu.trim().length === 0}
              className={`flex-1 h-12 flex-row items-center justify-center rounded-xl ${
                submitting || lieu.trim().length === 0
                  ? "bg-niqo-gray-200"
                  : "bg-niqo-coral active:opacity-80"
              }`}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="font-display text-label text-niqo-white">
                  Proposer
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
