import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, router } from "expo-router";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ImageIcon,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth/AuthProvider";
import { AUTH_ERRORS_FR } from "@/lib/auth/errors";
import {
  removeAvatar,
  updateEmail,
  updateMyProfile,
  uploadAvatar,
  type ProfilePatch,
} from "@/lib/profile";
import {
  PHONE_CONFIG,
  localPhoneDigits,
  normalizePhone,
} from "@/lib/phone";
import { getMyPhone } from "@/lib/supabase";
import { CityPicker } from "@/components/ui/CityPicker";
import { CITIES_BY_COUNTRY } from "@/lib/locations";

const PAYS_OPTIONS: { code: "CI" | "CG"; label: string; comingSoon?: boolean }[] = [
  { code: "CG", label: "Congo" },
  { code: "CI", label: "Côte d'Ivoire", comingSoon: true },
];

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words" | "sentences";
  hint?: string;
  editable?: boolean;
  maxLength?: number;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  hint,
  editable = true,
  maxLength,
}: FieldProps) {
  return (
    <View className="mb-4">
      <Text
        className="font-body text-caption text-niqo-gray-800 mb-1.5"
        allowFontScaling={false}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#888780"
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        autoCorrect={false}
        editable={editable}
        maxLength={maxLength}
        accessibilityLabel={label}
        className={`rounded-card px-4 min-h-[48px] font-body text-body text-niqo-black ${
          editable ? "bg-niqo-gray-50" : "bg-niqo-gray-100 opacity-60"
        }`}
      />
      {hint && (
        <Text className="mt-1.5 font-body text-micro text-niqo-gray-500">
          {hint}
        </Text>
      )}
    </View>
  );
}

/** Validation email simple — front-end only. Le serveur Supabase Auth fait la
 *  validation faisant autorité (MX, format RFC 5322 strict). On bloque juste
 *  les saisies manifestement cassées pour éviter le round-trip server. */
