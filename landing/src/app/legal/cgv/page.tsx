import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Conditions générales de vente",
  description:
    "Conditions générales de vente des services payants Niqo : vérification d'identité, boost annonce, levée de suspension.",
  alternates: { canonical: "/legal/cgv" },
};

export default function CGVPage() {
  return <LegalDoc slug="cgv" />;
}
