import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { authErrorToFr } from "@/lib/auth/errors";
import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

/**
 * OAuth / email-confirmation deep link handler.
 *
 * In the COMMON case (foreground OAuth via WebBrowser.openAuthSessionAsync),
 * the AuthProvider parses the redirect URL inline and never mounts this
 * screen. This screen handles two edge cases :
 *   1. Cold-start : user clicks an email confirmation link while the app is
 *      closed → OS opens the app at this route.
 *   2. Background : user backgrounds the app mid-OAuth → the deep link fires
 *      and Expo Router mounts this screen.
 */
export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (params.error) {
      setErrorMsg(authErrorToFr({ message: params.error_description }));
      return;
    }
    if (!params.code) {
      setErrorMsg("Lien d'authentification invalide.");
      return;
    }

    let cancelled = false;
    const code = params.code;

    void (async () => {
      // Guard against double-exchange : if AuthProvider's signIn already
      // exchanged this code (foreground OAuth via WebBrowser), a session
      // exists and a 2nd exchangeCodeForSession would fail with "code
      // already used". Just navigate home.
      // A6 audit : wrap dans withTimeout — sans, si Supabase lag (réseau
      // CI/CG instable), l'écran freeze indéfiniment sur le spinner sans
      // fallback erreur.
      try {
        const { data: existing } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT_MS,
          "callback.getSession"
        );
        if (cancelled) return;
        if (existing.session) {
          router.replace("/home");
          return;
        }
      } catch (e) {
        if (!cancelled) setErrorMsg(authErrorToFr(e));
        return;
      }

      try {
        const { error } = await withTimeout(
          supabase.auth.exchangeCodeForSession(code),
          AUTH_TIMEOUT_MS,
          "exchangeCodeForSession"
        );
        if (cancelled) return;
        if (error) {
          setErrorMsg(authErrorToFr(error));
          return;
        }
        router.replace("/home");
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(authErrorToFr(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.code, params.error, params.error_description]);

  return (
    <View className="flex-1 bg-niqo-white items-center justify-center px-4">
      <Stack.Screen options={{ headerShown: false }} />

      {errorMsg ? (
        <>
          <Text className="font-display text-h3 text-niqo-black text-center">
            Oups
          </Text>
          <Text className="mt-2 font-body text-body text-niqo-gray-800 text-center">
            {errorMsg}
          </Text>
          <Pressable
            onPress={() => router.replace("/")}
            accessibilityRole="button"
            accessibilityLabel="Réessayer"
            className="mt-6 bg-niqo-coral rounded-btn min-h-[48px] px-6 items-center justify-center active:opacity-80"
          >
            <Text className="font-body text-label text-niqo-white">
              Réessayer
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color="#D85A30" />
          <Text className="mt-4 font-body text-body text-niqo-gray-800">
            Connexion en cours…
          </Text>
        </>
      )}
    </View>
  );
}
