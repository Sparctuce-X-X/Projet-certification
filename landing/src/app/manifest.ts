import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Niqo — La marketplace de confiance en Afrique",
    short_name: "Niqo",
    description:
      "Achète et vends entre particuliers en toute confiance. Vendeurs vérifiés, messagerie sécurisée, RDV en personne.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#D85A30",
    lang: "fr",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
