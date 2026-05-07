import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ToastProvider from "@/components/providers/ToastProvider";
import ClientProviders from "@/components/ClientProviders";
// ChatWidgetLoader is a 'use client' wrapper — required because ssr:false
// is not allowed in Server Components (next/dynamic restriction).
import ChatWidgetLoader from "@/components/Communication/ChatWidgetLoader";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import BrandingProvider from "@/components/BrandingProvider";
import SubscriptionBanner from "@/components/SubscriptionBanner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "XL AI Smart Mobility",
  description: "Unified Transport Management Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <ClientProviders>
          <ToastProvider>
            <BrandingProvider />
            <ImpersonationBanner />
            <SubscriptionBanner />
            {children}
            <ChatWidgetLoader />
          </ToastProvider>
        </ClientProviders>
      </body>
    </html>
  );
}
