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
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Grow diaries", url: "/diaries", description: "Browse and update grow diaries" },
      { name: "Log an update", url: "/diaries", description: "Jump to your grow diaries" },
      { name: "Forum", url: "/forum", description: "Latest discussions" },
    ],
  }
}
