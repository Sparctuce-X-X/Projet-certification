import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Linking from "expo-linking";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Check, ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CityPicker } from "@/components/ui/CityPicker";
import { WizardProgress } from "@/components/ui/WizardProgress";
import { useAuth } from "@/lib/auth/AuthProvider";
import { AUTH_ERRORS_FR, authErrorToFr } from "@/lib/auth/errors";
import {
  getPasswordStrength,
  PASSWORD_STRENGTH_CONFIG,
} from "@/lib/auth/password";
import { LEGAL_LAST_UPDATED, LEGAL_ROUTES } from "@/lib/legal";
import { CITIES_BY_COUNTRY } from "@/lib/locations";
import { PHONE_CONFIG, normalizePhone, type Country } from "@/lib/phone";
import { AUTH_TIMEOUT_MS, supabase, withTimeout } from "@/lib/supabase";

type Mode = "signin" | "signup";
type Step = 1 | 2 | 3;

interface StepCopy {
  title: string;
  subtitle: string;
}

const SIGNUP_STEP_COPY: Record<Step, StepCopy> = {
  1: {
    title: "Tes identifiants",
    subtitle: "On commence par le nécessaire.",
  },
  2: {
    title: "Toi",
    subtitle: "Pour t'identifier sur tes annonces.",
  },
  3: {
    title: "Mobile Money",
    subtitle: "Pour les paiements et la mise en relation acheteur/vendeur.",
  },
};

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

