/**
 * SplashScreen — app/index.tsx
 *
 * "Code Reveal" — narrative escrow Niqo.
 *
 * 6 placeholders coraux apparaissent comme un code de confirmation en attente
 * (signature feature Niqo : code 6 chars qui débloque l'escrow). Une cascade
 * synchrone transforme chaque placeholder en caractère monospace blanc, révélant
 * "niqo." (les 4 premières lettres + le point coral, le 6ème slot reste vide).
 * Le mono row se résorbe et le wordmark display final émerge — métaphore directe
 * "le code → la marque qui sécurise les codes".
 *
 * Animation timeline (2.0 s total, on possède la timeline — Figma 1-6 supprimé) :
 *
 *   t=0.0–0.4 s  6 dots coraux fade-in stagger (50ms entre chaque)
 *   t=0.5–0.7 s  Pulse synchronisé scale 1→1.15→1 ("code en attente")
 *   t=0.8–1.5 s  Cascade reveal : dots → caractères mono blanc/coral
 *                Slots 1-4: n, i, q, o (white) · 5: . (coral) · 6: empty
 *   t=1.5–1.8 s  Mono fade-out + scale-down · display wordmark emerge (overshoot)
 *                Haptic Light à t=1.7 s — pic de l'overshoot, "la marque atterrit"
 *   t=1.8–2.0 s  Tagline "ACHÈTE EN SÉCURITÉ" fade-up + translateY
 *   t=2.0 s      Navigation déclenchée
 *
 * Easing : OVERSHOOT_EASING (0.34, 1.56, 0.64, 1) sur scale, EASE_OUT ailleurs.
 *
 * UX hardening :
 *   - useReducedMotion : état final immédiat (display wordmark + tagline visibles)
 *   - AsyncStorage timeout 5s : pas de hang infini si la lecture est bloquée
 *   - A11y : annonce screen reader unifiée "Niqo, achète en sécurité"
 *   - StatusBar light : icônes système claires sur fond Niqo Black
 *   - Cleanup useEffect : clearTimeout des timers haptic + reduced-motion sur unmount
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const OVERSHOOT_EASING = Easing.bezier(0.34, 1.56, 0.64, 1);
const EASE_OUT = Easing.out(Easing.quad);

const STORAGE_READ_TIMEOUT_MS = 5000;
const REDUCED_MOTION_MIN_DISPLAY_MS = 300;

// 6 slots — métaphore du code de confirmation Niqo (6 caractères).
// 5 lettres composant la marque + 1 vide qui s'efface en fin de cascade :
// "Niqo n'a pas besoin de 6 chars pour exister, seulement 5."
const SLOTS = ["n", "i", "q", "o", ".", ""] as const;
const SLOT_COUNT = SLOTS.length;

// Largeur d'un slot (px). 6 × 24 = 144 px de row, proche du wordmark display.
const SLOT_WIDTH = 24;

type Country = "CI" | "CG";
type Destination = "/country-picker" | "/home";

function isValidCountry(value: string | null): value is Country {
  return value === "CI" || value === "CG";
}

async function resolveDestination(): Promise<Destination> {
  try {
    const stored = await Promise.race<string | null>([
      AsyncStorage.getItem("niqo_country"),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), STORAGE_READ_TIMEOUT_MS),
      ),
    ]);
    return isValidCountry(stored) ? "/home" : "/country-picker";
  } catch {
    return "/country-picker";
  }
}

// ── CodeSlot ─────────────────────────────────────────────────────────
// Un slot = un placeholder coral + un caractère mono superposés.
// Toutes les anims sont dérivées des shared values parents via interpolate
// → un seul timing parent par phase, déclenchement individuel par index.
type CodeSlotProps = {
  index: number;
  char: (typeof SLOTS)[number];
  dotsAppear: SharedValue<number>;
  dotsPulse: SharedValue<number>;
  cascadeProgress: SharedValue<number>;
  monoOpacity: SharedValue<number>;
};

function CodeSlot({
  index,
  char,
  dotsAppear,
  dotsPulse,
  cascadeProgress,
  monoOpacity,
}: CodeSlotProps) {
  // Phase 1 (dotsAppear 0→1) : chaque dot apparaît avec 50ms de stagger.
  // Window de chaque dot = [index/SLOT_COUNT, +0.5]
  const appearStart = index / SLOT_COUNT;
  const appearEnd = appearStart + 0.5;

  // Phase 3 (cascadeProgress 0→1) : transformation dot→char.
  // Chaque slot occupe une window de ~30% du progress, espacée par index.
  // Slot 0 démarre à 0, slot 5 démarre à 0.7 → tous finissent avant 1.0.
  const transformStart = (index / SLOT_COUNT) * 0.85;
  const dotOutEnd = transformStart + 0.15;
  const charInStart = transformStart + 0.1;
  const charInEnd = charInStart + 0.2;

  const dotStyle = useAnimatedStyle(() => {
    const appear = interpolate(
      dotsAppear.value,
      [appearStart, appearEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const pulse = interpolate(dotsPulse.value, [0, 0.5, 1], [1, 1.15, 1]);
    const dotOut = interpolate(
      cascadeProgress.value,
      [transformStart, dotOutEnd],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity: appear,
      transform: [{ scale: appear * pulse * dotOut }],
    };
  });

  const charStyle = useAnimatedStyle(() => {
    const charIn = interpolate(
      cascadeProgress.value,
      [charInStart, charInEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: charIn * monoOpacity.value,
      transform: [{ scale: charIn }],
    };
  });

  const isPeriod = char === ".";

  return (
    <View
      style={{ width: SLOT_WIDTH, height: 48 }}
      className="items-center justify-center"
    >
      <Animated.View
        style={[dotStyle, StyleSheet.absoluteFill]}
        className="items-center justify-center"
      >
        <View className="w-2 h-2 rounded-full bg-niqo-coral" />
      </Animated.View>
      {char !== "" && (
        <Animated.View
          style={[charStyle, StyleSheet.absoluteFill]}
          className="items-center justify-center"
        >
          <Text
            className={
              isPeriod
                ? "font-mono text-h2 text-niqo-coral"
                : "font-mono text-h2 text-niqo-white"
            }
            allowFontScaling={false}
          >
            {char}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

export default function SplashScreenView() {
  const reducedMotion = useReducedMotion();

  // Shared values pilotant chaque phase
  const dotsAppear = useSharedValue(0);
  const dotsPulse = useSharedValue(0);
  const cascadeProgress = useSharedValue(0);
  const monoOpacity = useSharedValue(1);
  const monoRowScale = useSharedValue(1);
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkScale = useSharedValue(0.96);
  const taglineOpacity = useSharedValue(0);
  const taglineTranslateY = useSharedValue(10);

  const monoRowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: monoRowScale.value }],
  }));

  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ scale: wordmarkScale.value }],
  }));

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateY: taglineTranslateY.value }],
  }));

  function navigateAfterSplash(destination: Destination) {
    router.replace(destination);
  }

  useEffect(() => {
    const destinationPromise = resolveDestination();
    const startedAt = Date.now();
    let reducedMotionTimerId: ReturnType<typeof setTimeout> | undefined;
    let hapticTimerId: ReturnType<typeof setTimeout> | undefined;

    if (reducedMotion) {
      // État final immédiat — display wordmark + tagline visibles, mono caché.
      dotsAppear.value = 0;
      cascadeProgress.value = 0;
      monoOpacity.value = 0;
      wordmarkOpacity.value = 1;
      wordmarkScale.value = 1;
      taglineOpacity.value = 1;
      taglineTranslateY.value = 0;

      destinationPromise.then((destination) => {
        const elapsed = Date.now() - startedAt;
        const wait = Math.max(0, REDUCED_MOTION_MIN_DISPLAY_MS - elapsed);
        reducedMotionTimerId = setTimeout(
          () => navigateAfterSplash(destination),
          wait,
        );
      });
      return () => {
        if (reducedMotionTimerId) clearTimeout(reducedMotionTimerId);
      };
    }

    // Phase 1 (t=0–0.4s) : 6 dots fade-in stagger (driven par interpolate dans CodeSlot)
    dotsAppear.value = withTiming(1, { duration: 400, easing: EASE_OUT });

    // Phase 2 (t=0.5–0.7s) : pulse synchronisé "code en attente"
    dotsPulse.value = withDelay(
      500,
      withSequence(
        withTiming(1, { duration: 100, easing: EASE_OUT }),
        withTiming(0, { duration: 100, easing: EASE_OUT }),
      ),
    );

    // Phase 3 (t=0.8–1.5s) : cascade reveal — dots → caractères mono
    cascadeProgress.value = withDelay(
      800,
      withTiming(1, { duration: 700, easing: EASE_OUT }),
    );

    // Phase 4 (t=1.5–1.8s) : mono fade-out + display wordmark emerge.
    // Haptic Light à t=1.7 s (pic de l'overshoot du wordmark — "atterrissage").
    hapticTimerId = setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
        // Haptique indisponible (émulateur, hardware off) — silent.
      });
    }, 1700);

    monoOpacity.value = withDelay(
      1500,
      withTiming(0, { duration: 200, easing: EASE_OUT }),
    );
    monoRowScale.value = withDelay(
      1500,
      withTiming(0.95, { duration: 250, easing: EASE_OUT }),
    );
    wordmarkOpacity.value = withDelay(
      1550,
      withTiming(1, { duration: 200, easing: EASE_OUT }),
    );
    wordmarkScale.value = withDelay(
      1550,
      withTiming(1, { duration: 250, easing: OVERSHOOT_EASING }),
    );

    // Phase 5 (t=1.8–2.0s) : tagline + navigation
    function handleAnimationDone() {
      destinationPromise.then((destination) => {
        navigateAfterSplash(destination);
      });
    }

    taglineOpacity.value = withDelay(
      1800,
      withTiming(1, { duration: 200 }, (finished) => {
        if (finished) {
          runOnJS(handleAnimationDone)();
        }
      }),
    );
    taglineTranslateY.value = withDelay(
      1800,
      withTiming(0, { duration: 200, easing: EASE_OUT }),
    );

    return () => {
      if (hapticTimerId) clearTimeout(hapticTimerId);
    };
    // navigateAfterSplash is stable (no captured deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  return (
    <>
      <StatusBar style="light" />
      <View
        className="flex-1 bg-niqo-black items-center justify-center"
        // Single screen-reader element : "Niqo, achète en sécurité" once,
        // not 6 mono chars + display wordmark + tagline read separately.
        accessibilityRole="image"
        accessibilityLabel="Niqo, achète en sécurité"
      >
        {/* Conteneur central — mono row et display wordmark superposés */}
        <View
          style={{ width: SLOT_WIDTH * SLOT_COUNT, height: 80 }}
          className="items-center justify-center"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {/* Mono code row (Phase 1-3, fades out Phase 4) */}
          <Animated.View
            style={[
              monoRowStyle,
              StyleSheet.absoluteFill,
              { alignItems: "center", justifyContent: "center" },
            ]}
          >
            <View className="flex-row items-center">
              {SLOTS.map((char, i) => (
                <CodeSlot
                  key={i}
                  index={i}
                  char={char}
                  dotsAppear={dotsAppear}
                  dotsPulse={dotsPulse}
                  cascadeProgress={cascadeProgress}
                  monoOpacity={monoOpacity}
                />
              ))}
            </View>
          </Animated.View>

          {/* Display wordmark (Phase 4 emerge, persiste jusqu'à navigation) */}
          <Animated.View
            style={[
              wordmarkStyle,
              StyleSheet.absoluteFill,
              { alignItems: "center", justifyContent: "center" },
            ]}
          >
            <View className="flex-row items-baseline">
              <Text
                className="font-display text-display text-niqo-white"
                style={{ letterSpacing: -1.5 }}
                allowFontScaling={false}
              >
                niqo
              </Text>
              <Text
                className="font-display text-display text-niqo-coral"
                allowFontScaling={false}
              >
                .
              </Text>
            </View>
          </Animated.View>
        </View>

        {/* Tagline (Phase 5) */}
        <Animated.Text
          style={taglineStyle}
          className="font-body text-caption text-niqo-gray-500 tracking-widest mt-6"
          allowFontScaling={false}
        >
          ACHÈTE EN SÉCURITÉ
        </Animated.Text>
      </View>
    </>
  );
}
