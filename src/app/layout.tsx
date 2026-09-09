import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Navigation } from "@/components/navigation";
import ChatSidebar from "@/components/chat-sidebar";
import QuickPostButton from "@/components/quick-post-button";
import ServiceWorkerRegister from "@/components/sw-register";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"

export const metadata: Metadata = buildMetadata({
  title: "TerpTalk — Cannabis Growing Community, Forum & Strain Database",
  description:
    "TerpTalk is a 21+ community for cannabis growers — grow journals, strain database, setup showcases, forums, and live chat. Share your grow, learn from others.",
})

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#16a34a",
};

const siteJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "TerpTalk",
    url: baseUrl,
    description:
      "A 21+ community for cannabis growers — grow journals, strain database, setup showcases, forums, and live chat.",
    publisher: {
      "@type": "Organization",
      name: "TerpTalk",
      url: baseUrl,
      logo: {
        "@type": "ImageObject",
        url: `${baseUrl}/logo.png`,
      },
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TerpTalk",
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
    sameAs: [
      baseUrl,
    ],
  },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col">
        <JsonLd data={siteJsonLd} />
        <Providers>
          <Navigation />
          <main id="main-content" className="flex-1">{children}</main>
          <ChatSidebar />
          <QuickPostButton />
          <ServiceWorkerRegister />
        </Providers>
      </body>
    </html>
  );
}
