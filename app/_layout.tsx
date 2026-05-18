// react-native-url-polyfill MUST be the very first import — Supabase v2 needs
// URL/blob globals that Hermes (RN runtime) doesn't ship.
import "react-native-url-polyfill/auto";
// Sentry — init AVANT les autres imports pour capturer les crashes early.
// No-op en dev (__DEV__) ou si EXPO_PUBLIC_SENTRY_DSN absent.
import { Sentry } from "@/lib/sentry";
import "../global.css";

import {
  SpaceGrotesk_500Medium,
  useFonts as useSpaceGroteskFonts,
} from "@expo-google-fonts/space-grotesk";
import {
  Inter_400Regular,
  Inter_600SemiBold,
  useFonts as useInterFonts,
} from "@expo-google-fonts/inter";
import {
  JetBrainsMono_500Medium,
  useFonts as useJetBrainsMonoFonts,
} from "@expo-google-fonts/jetbrains-mono";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthGate } from "@/components/ui/AuthGate";
import { ProfileCompletionGate } from "@/components/ui/ProfileCompletionGate";
import { PushNotificationGate } from "@/components/ui/PushNotificationGate";
import { AuthProvider } from "@/lib/auth/AuthProvider";

// Hold the native splash on-screen while fonts are loading.
// Must be called before any rendering.
SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [spaceGroteskLoaded] = useSpaceGroteskFonts({ SpaceGrotesk_500Medium });
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_600SemiBold });
  const [jetBrainsMonoLoaded] = useJetBrainsMonoFonts({
    JetBrainsMono_500Medium,
  });

  const fontsLoaded =
    spaceGroteskLoaded && interLoaded && jetBrainsMonoLoaded;

  useEffect(() => {
    if (fontsLoaded) {
      // Dismiss the native splash — our animated SplashScreen (app/index.tsx)
      // takes over immediately after this.
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Render nothing until all fonts are ready — avoids FOUT on first frame.
  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <AuthGate />
            <ProfileCompletionGate />
            <PushNotificationGate />
          </AuthProvider>
          <StatusBar style="light" />
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap = ErrorBoundary natif (capture render errors React) + breadcrumbs
// de navigation. No-op si Sentry est désactivé (en dev), donc pas de coût en
// développement local.
export default Sentry.wrap(RootLayout);
