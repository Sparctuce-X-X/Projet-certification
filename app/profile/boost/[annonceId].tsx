import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { fetchAnnonceById, type Annonce } from "@/lib/annonces";
import {
  applyBoost,
  BOOST_OPTIONS,
  type BoostOption,
  fetchPaiement,
  formatBoostRemaining,
  getBoostOption,
  initBoostPayment,
  isBoostActive,
  mapApplyBoostError,
  MMO_PROVIDERS_BY_COUNTRY,
  type MmoProvider,
} from "@/lib/boost";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { localPhoneDigits, normalizePhone, PHONE_CONFIG } from "@/lib/phone";
import { getAnnoncePhotoUrl } from "@/lib/storage/annonces-photos";
import { getMyPhone } from "@/lib/supabase";
import { CgvConsentCheckbox } from "@/components/payment/CgvConsentCheckbox";
import { MmoLogo } from "@/components/payment/MmoLogo";

type Status = "idle" | "initing" | "polling" | "applying" | "success" | "error";

const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 60; // 3 min total

export default function BoostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { annonceId } = useLocalSearchParams<{ annonceId: string }>();

  const [annonce, setAnnonce] = useState<Annonce | null>(null);
  const [annonceLoading, setAnnonceLoading] = useState(true);
  const [annonceError, setAnnonceError] = useState<string | null>(null);

  const [country, setCountry] = useState<"CI" | "CG">("CI");
  const [selectedDays, setSelectedDays] = useState<7 | 30>(7);
  const [provider, setProvider] = useState<MmoProvider | null>(null);
  const [phoneInput, setPhoneInput] = useState("");

  const [cgvAccepted, setCgvAccepted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newBoostUntil, setNewBoostUntil] = useState<string | null>(null);
  // B3 audit : ref cancellable pour le polling. Set true au unmount ou tap
  // "Annuler" → break le while loop à la prochaine itération.
  const pollingCancelledRef = useRef(false);

  // ── Load country (AsyncStorage) ────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem("niqo_country").then((c) => {
      if (c === "CI" || c === "CG") setCountry(c);
    });
  }, []);

  // B4 audit : pré-remplit le numéro depuis le Vault (cohérent avec /sell,
  // /profile/edit et le wizard KYC). Évite la re-saisie à chaque boost.
  useEffect(() => {
    let cancelled = false;
    void getMyPhone()
      .then((p) => {
        if (!cancelled && p) setPhoneInput(localPhoneDigits(p));
      })
      .catch(() => {
        // Best-effort — l'user saisira manuellement
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // B3 audit : cleanup polling au unmount (memory leak + race conditions).
  useEffect(() => {
    return () => {
      pollingCancelledRef.current = true;
    };
  }, []);

  // ── Load annonce ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!annonceId) return;
    fetchAnnonceById(annonceId)
      .then((a) => {
        if (!a) {
          setAnnonceError("Annonce introuvable.");
          return;
        }
        if (a.statut !== "active") {
          setAnnonceError(
            "Tu ne peux booster qu'une annonce active. Cette annonce est " +
              a.statut +
              "."
          );
          return;
        }
        setAnnonce(a);
      })
      .catch((e) => setAnnonceError(e instanceof Error ? e.message : "Erreur."))
      .finally(() => setAnnonceLoading(false));
  }, [annonceId]);

  // Reset provider quand country change (l'user doit explicitement choisir).
  // Pas de pré-sélection : on force un tap conscient sur Orange / MTN / Airtel
  // pour éviter les paiements lancés sur le mauvais opérateur.
  useEffect(() => {
    setProvider(null);
  }, [country]);

  const phoneCfg = PHONE_CONFIG[country];
  const phoneE164 = useMemo(() => {
    if (!phoneInput) return null;
    return normalizePhone(country, phoneInput);
  }, [country, phoneInput]);
  const phoneValid = !!phoneE164;

  const selectedOption = getBoostOption(selectedDays);

  const canPay =
    !annonceLoading &&
    !!annonce &&
    !!provider &&
    phoneValid &&
    cgvAccepted &&
    (status === "idle" || status === "error");

  // ── Pay flow ───────────────────────────────────────────────────────────────
  const handlePay = useCallback(async () => {
    if (!canPay || !annonce || !provider || !phoneE164 || !cgvAccepted) return;
    setErrorMsg(null);
    setStatus("initing");
    pollingCancelledRef.current = false;

    try {
      const initResult = await initBoostPayment({
        annonceId: annonce.id,
        days: selectedDays,
        phoneNumber: phoneE164,
        mmoProvider: provider,
        cgvAcceptedVersion: LEGAL_VERSIONS.cgv.version,
      });

      const paiementId = initResult.paiementId;
      setStatus("polling");

      // Poll jusqu'à completed / failed / timeout. Cancellable via ref
      // (B3 audit) — couvre unmount + bouton "Annuler" pendant `polling`.
      let attempts = 0;
      while (attempts < POLL_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (pollingCancelledRef.current) return;
        attempts++;
        const p = await fetchPaiement(paiementId);
        if (pollingCancelledRef.current) return;
        if (!p) continue;
        if (p.statut === "completed") {
          setStatus("applying");
          try {
            const until = await applyBoost({
              paiementId,
              annonceId: annonce.id,
              days: selectedDays,
            });
            if (pollingCancelledRef.current) return;
            setNewBoostUntil(until);
            setStatus("success");
          } catch (e) {
            setStatus("error");
            setErrorMsg(
              mapApplyBoostError(e instanceof Error ? e.message : "")
            );
          }
          return;
        }
        if (p.statut === "failed") {
          setStatus("error");
          setErrorMsg(
            "Paiement échoué côté Mobile Money. Vérifie ton solde et réessaie."
          );
          return;
        }
      }

      // Timeout
      if (pollingCancelledRef.current) return;
      setStatus("error");
      setErrorMsg(
        "Le paiement prend plus de temps que prévu. Reviens plus tard, le boost s'activera dès que PawaPay confirmera."
      );
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Erreur inconnue.");
    }
  }, [annonce, canPay, cgvAccepted, phoneE164, provider, selectedDays]);

  // B3 audit : tap "Annuler" pendant polling → arrête le poll côté client.
  // Le paiement Mobile Money en cours peut quand même aboutir — si oui, le
  // callback PawaPay déclenche le boost serveur-side (idempotent via paiementId).
  const handleCancelPolling = useCallback(() => {
    pollingCancelledRef.current = true;
    setStatus("idle");
    setErrorMsg(
      "Polling arrêté. Si le paiement aboutit, le boost s'activera quand même côté serveur."
    );
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View className="flex-1 bg-niqo-gray-50">
      <Stack.Screen
        options={{
          title: "Booster",
          headerShown: true,
          headerStyle: { backgroundColor: "#FAFAFA" },
          headerTitleStyle: { fontFamily: "SpaceGrotesk-Bold", color: "#1A1A1A" },
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              className="active:opacity-60"
            >
              <ArrowLeft size={22} color="#1A1A1A" />
            </Pressable>
          ),
        }}
      />

      {annonceLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#D85A30" />
        </View>
      ) : annonceError || !annonce ? (
        <View className="flex-1 items-center justify-center px-6">
          <AlertCircle size={40} color="#E24B4A" strokeWidth={1.8} />
          <Text className="font-display text-h3 text-niqo-black mt-3 text-center">
            Impossible de booster
          </Text>
          <Text className="font-body text-body text-niqo-gray-800 text-center mt-1">
            {annonceError ?? "Annonce introuvable."}
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="mt-5 px-5 py-3 bg-niqo-gray-200 rounded-btn active:opacity-80"
          >
            <Text className="font-body text-label text-niqo-black">Retour</Text>
          </Pressable>
        </View>
      ) : status === "success" ? (
        <SuccessView
          annonce={annonce}
          option={selectedOption}
          newBoostUntil={newBoostUntil}
          onClose={() => router.back()}
        />
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={{
              padding: 16,
              paddingBottom: insets.bottom + 24,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Hero */}
            <View className="items-center mb-5">
              <View className="w-14 h-14 rounded-full bg-niqo-coral-light items-center justify-center mb-3">
                {isBoostActive(annonce) ? (
                  <Sparkles size={28} color="#D85A30" strokeWidth={2.2} />
                ) : (
                  <Zap size={28} color="#D85A30" strokeWidth={2.2} />
                )}
              </View>
              <Text className="font-display text-h2 text-niqo-black text-center">
                {isBoostActive(annonce) ? "Prolonger le boost" : "Booster cette annonce"}
                <Text className="text-niqo-coral">.</Text>
              </Text>
              <Text className="font-body text-body text-niqo-gray-800 text-center mt-1.5 px-4">
                {isBoostActive(annonce)
                  ? "La nouvelle durée s'ajoute à ce qui reste"
                  : "Apparais en haut de l'Accueil et de la Recherche"}
              </Text>
            </View>

            {/* Banner état actif (si déjà boostée) */}
            {isBoostActive(annonce) ? (
              <View className="bg-niqo-coral/5 border border-niqo-coral/30 rounded-2xl px-4 py-3 mb-4 flex-row items-center gap-2.5">
                <Sparkles size={16} color="#D85A30" strokeWidth={2.4} />
                <View className="flex-1">
                  <Text className="font-display text-caption text-niqo-coral">
                    Boost actif
                  </Text>
                  <Text className="font-body text-micro text-niqo-gray-800 mt-0.5">
                    {formatBoostRemaining(annonce.boost_until)}. La durée
                    choisie s&apos;ajoute à la fin.
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Annonce preview — B1 audit : Annonce n'a pas de `cover_url`,
                il faut résoudre depuis photos[0] via le helper Storage. */}
            <View className="bg-niqo-white rounded-2xl p-4 mb-4 border border-niqo-gray-100 flex-row gap-3">
              {annonce.photos[0] ? (
                <Image
                  source={{ uri: getAnnoncePhotoUrl(annonce.photos[0]) }}
                  style={{ width: 60, height: 60, borderRadius: 12 }}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View
                  style={{ width: 60, height: 60, borderRadius: 12 }}
                  className="bg-niqo-gray-100"
                />
              )}
              <View className="flex-1 min-w-0 justify-center">
                <Text
                  className="font-display text-label text-niqo-black"
                  numberOfLines={1}
                >
                  {annonce.titre}
                </Text>
                <Text
                  className="font-mono text-caption text-niqo-coral mt-0.5"
                  allowFontScaling={false}
                >
                  {annonce.prix.toLocaleString("fr-FR")} FCFA
                </Text>
              </View>
            </View>

            {/* Choix durée */}
            <Text className="font-body text-micro text-niqo-gray-500 uppercase tracking-wider mb-2">
              Choisis ta durée
            </Text>
            <View className="gap-2.5 mb-5">
              {BOOST_OPTIONS.map((opt) => {
                const active = selectedDays === opt.days;
                return (
                  <Pressable
                    key={opt.days}
                    onPress={() => setSelectedDays(opt.days)}
                    className={`bg-niqo-white rounded-2xl p-4 border-2 flex-row items-center gap-3 active:opacity-80 ${
                      active
                        ? "border-niqo-coral"
                        : "border-niqo-gray-100"
                    }`}
                  >
                    <View
                      className={`w-5 h-5 rounded-full border-2 items-center justify-center ${
                        active
                          ? "border-niqo-coral bg-niqo-coral"
                          : "border-niqo-gray-200"
                      }`}
                    >
                      {active ? (
                        <Check size={12} color="#FFFFFF" strokeWidth={3} />
                      ) : null}
                    </View>
                    <View className="flex-1">
                      <Text className="font-display text-label text-niqo-black">
                        {opt.shortLabel}
                      </Text>
                      {opt.savingsLabel ? (
                        <Text className="font-body text-micro text-niqo-success mt-0.5">
                          ✓ {opt.savingsLabel}
                        </Text>
                      ) : null}
                    </View>
                    <View className="items-end">
                      <Text
                        className="font-mono text-h3 text-niqo-black"
                        allowFontScaling={false}
                      >
                        {opt.priceFcfa.toLocaleString("fr-FR")}
                      </Text>
                      <Text className="font-mono text-micro text-niqo-gray-500">
                        FCFA
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Provider picker */}
            <Text className="font-body text-micro text-niqo-gray-500 uppercase tracking-wider mb-2">
              Mobile Money
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-3">
              {MMO_PROVIDERS_BY_COUNTRY[country]?.map((p) => {
                const active = provider === p.code;
                return (
                  <Pressable
                    key={p.code}
                    onPress={() => setProvider(p.code)}
                    accessibilityLabel={p.label}
                    className={`px-3.5 h-11 rounded-full border flex-row items-center justify-center gap-2 active:opacity-80 ${
                      active
                        ? "bg-niqo-coral border-niqo-coral"
                        : "bg-niqo-white border-niqo-gray-200"
                    }`}
                  >
                    <MmoLogo code={p.code} height={20} />
                    <Text
                      className={`font-body text-caption ${
                        active ? "text-niqo-white font-medium" : "text-niqo-gray-800"
                      }`}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Numéro */}
            <View className="bg-niqo-white rounded-2xl p-4 border border-niqo-gray-100 flex-row items-center gap-3 mb-2">
              {/* B2 audit : PHONE_CONFIG expose `prefix` pas `dialCode`
                  (le champ a été renommé sans MAJ d'usage ici → undefined
                  affiché en runtime). */}
              <Text
                className="font-mono text-body text-niqo-gray-800"
                allowFontScaling={false}
              >
                {phoneCfg.flag} {phoneCfg.prefix}
              </Text>
              <TextInput
                value={phoneInput}
                /* B5 audit : sanitize digits-only (cohérence /sell + /profile/edit) */
                onChangeText={(t) => setPhoneInput(t.replace(/\D/g, ""))}
                placeholder={phoneCfg.placeholder}
                placeholderTextColor="#888780"
                keyboardType="phone-pad"
                inputMode="tel"
                maxLength={phoneCfg.localDigits}
                style={{ color: "#1A1A1A" }}
                className="flex-1 font-mono text-body"
                allowFontScaling={false}
                editable={status === "idle" || status === "error"}
              />
              {phoneInput && (
                phoneValid ? (
                  <CheckCircle2 size={18} color="#1D9E75" strokeWidth={2.4} />
                ) : (
                  <AlertCircle size={18} color="#E24B4A" strokeWidth={2.4} />
                )
              )}
            </View>
            {phoneInput && !phoneValid ? (
              <Text className="font-body text-micro text-niqo-danger mb-3 ml-2">
                Numéro {country === "CI" ? "ivoirien" : "congolais"} invalide
              </Text>
            ) : (
              <View className="mb-3" />
            )}

            {/* Erreur */}
            {errorMsg ? (
              <View className="bg-niqo-danger/5 border border-niqo-danger/30 rounded-xl px-3.5 py-2.5 mb-3 flex-row gap-2">
                <AlertCircle
                  size={16}
                  color="#E24B4A"
                  strokeWidth={2.2}
                  style={{ marginTop: 2 }}
                />
                <Text className="flex-1 font-body text-caption text-niqo-danger leading-relaxed">
                  {errorMsg}
                </Text>
              </View>
            ) : null}

            {/* Disclaimer */}
            <Text className="font-body text-micro text-niqo-gray-500 leading-relaxed mb-2 px-1">
              Paiement Mobile Money sécurisé via PawaPay. Le boost s&apos;active
              automatiquement après confirmation (≤ 30 secondes).
            </Text>

            <CgvConsentCheckbox
              checked={cgvAccepted}
              onToggle={() => setCgvAccepted((v) => !v)}
              accessibilityHint="Cocher la renonciation au droit de rétractation pour ce boost"
            />

            {/* CTA Payer */}
            <Pressable
              onPress={handlePay}
              disabled={!canPay}
              accessibilityRole="button"
              accessibilityLabel={
                isBoostActive(annonce) ? "Prolonger le boost" : "Payer le boost"
              }
              className={`flex-row items-center justify-center gap-2 rounded-btn min-h-[52px] ${
                canPay
                  ? "bg-niqo-coral active:opacity-80"
                  : "bg-niqo-gray-200"
              }`}
            >
              {status === "initing" || status === "polling" || status === "applying" ? (
                <>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text className="font-body text-label text-niqo-white">
                    {status === "initing"
                      ? "Initialisation…"
                      : status === "polling"
                      ? "En attente PawaPay…"
                      : "Activation du boost…"}
                  </Text>
                </>
              ) : (
                <>
                  <Sparkles size={18} color={canPay ? "#FFFFFF" : "#888780"} strokeWidth={2.2} />
                  <Text
                    className={`font-body text-label ${
                      canPay ? "text-niqo-white" : "text-niqo-gray-500"
                    }`}
                  >
                    {isBoostActive(annonce) ? "Prolonger" : "Payer"}{" "}
                    {selectedOption.priceFcfa.toLocaleString("fr-FR")} FCFA
                  </Text>
                </>
              )}
            </Pressable>

            {/* B3 audit : bouton "Annuler" visible uniquement pendant le
                polling (l'init et l'apply sont rapides et atomiques côté
                server, pas annulables). */}
            {status === "polling" ? (
              <Pressable
                onPress={handleCancelPolling}
                accessibilityRole="button"
                accessibilityLabel="Annuler le polling"
                className="mt-2 min-h-[44px] rounded-btn border border-niqo-gray-300 items-center justify-center active:opacity-60"
              >
                <Text className="font-body text-label text-niqo-gray-800">
                  Annuler
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

// ── Success view ─────────────────────────────────────────────────────────────

function SuccessView({
  annonce,
  option,
  newBoostUntil,
  onClose,
}: {
  annonce: Annonce;
  option: BoostOption;
  newBoostUntil: string | null;
  onClose: () => void;
}) {
  return (
    <View className="flex-1 bg-niqo-coral-light items-center justify-center px-6">
      <View className="w-20 h-20 rounded-full bg-niqo-coral items-center justify-center mb-5">
        <Sparkles size={40} color="#FFFFFF" strokeWidth={2} />
      </View>
      <Text className="font-display text-h1 text-niqo-black text-center">
        Boost activé
        <Text className="text-niqo-coral">.</Text>
      </Text>
      <Text className="font-body text-body text-niqo-gray-800 text-center mt-2 leading-relaxed">
        Ton annonce <Text className="font-medium">{annonce.titre}</Text> est
        maintenant en haut de l&apos;Accueil et de la Recherche pour{" "}
        <Text className="font-medium">{option.shortLabel}</Text>.
      </Text>

      {newBoostUntil ? (
        <View className="mt-5 bg-niqo-white rounded-2xl px-5 py-4 inline-flex flex-row items-center gap-2.5">
          <TrendingUp size={18} color="#D85A30" strokeWidth={2.2} />
          <Text className="font-body text-caption text-niqo-gray-800">
            <Text className="font-medium">{formatBoostRemaining(newBoostUntil)}</Text>
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={onClose}
        className="mt-8 px-6 py-3.5 bg-niqo-coral rounded-btn active:opacity-80"
      >
        <Text className="font-body text-label text-niqo-white">
          Retour à mes annonces
        </Text>
      </Pressable>
    </View>
  );
}
