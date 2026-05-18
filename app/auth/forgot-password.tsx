import * as Linking from "expo-linking";
import { Stack, router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authErrorToFr } from "@/lib/auth/errors";
import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

const RESEND_COOLDOWN_S = 60;

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown === 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // A3 audit : validation email regex sérieuse (cohérence avec /profile/edit
  // E2 + email.tsx). Avant : `length > 3` acceptait "a@bc". Le serveur Supabase
  // valide en autorité (RFC), on bloque juste les saisies évidemment cassées.
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = isEmailValid && !submitting && cooldown === 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: resetError } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: Linking.createURL("/auth/reset-password"),
        }),
        AUTH_TIMEOUT_MS,
        "resetPasswordForEmail"
      );
      if (resetError) {
        setError(authErrorToFr(resetError));
        return;
      }
      // Anti-enumeration : même message si email inconnu ou existant.
      setInfo(
        "Si un compte existe pour cet email, tu vas recevoir un lien pour réinitialiser ton mot de passe."
      );
      setCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      setError(authErrorToFr(e));
    } finally {
      setSubmitting(false);
    }
  }

  const ctaLabel =
    cooldown > 0
      ? `Réessayer dans ${cooldown}s`
      : info
        ? "Renvoyer le lien"
        : "Envoyer le lien";

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="px-4 h-14 flex-row items-center border-b border-niqo-gray-150">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="ml-2 font-display text-h3 text-niqo-black">
          Mot de passe oublié
        </Text>
      </View>

      <View className="items-center pt-6 pb-2">
        <View className="flex-row">
          <Text
            className="font-display text-h2 text-niqo-black"
            allowFontScaling={false}
          >
            niqo
          </Text>
          <Text
            className="font-display text-h2 text-niqo-coral"
            allowFontScaling={false}
          >
            .
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 32,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text className="font-display text-h2 text-niqo-black">
            Mot de passe oublié ?
          </Text>
          <Text className="mt-1 mb-6 font-body text-body text-niqo-gray-500">
            Entre ton email, on t&apos;envoie un lien pour le réinitialiser.
          </Text>

          {error && (
            <View className="mb-4 bg-niqo-status-en-litige-bg border border-niqo-danger rounded-card px-4 py-3">
              <Text className="font-body text-caption text-niqo-status-en-litige-text">
                {error}
              </Text>
            </View>
          )}

          {info && (
            <View className="mb-4 bg-niqo-status-escrow-bg border border-niqo-info rounded-card px-4 py-3">
              <Text className="font-body text-caption text-niqo-status-escrow-text">
                {info}
              </Text>
            </View>
          )}

          <Text className="font-body text-caption text-niqo-gray-800 mb-1">
            Email
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="ton@email.com"
            placeholderTextColor="#888780"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-6 font-body text-body text-niqo-black"
          />

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ disabled: !canSubmit }}
            className={`flex-row items-center justify-center bg-niqo-coral rounded-btn min-h-[48px] px-4 ${
              !canSubmit ? "opacity-50" : "active:opacity-80"
            }`}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text className="font-body text-label text-niqo-white">
                {ctaLabel}
              </Text>
            )}
          </Pressable>

          <View className="flex-row items-center justify-center mt-6">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="link"
              className="min-h-[44px] justify-center active:opacity-60"
            >
              <Text className="font-body text-caption text-niqo-coral underline">
                Revenir à la connexion
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
