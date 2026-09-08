import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Navigation } from "@/components/navigation";
import ChatSidebar from "@/components/chat-sidebar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TerpTalk — Cannabis Growing Community, Forum & Strain Database",
    template: "%s | TerpTalk",
  },
  description:
    "TerpTalk is a 21+ community for cannabis growers — grow journals, strain database, setup showcases, forums, and live chat. Share your grow, learn from others.",
  keywords: [
    "cannabis forum", "grow journal", "grow diary", "strain database",
    "cannabis community", "grow setup", "marijuana growing", "cultivation",
  ],
  openGraph: {
    type: "website",
    siteName: "TerpTalk",
    title: "TerpTalk — Cannabis Growing Community",
    description:
      "Grow journals, strain database, setup showcases and forums — a 21+ community for cannabis growers.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "TerpTalk — Cannabis Growing Community",
    description:
      "Grow journals, strain database, setup showcases and forums — a 21+ community for cannabis growers.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Navigation />
          <main className="flex-1">{children}</main>
          <ChatSidebar />
        </Providers>
      </body>
    </html>
  );
}
