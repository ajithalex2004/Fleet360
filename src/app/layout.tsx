import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ToastProvider from "@/components/providers/ToastProvider";
import ClientProviders from "@/components/ClientProviders";
// ChatWidgetLoader is a 'use client' wrapper — required because ssr:false
// is not allowed in Server Components (next/dynamic restriction).
import ChatWidgetLoader from "@/components/Communication/ChatWidgetLoader";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fleet360",
  description: "Unified Transport Management Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <ClientProviders>
          <ToastProvider>
            {children}
            <ChatWidgetLoader />
          </ToastProvider>
        </ClientProviders>
      </body>
    </html>
  );
}
