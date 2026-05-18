import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Politique cookies",
  description:
    "Politique cookies du site web niqo.africa — cookies fonctionnels strictement nécessaires uniquement, aucun tracking publicitaire.",
  alternates: { canonical: "/legal/cookies" },
};

export default function CookiesPage() {
  return <LegalDoc slug="cookies" />;
}