export default function EmailAuthScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; reason?: string }>();
  const initialMode: Mode = params.mode === "signin" ? "signin" : "signup";

  // State machine — mode contrôle quel parcours, step contrôle où dans le
  // wizard signup. Step ignoré quand mode === "signin".
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>(1);

  // Form fields — tenus dans un seul composant pour préserver l'état entre
  // les steps (back puis forward = pas de perte de saisie).
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [ville, setVille] = useState("");
  const [quartier, setQuartier] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [country, setCountry] = useState<Country | null>(null);
  const [countryLoaded, setCountryLoaded] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"email" | "password" | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);

  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // true pendant qu'on attend que AuthProvider confirme la session post-signin.
  const signedInRef = useRef(false);

  const {
    isAuthenticated,
    authError: ctxAuthError,
    clearAuthError,
  } = useAuth();

  useEffect(() => {
    AsyncStorage.getItem("niqo_country")
      .then((stored) => {
        if (stored === "CI" || stored === "CG") setCountry(stored);
        else setCountry("CI"); // fallback si jamais absent
      })
      .catch(() => setCountry("CI"))
      .finally(() => setCountryLoaded(true));
  }, []);

  const safeCountry: Country = country ?? "CI";
  const phoneConfig = PHONE_CONFIG[safeCountry];
  const phoneE164 = normalizePhone(safeCountry, phoneLocal);
  const phoneValid = phoneE164 !== null;
  const phoneDigits = phoneLocal.replace(/[^0-9]/g, "");
  const phoneError = phoneDigits.length >= phoneConfig.localDigits && !phoneValid;

  const isSignup = mode === "signup";
  const inWizard = isSignup;

  // Validation contextuelle au state actuel.
  const canSubmit = (() => {
    if (rateLimitCountdown > 0) return false;
    if (info !== null) return false;
    if (mode === "signin") {
      return isValidEmail(email) && password.length >= 6;
    }
    // signup wizard
    if (step === 1) {
      return isValidEmail(email) && password.length >= 6;
    }
    if (step === 2) {
      return (
        prenom.trim().length > 0 &&
        nom.trim().length > 0 &&
        ville.trim().length > 0 &&
        quartier.trim().length > 0
      );
    }
    // step === 3
    return phoneValid && acceptedTerms;
  })();

  // Back button : décrémente le step si > 1, sinon exit.
  const onBack = useCallback(() => {
    if (isSignup && step > 1) {
      setError(null);
      setStep((s) => (s - 1) as Step);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, [isSignup, step]);

  // Hardware back Android — intercept pour appliquer la même logique.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  // Désactive le swipe-back iOS quand on est dans un step > 1, sinon on
  // perdrait la progression du wizard sans transition contrôlée.
  const gestureEnabled = !(isSignup && step > 1);

  // Map un message d'erreur → champ responsable pour le border rouge.
  function toErrorField(msg: string): "email" | "password" | null {
    if (
      msg.includes("invalide") ||
      msg.includes("déjà avec cet email") ||
      msg.includes("pour cet email") ||
      msg.includes("confirmé")
    )
      return "email";
    if (msg.includes("mot de passe") || msg.includes("incorrect"))
      return "password";
    return null;
  }

  // setError + détection du champ fautif en une seule opération.
  function setFieldError(msg: string | null) {
    setError(msg);
    setErrorField(msg ? toErrorField(msg) : null);
  }

  // Démarre un countdown 60 s qui bloque le CTA (rate-limit visuel).
  function startRateLimit() {
    if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
    setRateLimitCountdown(60);
    rateLimitTimerRef.current = setInterval(() => {
      setRateLimitCountdown((s) => {
        if (s <= 1) {
          if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  // Démarre un countdown 60 s sur le bouton "Renvoyer l'email".
  function startResendCountdown() {
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    setResendCountdown(60);
    resendTimerRef.current = setInterval(() => {
      setResendCountdown((s) => {
        if (s <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function resendConfirmation() {
    if (resendCountdown > 0) return;
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      setError("Pas de connexion internet. Vérifie ta connexion et réessaie.");
      return;
    }
    try {
      const { error: resendError } = await withTimeout(
        supabase.auth.resend({ type: "signup", email: email.trim() }),
        AUTH_TIMEOUT_MS,
        "resend"
      );
      if (resendError) {
        setError(authErrorToFr(resendError));
      } else {
        setInfo("Email renvoyé ! Vérifie ta boîte mail (pense aussi aux spams).");
      }
    } catch (e) {
      setError(authErrorToFr(e));
    } finally {
      startResendCountdown();
    }
  }

  // Purge les timers au démontage.
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, []);

  // Navigation post-signin : pilotée par AuthProvider plutôt que par
  // actuallySignin() — garantit qu'on attend le fetch profil complet.
  useEffect(() => {
    if (isAuthenticated && signedInRef.current) {
      signedInRef.current = false;
      if (router.canGoBack()) router.back();
      else router.replace("/home");
    }
  }, [isAuthenticated]);

  // Erreurs async d'AuthProvider (ex : compte suspendu détecté post-signin).
  useEffect(() => {
    if (ctxAuthError && signedInRef.current) {
      setFieldError(ctxAuthError);
      clearAuthError();
      signedInRef.current = false;
    }
  }, [ctxAuthError, clearAuthError]);

  function switchMode(next: Mode) {
    setMode(next);
    setStep(1);
    setError(null);
    setErrorField(null);
    setInfo(null);
    setRateLimitCountdown(0);
    if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
  }

  async function actuallySignup() {
    setError(null);
    setInfo(null);
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      setFieldError("Pas de connexion internet. Vérifie ta connexion et réessaie.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: signUpError } = await withTimeout(
        supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: {
              prenom: prenom.trim(),
              nom: nom.trim(),
              ville: ville.trim(),
              quartier: quartier.trim(),
              telephone: phoneE164,
              pays: safeCountry,
              auth_provider: "email",
              cgu_accepted_at: new Date().toISOString(),
              cgu_version: LEGAL_LAST_UPDATED,
            },
            emailRedirectTo: Linking.createURL("/auth/callback"),
          },
        }),
        AUTH_TIMEOUT_MS,
        "signUp"
      );
      if (signUpError) {
        const msg = authErrorToFr(signUpError);
        if (msg.includes("Trop de tentatives")) startRateLimit();
        setFieldError(msg);
        return;
      }
      // Supabase anti-enumeration : email déjà utilisé renvoie un fake user
      // sans erreur, avec identities = []. Cf. supabase-js issue #18170.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setFieldError(AUTH_ERRORS_FR.user_already_exists);
        return;
      }
      if (data.user && !data.session) {
        // Email confirmation ON — user must check inbox.
        setInfo(
          "Vérifie ta boîte mail pour confirmer ton inscription (pense aussi à regarder tes spams)."
        );
        startResendCountdown();
        return;
      }
      if (router.canGoBack()) router.back();
      else router.replace("/home");
    } catch (e) {
      const msg = authErrorToFr(e);
      if (msg.includes("Trop de tentatives")) startRateLimit();
      setFieldError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function actuallySignin() {
    setError(null);
    setErrorField(null);
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      setFieldError("Pas de connexion internet. Vérifie ta connexion et réessaie.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: signInError } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        }),
        AUTH_TIMEOUT_MS,
        "signInWithPassword"
      );
      if (signInError) {
        const msg = authErrorToFr(signInError);
        if (msg.includes("Trop de tentatives")) startRateLimit();
        setFieldError(msg);
        return;
      }
      // Pas de navigation ici — on attend que AuthProvider confirme la session
      // via onAuthStateChange → isAuthenticated = true → useEffect navigue.
      // Cela permet aussi de catcher les erreurs async (compte suspendu, etc.).
      signedInRef.current = true;
    } catch (e) {
      const msg = authErrorToFr(e);
      if (msg.includes("Trop de tentatives")) startRateLimit();
      setFieldError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    if (!canSubmit || submitting) return;

    if (mode === "signin") {
      void actuallySignin();
      return;
    }

    // signup wizard
    if (step < 3) {
      setError(null);
      setStep((s) => (s + 1) as Step);
      return;
    }

    void actuallySignup();
  }

  // Label du CTA dépend du contexte
  const ctaLabel = (() => {
    if (rateLimitCountdown > 0) return `Réessaie dans ${rateLimitCountdown}s`;
    if (mode === "signin") return "Se connecter";
    if (step < 3) return "Continuer";
    return "Créer mon compte";
  })();

  // Header title — invariant brand vs étape
  const headerTitle = isSignup ? "Créer mon compte" : "Connexion";

  // Footer link — uniquement signin OU signup step 1
  const showFooterLink =
    mode === "signin" || (mode === "signup" && step === 1);

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
      <Stack.Screen options={{ headerShown: false, gestureEnabled }} />

      {/* Header */}
      <View className="px-4 h-14 flex-row items-center border-b border-niqo-gray-150">
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
        >
          <ArrowLeft size={22} color="#1A1A1A" />
        </Pressable>
        <Text className="ml-2 font-display text-h3 text-niqo-black">
          {headerTitle}
        </Text>
      </View>

      {/* Brand wordmark — anchor visuel commun aux deux modes (statique,
          hors Animated.View pour ne pas re-jouer la transition). Reprend
          le pattern HomeHeader : "niqo" noir + "." coral. */}
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

      {/* Tout ce qui change entre signin/signup est wrap dans un Animated.View
          keyed sur `mode`. Le remount React déclenche le FadeInUp Reanimated
          (slide ~12px depuis le bas + fade, 250ms ease-out). Le header
          reste stable au-dessus pour ne pas distraire pendant la transition. */}
      <Animated.View
        key={mode}
        entering={FadeInUp.duration(250)}
        style={{ flex: 1 }}
      >
        {/* Wizard progress (signup only) */}
        {inWizard && (
          <View className="px-4 pt-4 pb-2">
            <WizardProgress step={step} />
          </View>
        )}

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
          {/* Title + subtitle */}
          {isSignup ? (
            <>
              <Text className="font-display text-h2 text-niqo-black">
                {SIGNUP_STEP_COPY[step].title}
              </Text>
              <Text className="mt-1 mb-6 font-body text-body text-niqo-gray-500">
                {SIGNUP_STEP_COPY[step].subtitle}
              </Text>
            </>
          ) : (
            <Text className="mb-6 font-body text-body text-niqo-gray-500">
              Bon retour ! Connecte-toi à ton compte.
            </Text>
          )}

          {/* Error banner */}
          {error && (
            <View className="mb-4 bg-niqo-status-en-litige-bg border border-niqo-danger rounded-card px-4 py-3">
              <Text className="font-body text-caption text-niqo-status-en-litige-text">
                {error}
              </Text>
            </View>
          )}

          {/* Info banner */}
          {info && (
            <View className="mb-4 bg-niqo-status-escrow-bg border border-niqo-info rounded-card px-4 py-3">
              <Text className="font-body text-caption text-niqo-status-escrow-text">
                {info}
              </Text>
              <Pressable
                onPress={resendConfirmation}
                disabled={resendCountdown > 0}
                accessibilityRole="button"
                accessibilityLabel={
                  resendCountdown > 0
                    ? `Renvoyer l'email dans ${resendCountdown} secondes`
                    : "Renvoyer l'email de confirmation"
                }
                hitSlop={8}
                className="mt-2 self-start active:opacity-60"
              >
                <Text
                  className={`font-body text-caption underline ${
                    resendCountdown > 0 ? "text-niqo-gray-500" : "text-niqo-coral"
                  }`}
                >
                  {resendCountdown > 0
                    ? `Renvoyer dans ${resendCountdown}s`
                    : "Renvoyer l'email"}
                </Text>
              </Pressable>
            </View>
          )}

          {/* === SIGNIN / SIGNUP STEP 1 — Email + Password === */}
          {(mode === "signin" || (isSignup && step === 1)) && (
            <>
              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Email
              </Text>
              <TextInput
                value={email}
                onChangeText={(t) => { setEmail(t); if (errorField === "email") setErrorField(null); }}
                placeholder="ton@email.com"
                placeholderTextColor="#888780"
                keyboardType="email-address"
                textContentType="emailAddress"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                className={`bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 font-body text-body text-niqo-black border ${
                  errorField === "email" ? "border-niqo-danger" : "border-transparent"
                }`}
              />

              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Mot de passe
              </Text>
              <TextInput
                value={password}
                onChangeText={(t) => { setPassword(t); if (errorField === "password") setErrorField(null); }}
                placeholder="6 caractères minimum"
                placeholderTextColor="#888780"
                secureTextEntry
                textContentType={isSignup ? "newPassword" : "password"}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                className={`bg-niqo-gray-50 rounded-card px-4 h-12 font-body text-body text-niqo-black border ${
                  errorField === "password" ? "border-niqo-danger" : "border-transparent"
                } ${mode === "signin" ? "mb-1" : isSignup && password.length === 0 ? "mb-6" : ""}`}
              />

              {/* Password strength — signup uniquement, dès le premier caractère.
                  Double signal : barres colorées + label + hint textuel (pas color-only). */}
              {isSignup && password.length > 0 && (() => {
                const strength = getPasswordStrength(password);
                const cfg = PASSWORD_STRENGTH_CONFIG[strength];
                return (
                  <View className="mt-2 mb-6">
                    {/* Barres + label sur la même ligne */}
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
                    {/* Hint inline — dit à l'user quoi améliorer */}
                    {cfg.hint && (
                      <Text className="font-body text-micro text-niqo-gray-500 mt-1">
                        {cfg.hint}
                      </Text>
                    )}
                  </View>
                );
              })()}

              {mode === "signin" && (
                <View className="flex-row justify-end mb-4">
                  <Pressable
                    onPress={() => router.push("/auth/forgot-password")}
                    accessibilityRole="link"
                    accessibilityLabel="Mot de passe oublié"
                    hitSlop={8}
                    className="min-h-[44px] justify-center px-2 -mr-2 active:opacity-60"
                  >
                    <Text className="font-body text-caption text-niqo-coral underline">
                      Mot de passe oublié ?
                    </Text>
                  </Pressable>
                </View>
              )}
            </>
          )}

          {/* === SIGNUP STEP 2 — Identité === */}
          {isSignup && step === 2 && (
            <>
              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Prénom
              </Text>
              <TextInput
                value={prenom}
                onChangeText={setPrenom}
                placeholder="Jean"
                placeholderTextColor="#888780"
                textContentType="givenName"
                autoCapitalize="words"
                returnKeyType="next"
                className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 font-body text-body text-niqo-black"
              />

              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Nom
              </Text>
              <TextInput
                value={nom}
                onChangeText={setNom}
                placeholder="Kouassi"
                placeholderTextColor="#888780"
                textContentType="familyName"
                autoCapitalize="words"
                returnKeyType="next"
                className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 font-body text-body text-niqo-black"
              />

              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Ville
              </Text>
              <Pressable
                onPress={() => setCityPickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={
                  ville ? `Ville sélectionnée : ${ville}` : "Choisis ta ville"
                }
                className="flex-row items-center justify-between bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 active:opacity-80"
              >
                <Text
                  className={`font-body text-body ${
                    ville ? "text-niqo-black" : "text-niqo-gray-500"
                  }`}
                >
                  {ville || "Choisis ta ville"}
                </Text>
                <ChevronDown size={18} color="#888780" />
              </Pressable>

              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Quartier
              </Text>
              <TextInput
                value={quartier}
                onChangeText={setQuartier}
                placeholder={
                  safeCountry === "CI"
                    ? "Ex : Cocody, Yopougon, Treichville"
                    : "Ex : Bacongo, Poto-Poto, Talangaï"
                }
                placeholderTextColor="#888780"
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-6 font-body text-body text-niqo-black"
              />
            </>
          )}

          {/* === SIGNUP STEP 3 — Mobile Money + CGU === */}
          {isSignup && step === 3 && (
            <>
              <Text className="font-body text-caption text-niqo-gray-800 mb-1">
                Téléphone Mobile Money
              </Text>
              <View className={`flex-row items-center bg-niqo-gray-50 rounded-card h-12 mb-1 pl-3 pr-4 border ${phoneError ? "border-niqo-danger" : "border-transparent"}`}>
                <Text
                  className="font-body text-body text-niqo-gray-800"
                  allowFontScaling={false}
                >
                  {phoneConfig.flag} {phoneConfig.prefix}
                </Text>
                <View className="w-px h-6 bg-niqo-gray-200 mx-3" />
                <TextInput
                  value={phoneLocal}
                  onChangeText={setPhoneLocal}
                  placeholder={phoneConfig.placeholder}
                  placeholderTextColor="#888780"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  returnKeyType="done"
                  className="flex-1 font-body text-body text-niqo-black"
                />
              </View>
              {phoneError ? (
                <Text className="mb-6 font-body text-micro text-niqo-danger">
                  {safeCountry === "CI"
                    ? "Numéro invalide pour la Côte d'Ivoire."
                    : "Numéro invalide pour le Congo."}
                </Text>
              ) : (
                <Text className="mb-6 font-body text-micro text-niqo-gray-500">
                  {phoneConfig.localDigits} chiffres après l&apos;indicatif. Le
                  numéro sert aux paiements et à la mise en relation
                  acheteur/vendeur.
                </Text>
              )}

              <Pressable
                onPress={() => setAcceptedTerms((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acceptedTerms }}
                accessibilityLabel="J'accepte les conditions d'utilisation et la politique de confidentialité"
                className="flex-row items-start mb-6 gap-3 active:opacity-60"
              >
                <View
                  className={`w-5 h-5 rounded border-2 items-center justify-center mt-0.5 ${
                    acceptedTerms
                      ? "bg-niqo-coral border-niqo-coral"
                      : "bg-niqo-white border-niqo-gray-300"
                  }`}
                >
                  {acceptedTerms && (
                    <Check size={14} color="#FFFFFF" strokeWidth={3} />
                  )}
                </View>
                <Text className="flex-1 font-body text-caption text-niqo-gray-800">
                  J&apos;accepte les{" "}
                  <Text
                    className="text-niqo-coral underline"
                    onPress={() => router.push(LEGAL_ROUTES.terms)}
                    accessibilityRole="link"
                  >
                    conditions d&apos;utilisation
                  </Text>
                  {" "}et la{" "}
                  <Text
                    className="text-niqo-coral underline"
                    onPress={() => router.push(LEGAL_ROUTES.privacy)}
                    accessibilityRole="link"
                  >
                    politique de confidentialité
                  </Text>
                  .
                </Text>
              </Pressable>
            </>
          )}

          {/* CTA */}
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ disabled: !canSubmit || submitting }}
            className={`flex-row items-center justify-center bg-niqo-coral rounded-btn min-h-[48px] px-4 ${
              !canSubmit || submitting ? "opacity-50" : "active:opacity-80"
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

          {/* Footer link — switch mode (signin ⇄ signup step 1) */}
          {showFooterLink && (
            <View className="flex-row items-center justify-center mt-6">
              <Text className="font-body text-caption text-niqo-gray-500">
                {mode === "signin"
                  ? "Pas encore de compte ?"
                  : "Déjà un compte ?"}
              </Text>
              <Pressable
                onPress={() =>
                  switchMode(mode === "signin" ? "signup" : "signin")
                }
                accessibilityRole="link"
                className="ml-2 min-h-[44px] justify-center active:opacity-60"
              >
                <Text className="font-body text-caption text-niqo-coral underline">
                  {mode === "signin" ? "Inscription" : "Connexion"}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>

      {/* City picker bottom-sheet (signup step 2) */}
      <CityPicker
        visible={cityPickerOpen}
        cities={CITIES_BY_COUNTRY[safeCountry]}
        selected={ville}
        onSelect={setVille}
        onClose={() => setCityPickerOpen(false)}
      />
    </View>
  );
}
