import { useEffect } from "react";
import { router } from "expo-router";
import { Modal, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Mail, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppleLogo, GoogleLogo } from "@/components/ui/BrandIcons";
import {
  useAuth,
  type AuthGateReason,
  type OAuthProvider,
} from "@/lib/auth/AuthProvider";
import { LEGAL_ROUTES } from "@/lib/legal";

interface GateCopy {
  title: string;
  subtitle: string;
}

const GATE_COPY: Record<AuthGateReason, GateCopy> = {
  sell: {
    title: "Pour vendre, crée ton compte",
    subtitle: "C'est gratuit et ça prend 30 secondes.",
  },
  messages: {
    title: "Discute avec les vendeurs",
    subtitle: "Crée ton compte pour envoyer un message.",
  },
  profile: {
    title: "Ton espace personnel",
    subtitle: "Crée ton compte pour gérer tes annonces et tes achats.",
  },
  favorite: {
    title: "Sauvegarde tes coups de cœur",
    subtitle: "Crée ton compte pour retrouver tes annonces favorites.",
  },
  contact: {
    title: "Pour contacter le vendeur, crée ton compte",
    subtitle: "C'est gratuit et ça prend 30 secondes.",
  },
};

export function AuthGate() {
  const { gateReason, closeGate, signIn, authError, clearAuthError } =
    useAuth();
  const insets = useSafeAreaInsets();

  const backdropOpacity = useSharedValue(0);
  const animatedScrimStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const visible = gateReason !== null;

  useEffect(() => {
    backdropOpacity.value = visible
      ? withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) })
      : 0;
  }, [visible, backdropOpacity]);

  const copy = gateReason ? GATE_COPY[gateReason] : null;

  const handleOAuthSignIn = (provider: Exclude<OAuthProvider, "email">) => {
    void signIn(provider);
  };

  const handleEmailPress = () => {
    // Close gate FIRST — on Android the modal is sibling to the route stack,
    // pushing while it's open puts the new route behind the modal.
    const reason = gateReason;
    closeGate();
    router.push({
      pathname: "/auth/email",
      params: { mode: "signup", reason: reason ?? "" },
    });
  };

  // Same trick : ferme le gate avant de naviguer vers la page légale, sinon
  // la modale reste au-dessus et la page CGU/Confidentialité est invisible.
  const openLegal = (route: (typeof LEGAL_ROUTES)[keyof typeof LEGAL_ROUTES]) => {
    closeGate();
    router.push(route);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={closeGate}
    >
      <Pressable
        onPress={closeGate}
        accessibilityRole="button"
        accessibilityLabel="Fermer le panneau d'inscription"
        className="flex-1 justify-end"
      >
        <Animated.View
          pointerEvents="none"
          className="absolute inset-0 bg-niqo-black/60"
          style={animatedScrimStyle}
        />
        <Pressable
          onPress={() => {}}
          className="bg-niqo-white rounded-t-card pt-3 px-4"
          style={{ paddingBottom: insets.bottom + 24 }}
        >
          <View className="self-center w-10 h-1 rounded-full bg-niqo-gray-150 mb-4" />

          <Pressable
            onPress={closeGate}
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            hitSlop={8}
            className="absolute top-3 right-3 w-9 h-9 rounded-full items-center justify-center active:opacity-60"
          >
            <X size={20} color="#444441" />
          </Pressable>

          <Text className="font-display text-h2 text-niqo-black">
            {copy?.title}
          </Text>
          <Text className="mt-2 font-body text-body text-niqo-gray-800">
            {copy?.subtitle}
          </Text>

          {authError && (
            <View className="mt-4 flex-row items-start gap-2 bg-niqo-coral-light rounded-card px-3 py-2">
              <Text className="flex-1 font-body text-caption text-niqo-coral-dark">
                {authError}
              </Text>
              <Pressable
                onPress={clearAuthError}
                accessibilityRole="button"
                accessibilityLabel="Effacer l'erreur"
                hitSlop={8}
                className="active:opacity-60"
              >
                <X size={16} color="#993C1D" />
              </Pressable>
            </View>
          )}

          <View className="mt-6 gap-3">
            <Pressable
              onPress={() => handleOAuthSignIn("google")}
              accessibilityRole="button"
              accessibilityLabel="Continuer avec Google"
              className="flex-row items-center justify-center gap-3 bg-niqo-white border border-niqo-gray-200 rounded-btn min-h-[48px] px-4 active:opacity-60"
            >
              <GoogleLogo size={20} />
              <Text className="font-body text-label text-niqo-black">
                Continuer avec Google
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleOAuthSignIn("apple")}
              accessibilityRole="button"
              accessibilityLabel="Continuer avec Apple"
              className="flex-row items-center justify-center gap-3 bg-niqo-black rounded-btn min-h-[48px] px-4 active:opacity-80"
            >
              <AppleLogo size={20} />
              <Text className="font-body text-label text-niqo-white">
                Continuer avec Apple
              </Text>
            </Pressable>

            <Pressable
              onPress={handleEmailPress}
              accessibilityRole="button"
              accessibilityLabel="Continuer avec un email"
              className="flex-row items-center justify-center gap-3 bg-niqo-coral rounded-btn min-h-[48px] px-4 active:opacity-80"
            >
              <Mail size={20} color="#FFFFFF" />
              <Text className="font-body text-label text-niqo-white">
                Continuer avec un email
              </Text>
            </Pressable>
          </View>

          <Text className="mt-4 font-body text-micro text-niqo-gray-500 text-center">
            En continuant, tu acceptes les{" "}
            <Text
              onPress={() => openLegal(LEGAL_ROUTES.terms)}
              accessibilityRole="link"
              accessibilityLabel="Lire les conditions d'utilisation"
              className="underline text-niqo-gray-800"
            >
              conditions d&apos;utilisation
            </Text>
            {" "}et la{" "}
            <Text
              onPress={() => openLegal(LEGAL_ROUTES.privacy)}
              accessibilityRole="link"
              accessibilityLabel="Lire la politique de confidentialité"
              className="underline text-niqo-gray-800"
            >
              politique de confidentialité
            </Text>
            .
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
