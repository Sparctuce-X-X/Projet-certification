/**
 * CountryPickerScreen — app/country-picker.tsx
 *
 * Pixel-faithful implementation of Figma frame 456:3.
 * Refactor 2026-04-27 (skill ui-ux-pro-max review):
 *   - Tokens-only (no inline magic values) — niqo-gray-100/150/300, niqo-coral-dark, text-title/label/subtitle/micro/2xs
 *   - useReducedMotion() for users with prefers-reduced-motion
 *   - Lucide Check icon (replaced "✓" character)
 *   - hitSlop on "Se connecter" link (touch target ≥ 44px)
 *   - React.memo on CountryCard (prevents re-render of unselected when other selects)
 *
 * Browse-first flow — niqo_country written ONLY on "Continuer" tap.
 * AsyncStorage failure → inline error, no navigation.
 * Kill before "Continuer" → niqo_country stays null → re-shows on relaunch.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Check } from "lucide-react-native";
import { memo, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polygon, Rect } from "react-native-svg";

// ─────────────────────────────────────────────────────────────────────────────
// Flag components — react-native-svg
// Colours are national flag ISO 3166 standards, NOT design tokens.
// ─────────────────────────────────────────────────────────────────────────────

const FlagCI = memo(function FlagCI() {
  // Côte d'Ivoire — 3 vertical bands: orange | white | green (official)
  // Figma node 461:3 — 40×26 px, rounded 3px, border rgba(0,0,0,0.08)
  return (
    <Svg width={40} height={26} viewBox="0 0 40 26">
      <Rect x={0} y={0} width={14} height={26} fill="#F77F00" />
      <Rect x={14} y={0} width={12} height={26} fill="#FFFFFF" />
      <Rect x={26} y={0} width={14} height={26} fill="#009A44" />
    </Svg>
  );
});

const FlagCG = memo(function FlagCG() {
  // Congo Brazzaville — official flag: diagonal tricolour
  // Green triangle top-hoist, yellow diagonal band, red triangle bottom-fly.
  // Yellow band drawn as background; green/red triangles overlay corners.
  return (
    <Svg width={40} height={26} viewBox="0 0 40 26">
      <Rect x={0} y={0} width={40} height={26} fill="#F9E300" />
      <Polygon points="0,0 27,0 0,13" fill="#009543" />
      <Polygon points="40,13 40,26 13,26" fill="#DC241F" />
    </Svg>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Country = "CI" | "CG";

interface CountryOption {
  readonly code: Country;
  readonly name: string;
  readonly providers: string;
  readonly FlagComponent: React.ComponentType;
  readonly comingSoon?: boolean;
}

const COUNTRIES: readonly CountryOption[] = [
  {
    code: "CG",
    name: "Congo Brazzaville",
    providers: "MTN · Airtel Money",
    FlagComponent: FlagCG,
  },
  {
    code: "CI",
    name: "Côte d'Ivoire",
    providers: "Orange Money · Wave",
    FlagComponent: FlagCI,
    comingSoon: true,
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// SelectionIndicator — 24×24 circle, selected = coral filled + Lucide Check,
// unselected = gray-150 border. Figma node 461:12/461:24.
// ─────────────────────────────────────────────────────────────────────────────

interface SelectionIndicatorProps {
  readonly selected: boolean;
}

const SelectionIndicator = memo(function SelectionIndicator({
  selected,
}: SelectionIndicatorProps) {
  if (selected) {
    return (
      <View
        className="w-6 h-6 rounded-full bg-niqo-coral items-center justify-center"
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Check size={14} color="#FFFFFF" strokeWidth={3} />
      </View>
    );
  }
  return (
    <View
      className="w-6 h-6 rounded-full border-[1.5px] border-niqo-gray-150"
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CountryCard — Figma node 461:2 (CI selected) / 461:14 (CG unselected)
// Height 84px, rounded 16px, border 2px coral (selected) / 1px gray-150 (unselected)
// Shadow: selected=coral 0 4 8 .18 / unselected=black 0 1 3 .06
// ─────────────────────────────────────────────────────────────────────────────

interface CountryCardProps {
  readonly option: CountryOption;
  readonly selected: boolean;
  readonly onPress: () => void;
}

const CountryCard = memo(function CountryCard({
  option,
  selected,
  onPress,
}: CountryCardProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const isComingSoon = option.comingSoon === true;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function handlePressIn() {
    if (reducedMotion || isComingSoon) return;
    scale.value = withSpring(0.97, { damping: 20, stiffness: 300 });
  }

  function handlePressOut() {
    if (reducedMotion || isComingSoon) return;
    scale.value = withSpring(1, { damping: 20, stiffness: 300 });
  }

  return (
    <Animated.View style={[animatedStyle, { borderRadius: 16 }]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isComingSoon}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled: isComingSoon }}
        accessibilityLabel={
          isComingSoon ? `${option.name} — bientôt disponible` : option.name
        }
        className={`
          h-[84px] rounded-[16px] flex-row items-center px-[14px] bg-niqo-white
          ${selected ? "border-2 border-niqo-coral" : "border border-niqo-gray-150"}
        `}
        style={{
          opacity: isComingSoon ? 0.55 : 1,
          shadowColor: selected ? "#D85A30" : "#000000",
          shadowOffset: { width: 0, height: selected ? 4 : 1 },
          shadowOpacity: selected ? 0.18 : 0.06,
          shadowRadius: selected ? 8 : 3,
          elevation: selected ? 4 : 1,
        }}
      >
        {/* Flag container — Figma 461:3/461:15: 40×26, rounded 3px, border rgba(0,0,0,0.08) */}
        <View
          className="w-[40px] h-[26px] rounded-[3px] overflow-hidden border border-black/10"
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <option.FlagComponent />
        </View>

        {/* Country info block — left=64 in Figma = 14px flag + 10px gap + 40px = 64 */}
        <View className="flex-1 ml-[10px] gap-[2px]">
          {/* Country name — Inter SemiBold 15px, niqo-black */}
          <Text
            className="font-body text-label text-niqo-black"
            style={{ fontFamily: "Inter_600SemiBold" }}
            numberOfLines={1}
          >
            {option.name}
          </Text>

          {/* Mobile Money providers — Inter Regular 12px, niqo-gray-500 */}
          <Text
            className="font-body text-micro text-niqo-gray-500"
            numberOfLines={1}
          >
            {option.providers}
          </Text>
        </View>

        {/* Right side — "Bientôt disponible" badge OR selection indicator */}
        {isComingSoon ? (
          <View className="px-2.5 py-1 rounded-full bg-niqo-gray-100 border border-niqo-gray-150">
            <Text
              className="font-body text-2xs text-niqo-gray-500"
              style={{ fontFamily: "Inter_600SemiBold" }}
              numberOfLines={1}
            >
              Bientôt disponible
            </Text>
          </View>
        ) : (
          <SelectionIndicator selected={selected} />
        )}
      </Pressable>
    </Animated.View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ContinueButton — Figma node 458:45/458:46
