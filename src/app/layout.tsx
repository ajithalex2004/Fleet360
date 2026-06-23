import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import ToastProvider from "@/components/providers/ToastProvider";
import ClientProviders from "@/components/ClientProviders";
// ChatWidgetLoader is a 'use client' wrapper — required because ssr:false
// is not allowed in Server Components (next/dynamic restriction).
import ChatWidgetLoader from "@/components/Communication/ChatWidgetLoader";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import BrandingProvider from "@/components/BrandingProvider";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import PageTransition from "@/components/PageTransition";
import ThemeFloatingToggle from "@/components/ThemeFloatingToggle";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fleet360",
  description: "Unified Transport Management Platform",
};

const themeInitScript = `
  (function() {
    try {
      var stored = localStorage.getItem('fleet360-theme');
      var theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
      var resolved = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      document.documentElement.classList.add('theme-ready');
    } catch (error) {}
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} app-body antialiased`}>
        <Script id="fleet360-theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <ClientProviders>
          <ToastProvider>
            <BrandingProvider />
            <ImpersonationBanner />
            <SubscriptionBanner />
            <ThemeFloatingToggle />
            <PageTransition>{children}</PageTransition>
            <ChatWidgetLoader />
          </ToastProvider>
        </ClientProviders>
      </body>
    </html>
  );
}
