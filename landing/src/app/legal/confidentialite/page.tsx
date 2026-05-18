import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description:
    "Politique de confidentialité Niqo — traitement des données personnelles conforme aux lois ARTCI (CI), ANRTIC (CG) et NCSA (Rwanda).",
  alternates: { canonical: "/legal/confidentialite" },
};

export default function ConfidentialitePage() {
  return <LegalDoc slug="confidentialite" />;
}
