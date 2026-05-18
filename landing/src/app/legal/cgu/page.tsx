import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation",
  description:
    "Conditions générales d'utilisation de la plateforme Niqo — marketplace C2C entre particuliers en Côte d'Ivoire et au Congo Brazzaville.",
  alternates: { canonical: "/legal/cgu" },
};

export default function CGUPage() {
  return <LegalDoc slug="cgu" />;
}
