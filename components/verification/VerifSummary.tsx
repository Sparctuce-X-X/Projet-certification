import { Image } from "expo-image";
import { AlertTriangle, CheckCircle2, Edit3 } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import {
  PHONE_CONFIG,
  formatPhoneDisplay,
  localPhoneDigits,
  normalizePhone,
  type Country,
} from "@/lib/phone";
import {
  MMO_PROVIDERS_BY_COUNTRY,
  VERIFICATION_PRICE_FCFA,
  type MmoProvider,
} from "@/lib/verification";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { CgvConsentCheckbox } from "@/components/payment/CgvConsentCheckbox";
import { MmoLogo } from "@/components/payment/MmoLogo";

interface VerifSummaryProps {
  rectoUri: string;
  versoUri: string;
  selfieUri: string;
  /** Pré-rempli depuis users.telephone (E.164) si dispo */
  initialPhoneE164: string | null;
  /** Pays user (CI ou CG) — pour le préfixe, la validation, et la liste MMO */
  country: Country;
  /** L'orchestrateur ouvre la step caméra correspondante */
  onEditRecto: () => void;
  onEditVerso: () => void;
  onEditSelfie: () => void;
  /** Lance le paiement (orchestrateur fait l'init Edge Function) */
  onPay: (phoneE164: string, mmoProvider: MmoProvider, cgvAcceptedVersion: string) => Promise<void>;
}

/**
 * Step 5 — Récap des 3 captures + saisie numéro Mobile Money + paiement.
 *
 * Hiérarchie :
 *   1. Titre h1
 *   2. 3 lignes thumbnail + checkmark + "Modifier"
 *   3. Bloc paiement (montant mono large + bullets)
 *   4. Input numéro Mobile Money
 *   5. Disclosure "non remboursable" (3ème occurrence du wizard)
 *   6. CTA sticky "Payer X FCFA via Mobile Money"
 */
