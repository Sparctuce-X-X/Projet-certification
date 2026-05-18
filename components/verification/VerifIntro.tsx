import {
  BadgeCheck,
  Check,
  Infinity,
  ShieldCheck,
  Square,
  TrendingUp,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
  UNVERIFIED_ANNONCES_CAP,
  VERIFICATION_PRICE_FCFA,
  VERIFICATION_SLA_HOURS,
} from "@/lib/verification";

interface VerifIntroProps {
  onStart: () => void;
}

/**
 * Step 1 — Pitch + consent + CTA "Commencer".
 *
 * Pattern d'écran : ScrollView pour le contenu (déborde sur petits viewports
 * 640px) + CTA sticky bottom hors du scroll, avec border-top pour séparation
 * visuelle. Ça garantit que le bouton reste accessible quel que soit le device.
 *
 * Disclosures alignées CDC v4.0 §2.6 + lois RGPD CI 2024-30 / CG 2023-15 :
 *   - Prix affiché clairement
 *   - "Non remboursable" mentionné dans le bloc paiement
 *   - SLA 24h annoncé
 *   - Consent RGPD = checkbox DÉCOCHÉE par défaut
 */
export function VerifIntro({ onStart }: VerifIntroProps) {
  const [consentGiven, setConsentGiven] = useState(false);

  return (
    <View className="flex-1 bg-niqo-white">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View className="w-14 h-14 rounded-full bg-niqo-success/10 items-center justify-center mb-5">
          <ShieldCheck size={28} color="#1D9E75" strokeWidth={2.2} />
        </View>
        <Text className="font-display text-h1 text-niqo-black leading-tight">
          Deviens vendeur{" "}
          <Text className="text-niqo-success">vérifié</Text>
          <Text className="text-niqo-coral">.</Text>
        </Text>
        <Text className="mt-3 font-body text-body text-niqo-gray-800 leading-relaxed">
          Une CNI, un selfie, {VERIFICATION_PRICE_FCFA.toLocaleString("fr-FR")}{" "}
          FCFA. Validation sous {VERIFICATION_SLA_HOURS}h. Bénéfice à vie.
        </Text>

        {/* 3 bullets bénéfices */}
        <View className="mt-7 gap-4">
          <BulletRow
            icon={<BadgeCheck size={20} color="#D85A30" strokeWidth={2.2} />}
            title="Badge Vendeur Vérifié à vie"
            subtitle="Affiché sur ton profil et toutes tes annonces."
          />
          <BulletRow
            icon={<Infinity size={20} color="#D85A30" strokeWidth={2.2} />}
            title="Annonces illimitées"
            subtitle={`Non vérifié, tu es plafonné à ${UNVERIFIED_ANNONCES_CAP} annonces simultanées.`}
          />
          <BulletRow
            icon={<TrendingUp size={20} color="#D85A30" strokeWidth={2.2} />}
            title="Plus de contacts acheteurs"
            subtitle="Les acheteurs filtrent par badge — tes annonces sortent en priorité."
          />
        </View>

        {/* Bloc tarif */}
        <View className="mt-8 bg-niqo-coral-light rounded-card p-5">
          <View className="flex-row items-baseline gap-2">
            <Text
              className="font-mono text-h1 text-niqo-black"
              allowFontScaling={false}
            >
              {VERIFICATION_PRICE_FCFA.toLocaleString("fr-FR")}
            </Text>
            <Text className="font-mono text-label text-niqo-black">FCFA</Text>
            <Text className="ml-auto font-body text-micro text-niqo-coral uppercase tracking-wider">
              paiement unique
            </Text>
          </View>
          <Text className="mt-3 font-body text-micro text-niqo-gray-800 leading-relaxed">
            Paiement Mobile Money (Orange Money, MTN, Moov, Airtel). Non
            remboursable, même en cas de refus de la vérification.
          </Text>
        </View>

        {/* Consent RGPD — checkbox DÉCOCHÉE par défaut */}
        <Pressable
          onPress={() => setConsentGiven((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consentGiven }}
          accessibilityLabel="J'accepte le traitement de mes données d'identité"
          className="mt-7 flex-row items-start gap-3 active:opacity-70"
        >
          {consentGiven ? (
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                backgroundColor: "#D85A30",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Check size={14} color="#FFFFFF" strokeWidth={3} />
            </View>
          ) : (
            <Square size={22} color="#888780" strokeWidth={1.8} />
          )}
          <Text className="flex-1 font-body text-caption text-niqo-gray-800 leading-relaxed">
            J&apos;accepte que Niqo conserve ma CNI chiffrée pour validation par
            l&apos;équipe d&apos;administration. Durée de conservation : 30 jours
            en cas de refus, 6 mois après validation. Conforme aux lois ARTCI
            2024-30 (Côte d&apos;Ivoire) et ANRTIC 2023-15 (Congo).
          </Text>
        </Pressable>
      </ScrollView>

      {/* CTA sticky bottom — toujours visible, hors scroll */}
      <View className="px-4 pt-3 pb-6 border-t border-niqo-gray-200 bg-niqo-white">
        <Pressable
          onPress={onStart}
          disabled={!consentGiven}
          accessibilityRole="button"
          accessibilityLabel="Commencer la vérification"
          accessibilityState={{ disabled: !consentGiven }}
          className={`min-h-[52px] flex-row items-center justify-center gap-2 rounded-btn ${
            consentGiven
              ? "bg-niqo-coral active:opacity-80"
              : "bg-niqo-gray-200"
          }`}
        >
          <Text
            className={`font-body text-label ${
              consentGiven ? "text-niqo-white" : "text-niqo-gray-500"
            }`}
          >
            Commencer
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function BulletRow({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="w-9 h-9 rounded-full bg-niqo-coral-light items-center justify-center mt-0.5">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="font-display text-label text-niqo-black">
          {title}
        </Text>
        <Text className="mt-0.5 font-body text-micro text-niqo-gray-800 leading-relaxed">
          {subtitle}
        </Text>
      </View>
    </View>
  );
}
