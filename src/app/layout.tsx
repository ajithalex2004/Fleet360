import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "C1 Chat",
  description: "Generative UI App powered by Thesys C1",
};

import ToastProvider from "@/components/providers/ToastProvider";
import ChatWidget from "@/components/Communication/ChatWidget";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <ToastProvider>
          {children}
          <ChatWidget />
        </ToastProvider>
      </body>
    </html>
  );
}
