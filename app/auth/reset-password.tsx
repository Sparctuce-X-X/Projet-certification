import { Stack, router, useLocalSearchParams } from "expo-router";
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
import {
  getPasswordStrength,
  PASSWORD_STRENGTH_CONFIG,
} from "@/lib/auth/password";
import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

/**
 * Atterrissage du deep link envoyé par l'email "Reset password".
 *
 * Flow :
 *   1. Mount avec ?code=xxx → exchange contre une recovery session
 *   2. Form 2 inputs (nouveau mdp + confirm)
 *   3. updateUser({ password }) → redirect /home (la session reste valide)
 *
 * Si user atterrit ici sans code (ex : déjà signé in via un autre flow),
 * on accepte la session existante. Si pas de code ET pas de session →
 * écran d'erreur avec CTA pour redemander un lien.
 */
export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string }>();

  const [exchanging, setExchanging] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [exchangeError, setExchangeError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Si user déjà signé in (cas où AuthProvider a déjà exchange via /auth/callback),
      // on accepte la session existante.
      const { data: existing } = await supabase.auth.getSession();
      if (cancelled) return;
      if (existing.session) {
        setHasSession(true);
        setExchanging(false);
        return;
      }

      if (!params.code) {
        setExchangeError("Lien invalide ou expiré.");
        setExchanging(false);
        return;
      }

      try {
        const { error: ex } = await withTimeout(
          supabase.auth.exchangeCodeForSession(params.code),
          AUTH_TIMEOUT_MS,
          "exchangeCodeForSession"
        );
        if (cancelled) return;
        if (ex) {
          setExchangeError("Lien invalide ou expiré. Demande un nouveau lien.");
          setExchanging(false);
          return;
        }
        setHasSession(true);
        setExchanging(false);
      } catch (e) {
        if (cancelled) return;
        setExchangeError(authErrorToFr(e));
        setExchanging(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.code]);

  const passwordsMatch = password === confirmPassword;
  const canSubmit =
    password.length >= 6 &&
    passwordsMatch &&
    hasSession &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error: updateError } = await withTimeout(
        supabase.auth.updateUser({ password }),
        AUTH_TIMEOUT_MS,
        "updateUser"
      );
      if (updateError) {
        setError(authErrorToFr(updateError));
        return;
      }
      router.replace("/home");
    } catch (e) {
      setError(authErrorToFr(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
      <Stack.Screen options={{ headerShown: false }} />

      <View className="px-4 h-14 flex-row items-center border-b border-niqo-gray-150">
        <Pressable
          onPress={() => router.replace("/home")}
          accessibilityRole="button"
          accessibilityLabel="Annuler"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="ml-2 font-display text-h3 text-niqo-black">
          Nouveau mot de passe
        </Text>
      </View>

      {exchanging ? (
        <View className="flex-1 items-center justify-center px-4">
          <ActivityIndicator size="large" color="#D85A30" />
          <Text className="mt-4 font-body text-body text-niqo-gray-800">
            Vérification du lien…
          </Text>
        </View>
      ) : exchangeError ? (
        <View className="flex-1 items-center justify-center px-4">
          <Text className="font-display text-h3 text-niqo-black text-center">
            Oups
          </Text>
          <Text className="mt-2 font-body text-body text-niqo-gray-800 text-center">
            {exchangeError}
          </Text>
          <Pressable
            onPress={() => router.replace("/auth/forgot-password")}
            accessibilityRole="button"
            accessibilityLabel="Demander un nouveau lien"
            className="mt-6 bg-niqo-coral rounded-btn min-h-[48px] px-6 items-center justify-center active:opacity-80"
          >
            <Text className="font-body text-label text-niqo-white">
              Demander un nouveau lien
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
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
                Choisis un nouveau mot de passe
              </Text>
              <Text className="mt-1 mb-6 font-body text-body text-niqo-gray-500">
                6 caractères minimum.
              </Text>

              {error && (
                <View className="mb-4 bg-niqo-status-en-litige-bg border border-niqo-danger rounded-card px-4 py-3">
                  <Text className="font-body text-caption text-niqo-status-en-litige-text">
                    {error}
                  </Text>
                </View>
              )}

              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Nouveau mot de passe
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="6 caractères minimum"
                placeholderTextColor="#888780"
                secureTextEntry
                textContentType="newPassword"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                className={`bg-niqo-gray-50 rounded-card px-4 h-12 font-body text-body text-niqo-black ${password.length === 0 ? "mb-4" : ""}`}
              />

              {/* A7 audit : strength indicator cohérent avec signup email.tsx —
                  l'user qui reset son password doit avoir le même niveau de
                  guidance qu'à l'inscription. */}
              {password.length > 0 && (() => {
                const strength = getPasswordStrength(password);
                const cfg = PASSWORD_STRENGTH_CONFIG[strength];
                return (
                  <View className="mt-2 mb-4">
                    <View className="flex-row items-center gap-2">
                      <View className="flex-row flex-1 gap-1.5">
                        {[1, 2, 3].map((bar) => (
                          <View
                            key={bar}
                            className={`flex-1 h-1 rounded-full ${
                              bar <= cfg.bars ? cfg.color : "bg-niqo-gray-200"
                            }`}
                          />
                        ))}
                      </View>
                      <Text
                        className={`font-body text-micro ${cfg.text}`}
                        accessibilityLabel={`Force du mot de passe : ${cfg.label}`}
                      >
                        {cfg.label}
                      </Text>
                    </View>
                    {cfg.hint ? (
                      <Text className="font-body text-micro text-niqo-gray-500 mt-1">
                        {cfg.hint}
                      </Text>
                    ) : null}
                  </View>
                );
              })()}

              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Confirme le mot de passe
              </Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Re-saisis le même mot de passe"
                placeholderTextColor="#888780"
                secureTextEntry
                textContentType="newPassword"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-2 font-body text-body text-niqo-black"
              />
              {confirmPassword.length > 0 && !passwordsMatch ? (
                <Text className="mb-6 font-body text-micro text-niqo-danger">
                  Les mots de passe ne correspondent pas.
                </Text>
              ) : (
                <View className="mb-6" />
              )}

              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel="Mettre à jour mon mot de passe"
                accessibilityState={{ disabled: !canSubmit }}
                className={`flex-row items-center justify-center bg-niqo-coral rounded-btn min-h-[48px] px-4 ${
                  !canSubmit ? "opacity-50" : "active:opacity-80"
                }`}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="font-body text-label text-niqo-white">
                    Mettre à jour
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </>
      )}
    </View>
  );
}