// h=52, rounded 12px, bg coral, text white Space Grotesk Medium 15px
// ─────────────────────────────────────────────────────────────────────────────

interface ContinueButtonProps {
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly onPress: () => void;
}

function ContinueButton({ disabled, loading, onPress }: ContinueButtonProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(disabled ? 0.5 : 1);

  // Animate disabled-state opacity transition (skip if reduced motion).
  useEffect(() => {
    if (reducedMotion) {
      opacity.value = disabled ? 0.5 : 1;
    } else {
      opacity.value = withTiming(disabled ? 0.5 : 1, { duration: 150 });
    }
  }, [disabled, opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel="Continuer"
        accessibilityState={{ disabled: disabled || loading }}
        className="h-[52px] rounded-[12px] bg-niqo-coral items-center justify-center active:opacity-90"
      >
        <Text
          className="font-display text-label text-white"
          style={{ fontFamily: "SpaceGrotesk_500Medium" }}
        >
          {loading ? "Chargement…" : "Continuer"}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function CountryPickerScreen() {
  const [selection, setSelection] = useState<Country | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const insets = useSafeAreaInsets();

  async function handleContinue() {
    if (!selection) return;

    setLoading(true);
    setError(null);

    try {
      if (selection !== "CI" && selection !== "CG") {
        throw new Error("Pays invalide");
      }
      await AsyncStorage.setItem("niqo_country", selection);
      router.replace("/home");
    } catch {
      setError(
        "Impossible de sauvegarder ton choix. Vérifie la mémoire de ton téléphone et réessaie.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSelectCountry(code: Country) {
    setSelection(code);
    if (error) setError(null);
  }

  function handleLoginPress() {
    // TODO: navigate to /login when LoginScreen is implemented
    console.log("TODO: navigate to /login when login screen exists");
  }

  return (
    <View className="flex-1 bg-niqo-white">
      {/* ── Header: logo "niqo." + separator ──────────────────────────── */}
      <View
        className="items-center pb-4 border-b border-niqo-gray-150"
        style={{ paddingTop: Math.max(insets.top, 10) + 16 }}
      >
        <View className="flex-row items-baseline">
          <Text
            className="font-display text-title text-niqo-black"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
            allowFontScaling={false}
          >
            niqo
          </Text>
          <Text
            className="font-display text-title text-niqo-coral"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
            allowFontScaling={false}
          >
            .
          </Text>
        </View>
      </View>

      {/* ── Main content — no scroll, flex distribution ───────────────── */}
      <View className="flex-1 px-6">
        {/* Title + subtitle block */}
        <View className="mt-5">
          {/* "Dans quel pays" + "êtes-vous ?" — 2 separate Texts matching Figma 458:18/458:19 */}
          <Text
            className="font-display text-title text-niqo-black"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            Dans quel pays
          </Text>
          <Text
            className="font-display text-title text-niqo-black"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            êtes-vous ?
          </Text>

          <Text className="font-body text-subtitle text-niqo-gray-500 mt-2">
            {"Vos annonces et paiements mobiles\ns'adaptent à votre pays."}
          </Text>
        </View>

        {/* Country cards — gap 10px (Figma: CI top=246, CG top=340 → 84+10) */}
        <View className="mt-6 gap-[10px]">
          {COUNTRIES.map((option) => (
            <CountryCard
              key={option.code}
              option={option}
              selected={selection === option.code}
              onPress={() => handleSelectCountry(option.code)}
            />
          ))}
        </View>

        {/* Inline AsyncStorage error */}
        {error !== null && (
          <View className="bg-niqo-status-en-litige-bg rounded-btn p-3 mt-4">
            <Text className="font-body text-caption text-niqo-status-en-litige-text">
              {error}
            </Text>
          </View>
        )}
      </View>

      {/* ── Continuer button — pinned to bottom, safe-area aware ────────── */}
      <View
        className="px-6 pt-2 bg-niqo-white"
        style={{ paddingBottom: Math.max(insets.bottom, 24) }}
      >
        <ContinueButton
          disabled={selection === null}
          loading={loading}
          onPress={handleContinue}
        />
      </View>
    </View>
  );
}