const EMAIL_BASIC_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { profile, refreshProfile, isAuthenticated, isLoading } = useAuth();

  const [prenom, setPrenom] = useState(profile?.prenom ?? "");
  const [nom, setNom] = useState(profile?.nom ?? "");
  const [pays, setPays] = useState<"CI" | "CG">(profile?.pays ?? "CI");
  const [ville, setVille] = useState(profile?.ville ?? "");
  const [quartier, setQuartier] = useState(profile?.quartier ?? "");
  const [phone, setPhone] = useState("");
  const [originalPhone, setOriginalPhone] = useState<string | null>(null);
  const [phoneLoaded, setPhoneLoaded] = useState(false);
  const [email, setEmail] = useState(profile?.email ?? "");
  const [avatarLocalUri, setAvatarLocalUri] = useState<string | null>(null);
  // Set quand l'user tap "Retirer la photo" — purge bucket + clear avatar_url
  // au save. avatarLocalUri prime sur ce flag (si l'user re-pick après avoir
  // tapé "Retirer", on annule la suppression).
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);

  // Calcul "des modifs sont en attente" — utilisé par le guard back. On
  // n'inclut PAS le téléphone tant qu'il n'est pas chargé (sinon bombe
  // l'Alert au moindre back précoce).
  const isDirty = (() => {
    if (!profile) return false;
    if (prenom.trim() !== profile.prenom) return true;
    if (nom.trim() !== profile.nom) return true;
    if (pays !== profile.pays) return true;
    if (ville.trim() !== profile.ville) return true;
    if (quartier.trim() !== (profile.quartier ?? "")) return true;
    if (email.trim() !== profile.email) return true;
    if (avatarLocalUri !== null) return true;
    if (avatarRemoved && !!profile.avatar_url) return true;
    if (phoneLoaded) {
      const originalLocal = localPhoneDigits(originalPhone);
      if (phone.replace(/\D/g, "") !== originalLocal) return true;
    }
    return false;
  })();

  // Defensive — should never render this screen without auth, but guard
  // against direct deep-link / dev navigation (audit fix #7). Same pattern
  // as /profile.
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace("/home");
    }
  }, [isLoading, isAuthenticated]);

  // Guard back — capture le bouton Back header, le swipe iOS et le hardware
  // Back Android. Si l'user a des modifs et n'est pas en train de save, prompt.
  // L'Alert "Quitter" relance l'action originale via dispatch (e.data.action).
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!isDirty || isSaving) return;
      e.preventDefault();
      Alert.alert(
        "Modifications non enregistrées",
        "Tu as des modifs en attente. Quitter sans enregistrer ?",
        [
          { text: "Rester", style: "cancel" },
          {
            text: "Quitter sans enregistrer",
            style: "destructive",
            onPress: () => navigation.dispatch(e.data.action),
          },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, isSaving]);

  // Load decrypted phone via RPC (column is bytea). Until loaded, the phone
  // input is read-only AND the patch builder skips telephone — prevents the
  // race where a fast user saves before getMyPhone resolves and accidentally
  // overwrites their stored number with empty (audit fix #1).
  // Le state `phone` ne contient que les chiffres locaux (sans +225/+242),
  // l'UI affiche un préfixe figé selon le pays courant.
  useEffect(() => {
    let cancelled = false;
    void getMyPhone().then((p) => {
      if (cancelled) return;
      setOriginalPhone(p);
      setPhone(localPhoneDigits(p));
      setPhoneLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile) {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-niqo-white"
      />
    );
  }

  const initials =
    (profile.prenom[0] ?? "U") + (profile.nom[0] ?? "");
  // Order : remplacement local > suppression > avatar serveur > placeholder.
  const avatarToShow = avatarLocalUri
    ? avatarLocalUri
    : avatarRemoved
      ? null
      : profile.avatar_url;
  const hasAvatarToRemove =
    avatarLocalUri !== null || (!avatarRemoved && !!profile.avatar_url);

  function showAvatarPicker() {
    Alert.alert(
      "Photo de profil",
      "Choisis une source",
      [
        { text: "Prendre une photo", onPress: pickFromCamera },
        { text: "Choisir dans la galerie", onPress: pickFromGallery },
        ...(hasAvatarToRemove
          ? [
              {
                text: "Retirer la photo",
                style: "destructive" as const,
                onPress: handleRemovePhoto,
              },
            ]
          : []),
        { text: "Annuler", style: "cancel" as const },
      ],
      { cancelable: true }
    );
  }

  function handleRemovePhoto() {
    // Réinitialise une éventuelle pick locale ET marque la suppression.
    // Au save, branche vers removeAvatar(). Si l'user re-pick avant save,
    // les helpers pickFrom* annulent ce flag.
    setAvatarLocalUri(null);
    setAvatarRemoved(true);
  }

  async function pickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Accès refusé",
        "Active l'accès aux photos dans les réglages de ton téléphone."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarLocalUri(result.assets[0].uri);
      setAvatarRemoved(false);
    }
  }

  async function pickFromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Accès refusé",
        "Active l'accès à la caméra dans les réglages de ton téléphone."
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarLocalUri(result.assets[0].uri);
      setAvatarRemoved(false);
    }
  }

  async function handleSave() {
    const current = profile;
    if (!current) return;

    // Lightweight client-side validation. Required fields must be non-empty
    // after trim — the RPC also enforces this server-side (defense-in-depth).
    const trimmedPrenom = prenom.trim();
    const trimmedNom = nom.trim();
    const trimmedVille = ville.trim();
    const trimmedQuartier = quartier.trim();
    const trimmedEmail = email.trim();

    if (!trimmedPrenom || !trimmedNom || !trimmedVille) {
      Alert.alert(
        "Champs requis",
        "Prénom, nom et ville ne peuvent pas être vides."
      );
      return;
    }
    if (trimmedEmail && !EMAIL_BASIC_REGEX.test(trimmedEmail)) {
      Alert.alert("Email invalide", "Vérifie ton adresse email.");
      return;
    }

    // Validation E.164 unifiée via lib/phone.ts — uniquement si les chiffres
    // locaux ont été MODIFIÉS par l'user. Si seul le pays change (digits
    // unchanged), on laisse le numéro existant tel quel (PawaPay re-confirme
    // au paiement). Un user CI qui déménage au Congo n'est donc pas bloqué.
    //
    // normalizePhone valide la longueur ET le préfixe opérateur (01/05/07
    // pour CI, 04/05/06 pour CG) et reconstruit l'E.164 final.
    const phoneDigits = phone.replace(/\D/g, "");
    const originalLocal = localPhoneDigits(originalPhone);
    const phoneIsDirty = phoneLoaded && phoneDigits !== originalLocal;
    let phoneE164: string | null = null;
    if (phoneIsDirty && phoneDigits) {
      phoneE164 = normalizePhone(pays, phoneDigits);
      if (phoneE164 === null) {
        const cfg = PHONE_CONFIG[pays];
        Alert.alert(
          "Téléphone invalide",
          `Le numéro ${cfg.prefix} doit faire ${cfg.localDigits} chiffres et commencer par un opérateur valide (ex: ${cfg.placeholder.replace(/\s/g, "")}).`
        );
        return;
      }
    }

    // Build a partial patch from dirty fields only. Including a key in the
    // patch tells the RPC "update this column" — absent keys are left as-is.
    const patch: ProfilePatch = {};
    if (trimmedPrenom !== current.prenom) patch.prenom = trimmedPrenom;
    if (trimmedNom !== current.nom) patch.nom = trimmedNom;
    if (pays !== current.pays) patch.pays = pays;
    if (trimmedVille !== current.ville) patch.ville = trimmedVille;
    if (trimmedQuartier !== (current.quartier ?? "")) {
      patch.quartier = trimmedQuartier || null;
    }
    // Audit fix #1 : telephone goes into the patch ONLY if (a) we've finished
    // loading the original via getMyPhone and (b) the user actually changed
    // it. Otherwise a fast save before the RPC resolves would push "" and
    // erase the stored number. Réutilise phoneIsDirty calculé plus haut
    // pour garantir un comportement identique à la validation.
    if (phoneIsDirty) {
      // phoneE164 a été calculé ci-dessus si digits non-vides + valides.
      // phoneDigits === "" → null pour clear le numéro.
      patch.telephone = phoneE164;
    }

    const emailChanged = trimmedEmail && trimmedEmail !== current.email;
    const hasAvatar = avatarLocalUri !== null;
    const hasAvatarRemoval = avatarRemoved && !!current.avatar_url;
    const hasPatch = Object.keys(patch).length > 0;

    if (!hasPatch && !hasAvatar && !hasAvatarRemoval && !emailChanged) {
      router.back();
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    // Track which steps committed so an error message can tell the user
    // exactly what was saved — avoids the "everything failed" anxiety when
    // only the last step failed (audit fix #3 partial atomicity).
    const committed: string[] = [];
    try {
      let updatedRow = null;
      if (hasPatch) {
        // RPC returns the updated row → réutilisé en bas pour skip la
        // re-fetch dans refreshProfile (audit fix #11).
        updatedRow = await updateMyProfile(patch);
        committed.push("infos");
        if (patch.pays) {
          await AsyncStorage.setItem("niqo_country", patch.pays);
        }
      }
      if (hasAvatar) {
        await uploadAvatar(avatarLocalUri!);
        committed.push("photo");
      } else if (hasAvatarRemoval) {
        await removeAvatar();
        committed.push("photo retirée");
      }

      // Si on a la row à jour ET qu'on n'a pas modifié l'avatar (qui ne passe
      // pas par updatedRow), on l'applique directement. Sinon fallback fetch.
      if (updatedRow && !hasAvatar && !hasAvatarRemoval) {
        await refreshProfile(updatedRow);
      } else {
        await refreshProfile();
      }

      if (emailChanged) {
        // Email change is a separate flow — fires Supabase confirmation
        // links. The profile.email column updates only after the user
        // clicks the link (handled by trigger on_auth_user_email_updated).
        await updateEmail(trimmedEmail);
        Alert.alert(
          "Email à confirmer",
          `Un lien de confirmation a été envoyé à ${trimmedEmail}. Clique dessus pour valider le changement.`,
          [{ text: "OK", onPress: () => router.back() }]
        );
        return;
      }

      router.back();
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : "Une erreur est survenue.";
      const code = (e as { code?: string } | null)?.code;
      const isPhoneTaken =
        rawMsg.includes("PHONE_ALREADY_USED") ||
        rawMsg.includes("users_telephone_hash_unique");
      const isEmailTaken =
        code === "email_exists" ||
        code === "email_taken" ||
        code === "user_already_exists" ||
        /already.*(register|exist)/i.test(rawMsg);
      const reason = isPhoneTaken
        ? "Ce numéro est déjà associé à un autre compte."
        : isEmailTaken
          ? AUTH_ERRORS_FR.email_exists
          : rawMsg;
      const partial =
        committed.length > 0
          ? `Déjà enregistré : ${committed.join(", ")}. `
          : "";
      Alert.alert("Erreur", `${partial}${reason} Réessaie.`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-niqo-white"
    >
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-niqo-white"
      >
        <Stack.Screen options={{ headerShown: false }} />

        {/* Header */}
        <View className="bg-niqo-white border-b border-niqo-gray-150 px-4 h-14 flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Retour"
              className="min-h-[44px] min-w-[44px] items-center justify-center -ml-2 active:opacity-60"
            >
              <ArrowLeft size={22} color="#1A1A1A" />
            </Pressable>
            <Text className="ml-2 font-display text-h3 text-niqo-black">
              Modifier le profil
            </Text>
          </View>
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Enregistrer"
            className="min-h-[44px] min-w-[44px] items-center justify-center active:opacity-60"
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#D85A30" />
            ) : (
              <Check size={22} color="#D85A30" />
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 32,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar */}
          <View className="items-center mt-2 mb-8">
            <Pressable
              onPress={showAvatarPicker}
              accessibilityRole="button"
              accessibilityLabel="Changer la photo de profil"
              disabled={isSaving}
              className="active:opacity-60"
            >
              <View className="w-28 h-28 rounded-full bg-niqo-coral items-center justify-center overflow-hidden">
                {avatarToShow ? (
                  <Image
                    source={{ uri: avatarToShow }}
                    style={{ width: 112, height: 112 }}
                    contentFit="cover"
                  />
                ) : (
                  <Text
                    className="font-display text-h1 text-niqo-white"
                    allowFontScaling={false}
                  >
                    {initials.toUpperCase()}
                  </Text>
                )}
              </View>
              <View className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-niqo-black items-center justify-center border-2 border-niqo-white">
                <Camera size={16} color="#FFFFFF" />
              </View>
            </Pressable>
            <Pressable
              onPress={showAvatarPicker}
              disabled={isSaving}
              className="mt-3 flex-row items-center gap-1.5 min-h-[36px] px-3 active:opacity-60"
            >
              <ImageIcon size={16} color="#D85A30" />
              <Text className="font-body text-label text-niqo-coral">
                Changer la photo
              </Text>
            </Pressable>
          </View>

          {/* Identity */}
          <Text
            className="font-body text-caption text-niqo-gray-500 mb-2 uppercase tracking-wide"
            allowFontScaling={false}
          >
            Identité
          </Text>
          <Field
            label="Prénom"
            value={prenom}
            onChangeText={setPrenom}
            maxLength={60}
          />
          <Field
            label="Nom"
            value={nom}
            onChangeText={setNom}
            maxLength={60}
          />

          {/* Localisation */}
          <Text
            className="mt-2 font-body text-caption text-niqo-gray-500 mb-2 uppercase tracking-wide"
            allowFontScaling={false}
          >
            Localisation
          </Text>
          <Text
            className="font-body text-caption text-niqo-gray-800 mb-1.5"
            allowFontScaling={false}
          >
            Pays
          </Text>
          <View className="flex-row bg-niqo-gray-50 rounded-card p-1 mb-4">
            {PAYS_OPTIONS.map((opt) => {
              const selected = pays === opt.code;
              const isComingSoon = opt.comingSoon === true;
              return (
                <Pressable
                  key={opt.code}
                  onPress={() => {
                    if (opt.code === pays) return;
                    if (isComingSoon) {
                      Alert.alert(
                        "Bientôt disponible",
                        `Niqo est lancé d'abord au Congo Brazzaville. ${opt.label} arrive prochainement — tu pourras alors changer de pays depuis cet écran.`,
                        [{ text: "OK" }]
                      );
                      return;
                    }
                    const newLabel = opt.code === "CI" ? "Côte d'Ivoire" : "Congo";
                    Alert.alert(
                      `Passer en ${newLabel} ?`,
                      "Ton numéro de téléphone, ta ville et ton quartier seront réinitialisés. Tu devras les renseigner à nouveau.",
                      [
                        { text: "Annuler", style: "cancel" },
                        {
                          text: "Confirmer",
                          onPress: () => {
                            setPays(opt.code);
                            setPhone("");
                            setVille("");
                            setQuartier("");
                          },
                        },
                      ]
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isComingSoon ? `${opt.label} — bientôt disponible` : opt.label
                  }
                  accessibilityState={{ selected, disabled: isComingSoon }}
                  className={`flex-1 min-h-[44px] items-center justify-center rounded-btn ${
                    selected ? "bg-niqo-white" : ""
                  }`}
                  style={{ opacity: isComingSoon ? 0.55 : 1 }}
                >
                  <Text
                    className={`font-body text-label ${
                      selected
                        ? "text-niqo-black"
                        : "text-niqo-gray-500"
                    }`}
                  >
                    {opt.label}
                  </Text>
                  {isComingSoon && (
                    <Text
                      className="font-body text-2xs text-niqo-gray-500 mt-0.5"
                      style={{ fontFamily: "Inter_600SemiBold" }}
                    >
                      Bientôt
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
          <View className="mb-4">
            <Text
              className="font-body text-caption text-niqo-gray-800 mb-1.5"
              allowFontScaling={false}
            >
              Ville
            </Text>
            <Pressable
              onPress={() => setCityPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={ville ? `Ville : ${ville}` : "Choisir la ville"}
              className="flex-row items-center bg-niqo-gray-50 rounded-card px-4 min-h-[48px] active:opacity-80"
            >
              <Text
                className={`flex-1 font-body text-body ${
                  ville ? "text-niqo-black" : "text-niqo-gray-500"
                }`}
              >
                {ville || "Choisir une ville"}
              </Text>
              <ChevronDown size={18} color="#888780" />
            </Pressable>
          </View>
          <Field
            label="Quartier"
            value={quartier}
            onChangeText={setQuartier}
            placeholder="Optionnel"
            maxLength={80}
          />

          {/* Coordonnées */}
          <Text
            className="mt-2 font-body text-caption text-niqo-gray-500 mb-2 uppercase tracking-wide"
            allowFontScaling={false}
          >
            Coordonnées
          </Text>
          {/* Téléphone : préfixe figé (pill non-éditable selon pays) +
              champ chiffres uniquement. L'user ne peut pas se tromper sur
              le format E.164. La saisie filtre tout caractère non-digit. */}
          <View className="mb-4">
            <Text
              className="font-body text-caption text-niqo-gray-800 mb-1.5"
              allowFontScaling={false}
            >
              Téléphone
            </Text>
            <View className="flex-row gap-2">
              <View className="bg-niqo-gray-100 rounded-card px-3 min-h-[48px] items-center justify-center">
                <Text
                  className="font-mono text-body text-niqo-gray-800"
                  allowFontScaling={false}
                >
                  {PHONE_CONFIG[pays].flag} {PHONE_CONFIG[pays].prefix}
                </Text>
              </View>
              <TextInput
                value={phone}
                onChangeText={(next) => setPhone(next.replace(/\D/g, ""))}
                placeholder={PHONE_CONFIG[pays].placeholder}
                placeholderTextColor="#888780"
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                editable={phoneLoaded}
                maxLength={PHONE_CONFIG[pays].localDigits}
                className={`flex-1 rounded-card px-4 min-h-[48px] font-body text-body text-niqo-black ${
                  phoneLoaded ? "bg-niqo-gray-50" : "bg-niqo-gray-100 opacity-60"
                }`}
              />
            </View>
            {!phoneLoaded && (
              <Text className="mt-1.5 font-body text-micro text-niqo-gray-500">
                Chargement…
              </Text>
            )}
          </View>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="ex@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={254}
            hint="Tu recevras un lien de confirmation sur la nouvelle adresse. Si tu utilises Google ou Apple Sign-In, modifie d'abord côté Google/Apple."
          />

          {/* Save (also accessible from header) */}
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Enregistrer les modifications"
            className="mt-6 flex-row items-center justify-center gap-2 bg-niqo-black rounded-btn min-h-[48px] px-4 active:opacity-80"
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Check size={20} color="#FFFFFF" />
                <Text className="font-body text-label text-niqo-white">
                  Enregistrer
                </Text>
              </>
            )}
          </Pressable>

          <CityPicker
            visible={cityPickerOpen}
            cities={CITIES_BY_COUNTRY[pays]}
            selected={ville}
            onSelect={(c) => setVille(c)}
            onClose={() => setCityPickerOpen(false)}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