export function VerifSummary({
  rectoUri,
  versoUri,
  selfieUri,
  initialPhoneE164,
  country,
  onEditRecto,
  onEditVerso,
  onEditSelfie,
  onPay,
}: VerifSummaryProps) {
  const config = PHONE_CONFIG[country];
  const providers = MMO_PROVIDERS_BY_COUNTRY[country];
  const [phoneInput, setPhoneInput] = useState<string>(
    localPhoneDigits(initialPhoneE164)
  );
  const [selectedProvider, setSelectedProvider] =
    useState<MmoProvider | null>(null);
  const [cgvAccepted, setCgvAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneE164 = normalizePhone(country, phoneInput);
  const canPay =
    phoneE164 !== null && selectedProvider !== null && cgvAccepted && !submitting;

  const handlePay = async () => {
    if (!phoneE164 || !selectedProvider || !cgvAccepted || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onPay(phoneE164, selectedProvider, LEGAL_VERSIONS.cgv.version);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Le paiement n'a pas pu être initié. Réessaie."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-niqo-white"
    >
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-display text-h1 text-niqo-black leading-tight">
          Vérification d&apos;identité<Text className="text-niqo-coral">.</Text>
        </Text>
        <Text className="mt-2 font-body text-body text-niqo-gray-800">
          Vérifie tes pièces avant le paiement.
        </Text>

        {/* 3 lignes captures */}
        <View className="mt-6 bg-niqo-gray-50 rounded-card overflow-hidden">
          <CaptureRow
            uri={rectoUri}
            label="CNI recto"
            onEdit={onEditRecto}
            isFirst
          />
          <View className="h-px bg-niqo-gray-200 mx-4" />
          <CaptureRow uri={versoUri} label="CNI verso" onEdit={onEditVerso} />
          <View className="h-px bg-niqo-gray-200 mx-4" />
          <CaptureRow
            uri={selfieUri}
            label="Selfie"
            onEdit={onEditSelfie}
            isLast
          />
        </View>

        {/* Bloc paiement */}
        <View className="mt-6 bg-niqo-coral-light rounded-card p-5">
          <Text className="font-body text-micro uppercase tracking-wider text-niqo-coral">
            Tu vas payer
          </Text>
          <View className="flex-row items-baseline gap-2 mt-1">
            <Text
              className="font-mono text-h1 text-niqo-black"
              allowFontScaling={false}
            >
              {VERIFICATION_PRICE_FCFA.toLocaleString("fr-FR")}
            </Text>
            <Text className="font-mono text-label text-niqo-black">FCFA</Text>
          </View>

          {/* Sélecteur opérateur */}
          <Text className="mt-5 font-body text-micro font-medium text-niqo-gray-800">
            Opérateur Mobile Money
          </Text>
          <View className="mt-2 flex-row gap-2">
            {providers.map((p) => {
              const active = selectedProvider === p.code;
              return (
                <Pressable
                  key={p.code}
                  onPress={() => setSelectedProvider(p.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={p.label}
                  className={`flex-1 min-h-[56px] flex-row items-center justify-center gap-2 rounded-btn border-2 px-3 active:opacity-70 ${
                    active
                      ? "bg-niqo-coral border-niqo-coral"
                      : "bg-niqo-white border-niqo-gray-200"
                  }`}
                >
                  <MmoLogo code={p.code} height={22} />
                  <Text
                    className={`font-display text-label ${
                      active ? "text-niqo-white" : "text-niqo-gray-800"
                    }`}
                  >
                    {p.shortLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Numéro Mobile Money */}
          <Text className="mt-4 font-body text-micro font-medium text-niqo-gray-800">
            Numéro{" "}
            {selectedProvider
              ? providers.find((p) => p.code === selectedProvider)?.shortLabel
              : "Mobile Money"}
          </Text>
          <View className="mt-2 flex-row items-center bg-niqo-white rounded-btn border border-niqo-gray-200 overflow-hidden">
            <View className="px-3 h-12 flex-row items-center justify-center border-r border-niqo-gray-200">
              <Text className="font-mono text-label text-niqo-black">
                {config.prefix}
              </Text>
            </View>
            <TextInput
              value={phoneInput}
              onChangeText={(t) => {
                setPhoneInput(t.replace(/\D/g, ""));
                setError(null);
              }}
              placeholder={config.placeholder}
              placeholderTextColor="#888780"
              keyboardType="phone-pad"
              inputMode="tel"
              maxLength={config.localDigits}
              className="flex-1 px-3 h-12 font-mono text-label"
              style={{ color: "#1A1A1A" }}
              accessibilityLabel="Numéro Mobile Money"
            />
          </View>
          {phoneE164 ? (
            <Text className="mt-1.5 font-body text-micro text-niqo-success">
              ✓ {formatPhoneDisplay(phoneE164)}
            </Text>
          ) : phoneInput.length > 0 ? (
            <Text className="mt-1.5 font-body text-micro text-niqo-danger">
              Numéro {country === "CI" ? "ivoirien" : "congolais"} invalide
            </Text>
          ) : null}
        </View>

        {/* Disclaimer non remboursable — 3ème occurrence */}
        <View className="mt-5 flex-row items-start gap-2 px-1">
          <AlertTriangle size={14} color="#888780" strokeWidth={2.2} />
          <Text className="flex-1 font-body text-micro text-niqo-gray-500 leading-relaxed">
            Paiement non remboursable, même en cas de refus de la vérification.
          </Text>
        </View>

        <CgvConsentCheckbox
          checked={cgvAccepted}
          onToggle={() => setCgvAccepted((v) => !v)}
          accessibilityHint="Cocher la renonciation au droit de rétractation pour cette vérification"
        />

        {error ? (
          <Text className="mt-3 font-body text-micro text-niqo-danger">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      {/* CTA sticky bottom */}
      <View className="px-4 pt-3 pb-6 border-t border-niqo-gray-200 bg-niqo-white">
        <Pressable
          onPress={handlePay}
          disabled={!canPay}
          accessibilityRole="button"
          accessibilityLabel={`Payer ${VERIFICATION_PRICE_FCFA} FCFA via Mobile Money`}
          accessibilityState={{ disabled: !canPay }}
          className={`min-h-[52px] flex-row items-center justify-center gap-2 rounded-btn ${
            canPay ? "bg-niqo-coral active:opacity-80" : "bg-niqo-gray-200"
          }`}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              className={`font-body text-label ${
                canPay ? "text-niqo-white" : "text-niqo-gray-500"
              }`}
            >
              Payer {VERIFICATION_PRICE_FCFA.toLocaleString("fr-FR")} FCFA via
              Mobile Money
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function CaptureRow({
  uri,
  label,
  onEdit,
  isFirst,
  isLast,
}: {
  uri: string;
  label: string;
  onEdit: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3 ${
        isFirst ? "pt-4" : ""
      } ${isLast ? "pb-4" : ""}`}
    >
      <View className="relative">
        <View className="w-14 h-14 rounded-md overflow-hidden bg-niqo-gray-100">
          <Image
            source={{ uri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={120}
          />
        </View>
        <View className="absolute -bottom-1 -right-1 bg-niqo-white rounded-full">
          <CheckCircle2 size={18} color="#1D9E75" fill="#1D9E75" />
        </View>
      </View>
      <View className="flex-1">
        <Text className="font-display text-label text-niqo-black">
          {label}
        </Text>
        <Text className="font-body text-micro text-niqo-success">
          Capturé
        </Text>
      </View>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Refaire la photo ${label}`}
        hitSlop={8}
        className="flex-row items-center gap-1 min-h-[44px] px-3 active:opacity-60"
      >
        <Edit3 size={14} color="#D85A30" strokeWidth={2.2} />
        <Text className="font-body text-micro font-semibold text-niqo-coral">
          Modifier
        </Text>
      </Pressable>
    </View>
  );
}
