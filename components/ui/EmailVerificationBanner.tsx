import NetInfo from "@react-native-community/netinfo";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useAuth } from "@/lib/auth/AuthProvider";
import { authErrorToFr } from "@/lib/auth/errors";
import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

export function EmailVerificationBanner() {
  const { session, isAuthenticated } = useAuth();
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const emailUnverified =
    isAuthenticated && session?.user?.email_confirmed_at == null;

  if (!emailUnverified) return null;

  function startCountdown() {
    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function resend() {
    if (countdown > 0 || !session?.user?.email) return;
    setError(null);
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      setError("Pas de connexion internet.");
      return;
    }
    try {
      const { error: resendError } = await withTimeout(
        supabase.auth.resend({ type: "signup", email: session.user.email }),
        AUTH_TIMEOUT_MS,
        "resend"
      );
      if (resendError) {
        setError(authErrorToFr(resendError));
      }
    } catch (e) {
      setError(authErrorToFr(e));
    } finally {
      startCountdown();
    }
  }

  return (
    <View className="mx-4 mt-3 bg-niqo-status-escrow-bg border border-niqo-info rounded-card px-4 py-3">
      <Text className="font-body text-caption text-niqo-status-escrow-text">
        Confirme ton adresse email pour accéder à toutes les fonctionnalités.
        {error ? `\n${error}` : ""}
      </Text>
      <Pressable
        onPress={resend}
        disabled={countdown > 0}
        accessibilityRole="button"
        accessibilityLabel={
          countdown > 0
            ? `Renvoyer l'email dans ${countdown} secondes`
            : "Renvoyer l'email de confirmation"
        }
        hitSlop={8}
        className="mt-2 self-start active:opacity-60"
      >
        <Text
          className={`font-body text-caption underline ${
            countdown > 0 ? "text-niqo-gray-500" : "text-niqo-coral"
          }`}
        >
          {countdown > 0 ? `Renvoyer dans ${countdown}s` : "Renvoyer l'email"}
        </Text>
      </Pressable>
    </View>
  );
}
