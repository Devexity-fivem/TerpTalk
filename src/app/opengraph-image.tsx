import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "TerpTalk — Cannabis Growing Community"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0f0b 0%, #122016 60%, #0d1f14 100%)",
          fontFamily: "sans-serif",
        }}
      >
        {/* leaf accent */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 120,
            height: 120,
            borderRadius: 28,
            background: "rgba(52, 211, 153, 0.15)",
            border: "2px solid rgba(52, 211, 153, 0.4)",
            marginBottom: 36,
            fontSize: 64,
          }}
        >
          🌿
        </div>
        <div
          style={{
            fontSize: 84,
            fontWeight: 800,
            color: "#34d399",
            letterSpacing: -2,
            marginBottom: 16,
          }}
        >
          TerpTalk
        </div>
        <div
          style={{
            fontSize: 32,
            color: "#8fa392",
            textAlign: "center",
            maxWidth: 800,
          }}
        >
          Grow journals · Strain database · Setups · Forums — the 21+ community for cannabis growers
        </div>
      </div>
    ),
    { ...size }
  )
}
