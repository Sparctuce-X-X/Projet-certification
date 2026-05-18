import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Charte communautaire",
  description:
    "Règles de bonne conduite et liste détaillée des biens interdits sur Niqo (Côte d'Ivoire et Congo Brazzaville).",
  alternates: { canonical: "/legal/charte-communautaire" },
};

export default function CharteCommunautairePage() {
  return <LegalDoc slug="charte-communautaire" />;
}
