import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // Supabase Storage signed URLs (admin /admin/verifications/[id])
      { protocol: "https", hostname: "uokauzmafppukgsemugz.supabase.co" },
    ],
  },
  async headers() {
    return [
      {
        // Back-office privé : empêche l'indexation même si un crawler ignore robots.txt
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

// Wrap Sentry — auto-injection du SDK + upload source maps au build prod.
// L'upload nécessite SENTRY_AUTH_TOKEN défini dans Vercel Environment
// Variables (Settings → Environment Variables, scope Production + Preview).
// Sans ce token, le build n'échoue PAS — l'upload est juste skip silencieusement.
//
// Note Next.js 16 + Turbopack : plusieurs options webpack-only de Sentry sont
// silently ignorées en Turbopack (build par défaut). Sentry 10.x s'en charge,
// pas de warning bloquant.
export default withSentryConfig(nextConfig, {
  org: "niqo",
  project: "niqo-admin",
  // Pas de logs Sentry pendant `next dev` local (sauf en CI).
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Inclut les fichiers Next.js internes dans l'upload de source maps —
  // utile pour symboliser des stacks qui passent par du code framework.
  widenClientFileUpload: true,
});
