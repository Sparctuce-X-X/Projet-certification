import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal/LegalDoc";

export const metadata: Metadata = {
  title: "Mentions légales",
  description:
    "Mentions légales Niqo — éditeur, hébergeurs, prestataires techniques, directeur de la publication.",
  alternates: { canonical: "/legal/mentions-legales" },
};

export default function MentionsLegalesPage() {
  return <LegalDoc slug="mentions-legales" />;
}
