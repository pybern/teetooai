import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { InsightStoreProvider } from "@/components/insight-store";
import { MobileNav } from "@/components/mobile-nav";
import { Sidebar } from "@/components/sidebar";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Insightful — Text to Insight",
  description: "Ask questions in plain English and get charts, KPIs and findings built on real market, economic and climate data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <InsightStoreProvider>
          <div className="flex min-h-screen">
            <Suspense fallback={<div className="hidden w-64 shrink-0 lg:block" />}>
              <Sidebar />
            </Suspense>
            <main className="min-w-0 flex-1">
              <MobileNav />
              {children}
            </main>
          </div>
        </InsightStoreProvider>
      </body>
    </html>
  );
}
