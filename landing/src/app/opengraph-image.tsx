import { ImageResponse } from "next/og";

export const alt =
  "Niqo — La marketplace de confiance à Brazzaville";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background:
            "radial-gradient(circle at 78% 20%, #D85A30 0%, #A8421F 25%, #1A1A1A 60%, #1A1A1A 100%)",
          color: "#FFFFFF",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span
            style={{
              fontSize: 96,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: "#FFFFFF",
              lineHeight: 1,
            }}
          >
            niqo
          </span>
          <span
            style={{
              fontSize: 96,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: "#D85A30",
              lineHeight: 1,
            }}
          >
            .
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              columnGap: 24,
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: "-0.035em",
              lineHeight: 1.02,
              maxWidth: 1040,
            }}
          >
            <span>Achète. Vends.</span>
            <span style={{ color: "#D85A30" }}>En confiance.</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 32,
              color: "rgba(255,255,255,0.78)",
            }}
          >
            <span
              style={{
                display: "flex",
                width: 12,
                height: 12,
                background: "#1D9E75",
                borderRadius: 999,
              }}
            />
            <span>Brazzaville · République du Congo</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: "rgba(255,255,255,0.6)",
            letterSpacing: "0.02em",
          }}
        >
          <span>Vendeurs vérifiés · Chat sécurisé · RDV en personne</span>
          <span style={{ color: "#FFFFFF", fontWeight: 600 }}>niqo.africa</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
