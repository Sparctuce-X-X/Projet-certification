import { Image } from "expo-image";

import type { MmoProvider } from "@/lib/verification";

const LOGOS: Record<MmoProvider, number> = {
  ORANGE_CIV: require("@/assets/logos/mobile-money/orange-money.png"),
  MTN_MOMO_CIV: require("@/assets/logos/mobile-money/mtn-momo.png"),
  AIRTEL_COG: require("@/assets/logos/mobile-money/airtel-money.png"),
  MTN_MOMO_COG: require("@/assets/logos/mobile-money/mtn-momo.png"),
};

const ASPECT_RATIOS: Record<MmoProvider, number> = {
  ORANGE_CIV: 960 / 257,
  MTN_MOMO_CIV: 150 / 143,
  AIRTEL_COG: 512 / 536,
  MTN_MOMO_COG: 150 / 143,
};

type Props = {
  code: MmoProvider;
  height?: number;
};

export function MmoLogo({ code, height = 20 }: Props) {
  const width = height * ASPECT_RATIOS[code];

  return (
    <Image
      source={LOGOS[code]}
      style={{ width, height }}
      contentFit="contain"
      transition={120}
      accessible
      accessibilityLabel={ACCESSIBILITY_LABELS[code]}
    />
  );
}

const ACCESSIBILITY_LABELS: Record<MmoProvider, string> = {
  ORANGE_CIV: "Logo Orange Money",
  MTN_MOMO_CIV: "Logo MTN Mobile Money",
  AIRTEL_COG: "Logo Airtel Money",
  MTN_MOMO_COG: "Logo MTN Mobile Money",
};
