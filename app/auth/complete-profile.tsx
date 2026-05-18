import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, router } from "expo-router";
import { Check, ChevronDown } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useAuth } from "@/lib/auth/AuthProvider";
import { authErrorToFr } from "@/lib/auth/errors";
import { LEGAL_ROUTES } from "@/lib/legal";
import { CITIES_BY_COUNTRY } from "@/lib/locations";
import { PHONE_CONFIG, normalizePhone, type Country } from "@/lib/phone";
import { completeMyProfile, deleteMyAccount } from "@/lib/supabase";

/**
 * Écran post-signup OAuth (Google/Apple) — collecte ville/quartier/telephone
 * que ces flows ne ramènent pas. Le routing est forcé via AuthProvider :
 * tant que `needsProfileCompletion === true`, le user atterrit ici peu
 * importe l'URL cible.
 *
 * Email signup ne passe JAMAIS ici (le wizard 3-step pousse déjà telephone).
 *
 * Bouton "Plus tard" = signOut + retour home anonyme. Pas de back hardware
 * autorisé (gestureEnabled false + pas de back button).
 */
export default function CompleteProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profile, signOut, refreshProfile } = useAuth();

  // Pays de l'user. Source de vérité prioritaire : AsyncStorage (CountryPicker
  // initial, persistant avant/après le browser OAuth) — Supabase
  // signInWithOAuth ne propage PAS les queryParams custom dans
  // raw_user_meta_data, donc le trigger handle_new_user fallback toujours
  // sur 'CI' pour les users OAuth (limitation Supabase, cf. mig 82). On
  // corrige ici en lisant l'AsyncStorage et en poussant le bon pays via
  // complete_my_profile au submit.
  const [country, setCountry] = useState<Country>(profile?.pays === "CG" ? "CG" : "CI");
  const phoneConfig = PHONE_CONFIG[country];

  // Pré-remplit prenom/nom depuis profile. Pour Apple Sign In, le nom n'est
  // renvoyé QU'au premier auth (et l'user peut choisir de le masquer) → on
  // tombe vite sur les fallbacks 'Utilisateur' / '—' du trigger handle_new_user.
  // Pour Google, normalement given_name/family_name arrivent via raw_user_meta_data
  // mais peuvent être absents si scope mal configuré. Dans tous les cas on
  // affiche les champs éditables pour que l'user puisse corriger / valider.
  const [prenom, setPrenom] = useState(profile?.prenom ?? "");
  const [nom, setNom] = useState(profile?.nom ?? "");

  // Pré-remplit ville depuis profile (capital fallback du trigger handle_new_user
  // ou valeur déjà saisie si l'user repasse ici après partial fail).
  const [ville, setVille] = useState(profile?.ville ?? "");
  const [quartier, setQuartier] = useState(profile?.quartier ?? "");

  // Au mount : recharger le pays depuis AsyncStorage (priorité sur profile.pays)
  useEffect(() => {
    void AsyncStorage.getItem("niqo_country").then((stored) => {
      if (stored !== "CG" && stored !== "CI") return;
      setCountry(stored);
      // Si la ville est encore le fallback capital du MAUVAIS pays
      // (poséepar le trigger handle_new_user), la corriger en silence.
      const wrongCapital = stored === "CG" ? "Abidjan" : "Brazzaville";
      const rightCapital = stored === "CG" ? "Brazzaville" : "Abidjan";
      setVille((curr) => (curr === wrongCapital || curr === "" ? rightCapital : curr));
    });
  }, []);
  const [phoneLocal, setPhoneLocal] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si profile change (refresh), resync les champs pré-remplis.
  useEffect(() => {
    if (profile) {
      setPrenom((curr) => (curr ? curr : profile.prenom));
      setNom((curr) => (curr ? curr : profile.nom));
      setVille((curr) => (curr ? curr : profile.ville));
      setQuartier((curr) => (curr ? curr : profile.quartier ?? ""));
    }
  }, [profile]);

  const phoneE164 = normalizePhone(country, phoneLocal);
  const phoneValid = phoneE164 !== null;
  const canSubmit = useMemo(
    () =>
      prenom.trim().length > 0 &&
      nom.trim().length > 0 &&
      ville.trim().length > 0 &&
      phoneValid &&
      acceptedTerms &&
      !submitting,
    [prenom, nom, ville, phoneValid, acceptedTerms, submitting]
  );

  async function onSubmit() {
    if (!canSubmit || !phoneE164) return;
    setError(null);
    setSubmitting(true);
    try {
      await completeMyProfile({
        prenom: prenom.trim(),
        nom: nom.trim(),
        ville: ville.trim(),
        quartier: quartier.trim() || null,
        telephone: phoneE164,
        pays: country,
      });
      await refreshProfile();
      router.replace("/home");
    } catch (e) {
      setError(authErrorToFr(e));
    } finally {
      setSubmitting(false);
    }
  }

  // "Plus tard" = abandon de l'inscription. RGPD clean : on supprime le compte
  // (n'a jamais consenti aux CGU + données incomplètes) plutôt que de laisser
  // un row orphelin en DB. Confirmation explicite obligatoire avant delete.
  function onLater() {
    if (signingOut) return;
    Alert.alert(
      "Annuler l'inscription ?",
      "Tu n'as pas accepté les conditions d'utilisation. Si tu sors maintenant, ton compte sera supprimé. Tu pourras toujours revenir et créer un nouveau compte.",
      [
        { text: "Continuer l'inscription", style: "cancel" },
        {
          text: "Supprimer mon compte",
          style: "destructive",
          onPress: async () => {
            setSigningOut(true);
            try {
              // delete_my_account() cascade auth.users → public.users.
              // signOut() suit pour purger la session SecureStore.
              await deleteMyAccount();
              await signOut();
              router.replace("/home");
            } catch (e) {
              setError(authErrorToFr(e));
              setSigningOut(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-niqo-white">
      {/* gestureEnabled=false : pas de swipe-back, l'user doit submit ou
          tap "Annuler" (qui supprime le compte). Pas de back button. */}
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      {/* Header — wordmark + lien "Annuler" à droite (delete-account). */}
      <View className="px-4 h-14 flex-row items-center justify-between border-b border-niqo-gray-150">
        <View className="flex-row">
          <Text
            className="font-display text-h3 text-niqo-black"
            allowFontScaling={false}
          >
            niqo
          </Text>
          <Text
            className="font-display text-h3 text-niqo-coral"
            allowFontScaling={false}
          >
            .
          </Text>
        </View>
        <Pressable
          onPress={onLater}
          accessibilityRole="button"
          accessibilityLabel="Annuler l'inscription et supprimer le compte"
          hitSlop={8}
          disabled={signingOut}
          className="min-h-[44px] justify-center px-2 -mr-2 active:opacity-60"
        >
          <Text className="font-body text-caption text-niqo-gray-800 underline">
            {signingOut ? "…" : "Annuler"}
          </Text>
        </Pressable>
      </View>

      <Animated.View entering={FadeInUp.duration(250)} style={{ flex: 1 }}>
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
              Encore quelques infos
            </Text>
            <Text className="mt-1 mb-6 font-body text-body text-niqo-gray-500">
              {profile?.prenom && profile.prenom !== "Utilisateur"
                ? `Bienvenue ${profile.prenom} ! `
                : ""}
              On a besoin de ton adresse et ton numéro Mobile Money pour les
              paiements.
            </Text>

            {error && (
              <View className="mb-4 bg-niqo-status-en-litige-bg border border-niqo-danger rounded-card px-4 py-3">
                <Text className="font-body text-caption text-niqo-status-en-litige-text">
                  {error}
                </Text>
              </View>
            )}

            {/* Prénom */}
            <Text className="font-body text-caption text-niqo-gray-800 mb-1">
              Prénom
            </Text>
            <TextInput
              value={prenom}
              onChangeText={setPrenom}
              placeholder="Ex : Aïcha, Jean-Marc"
              placeholderTextColor="#888780"
              autoCapitalize="words"
              autoComplete="name-given"
              textContentType="givenName"
              returnKeyType="next"
              maxLength={60}
              className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 font-body text-body text-niqo-black"
            />

            {/* Nom */}
            <Text className="font-body text-caption text-niqo-gray-800 mb-1">
              Nom
            </Text>
            <TextInput
              value={nom}
              onChangeText={setNom}
              placeholder="Ex : Konan, Mboungou"
              placeholderTextColor="#888780"
              autoCapitalize="words"
              autoComplete="name-family"
              textContentType="familyName"
              returnKeyType="next"
              maxLength={60}
              className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 font-body text-body text-niqo-black"
            />

            {/* Ville */}
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

            {/* Quartier */}
            <Text className="font-body text-caption text-niqo-gray-800 mb-1">
              Quartier <Text className="text-niqo-gray-500">(optionnel)</Text>
            </Text>
            <TextInput
              value={quartier}
              onChangeText={setQuartier}
              placeholder={
                country === "CI"
                  ? "Ex : Cocody, Yopougon, Treichville"
                  : "Ex : Bacongo, Poto-Poto, Talangaï"
              }
              placeholderTextColor="#888780"
              autoCapitalize="words"
              returnKeyType="next"
              className="bg-niqo-gray-50 rounded-card px-4 h-12 mb-4 font-body text-body text-niqo-black"
            />

            {/* Téléphone — A1 + A4 audit : sanitize digits-only + feedback
                visuel border rouge si saisie en cours mais invalide (cohérence
                avec /sell, /profile/edit, KYC, boost). */}
            <Text className="font-body text-caption text-niqo-gray-800 mb-1">
              Téléphone Mobile Money
            </Text>
            <View
              className={`flex-row items-center bg-niqo-gray-50 rounded-card h-12 mb-1 pl-3 pr-4 border ${
                phoneLocal.length > 0 && !phoneValid
                  ? "border-niqo-danger"
                  : "border-transparent"
              }`}
            >
              <Text
                className="font-body text-body text-niqo-gray-800"
                allowFontScaling={false}
              >
                {phoneConfig.flag} {phoneConfig.prefix}
              </Text>
              <View className="w-px h-6 bg-niqo-gray-200 mx-3" />
              <TextInput
                value={phoneLocal}
                onChangeText={(t) => setPhoneLocal(t.replace(/\D/g, ""))}
                placeholder={phoneConfig.placeholder}
                placeholderTextColor="#888780"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                returnKeyType="done"
                maxLength={phoneConfig.localDigits}
                onSubmitEditing={onSubmit}
                className="flex-1 font-body text-body text-niqo-black"
              />
            </View>
            <Text
              className={`mb-6 font-body text-micro ${
                phoneLocal.length > 0 && !phoneValid
                  ? "text-niqo-danger"
                  : "text-niqo-gray-500"
              }`}
            >
              {phoneLocal.length > 0 && !phoneValid
                ? `Numéro ${country === "CI" ? "ivoirien" : "congolais"} invalide — ${phoneConfig.localDigits} chiffres requis.`
                : `${phoneConfig.localDigits} chiffres après l'indicatif. Le numéro sert aux paiements et à la mise en relation acheteur/vendeur.`}
            </Text>

            {/* CGU + Politique de confidentialité — RGPD §5 (consentement
                explicite). Pattern identique à email.tsx step 3. */}
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

            {/* CTA */}
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Valider et compléter mon profil"
              accessibilityState={{ disabled: !canSubmit }}
              className={`min-h-[48px] rounded-card items-center justify-center flex-row ${
                canSubmit ? "bg-niqo-coral active:opacity-90" : "bg-niqo-gray-200"
              }`}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text
                    className={`font-body text-body ${
                      canSubmit ? "text-niqo-white" : "text-niqo-gray-500"
                    }`}
                  >
                    Valider
                  </Text>
                  {canSubmit && (
                    <Check
                      size={18}
                      color="#FFFFFF"
                      strokeWidth={2.5}
                      style={{ marginLeft: 8 }}
                    />
                  )}
                </>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>

      <CityPicker
        visible={cityPickerOpen}
        cities={CITIES_BY_COUNTRY[country]}
        selected={ville}
        onSelect={(c) => {
          setVille(c);
          setCityPickerOpen(false);
        }}
        onClose={() => setCityPickerOpen(false)}
      />
    </View>
  );
}
