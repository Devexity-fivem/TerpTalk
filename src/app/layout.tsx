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

export const metadata: Metadata = {
  title: "TerpTalk - The Community for Growers",
  description: "A modern platform for cannabis growers to share experiences, grow diaries, and connect with fellow enthusiasts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Navigation />
          <div className="flex-1 flex flex-col lg:flex-row relative">
            <main className="flex-1 w-full lg:w-auto">{children}</main>
            <ChatSidebar />
          </div>
        </Providers>
      </body>
    </html>
  );
}
