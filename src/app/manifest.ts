import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TerpTalk",
    short_name: "TerpTalk",
    description: "The 21+ community for cannabis growers — forums, grow diaries, strain database, and live chat.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0f0a",
    theme_color: "#16a34a",
    icons: [
      { src: "/logo.png", sizes: "192x192", type: "image/png" },
      { src: "/logo.png", sizes: "512x512", type: "image/png" },
    ],
  }
}
