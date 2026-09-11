import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import { Navigation } from "@/components/navigation";
import ChatSidebar from "@/components/chat-sidebar";
import QuickPostButton from "@/components/quick-post-button";
import ServiceWorkerRegister from "@/components/sw-register";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { shouldGatePublic } from "@/lib/maintenance";
import MaintenancePage from "./maintenance/page";
import AnnouncementBanner from "@/components/announcement-banner";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const gated = await shouldGatePublic()

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint to avoid a palette flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen flex flex-col">
        {gated ? (
          <MaintenancePage />
        ) : (
          <>
            <JsonLd data={siteJsonLd} />
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
            >
              Skip to content
            </a>
            <Providers>
              <AnnouncementBanner />
              <Navigation />
              {/* flex-1 flex puts the desktop chat sidebar beside main content */}
              <div className="flex flex-1 min-h-0">
                <main id="main-content" className="flex-1 min-w-0 pb-16 lg:pb-0">{children}</main>
                <ChatSidebar />
              </div>
              <QuickPostButton />
              <ServiceWorkerRegister />
            </Providers>
            <Analytics />
          </>
        )}
      </body>
    </html>
  );
}
