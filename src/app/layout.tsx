import type { Metadata } from "next";
import "./globals.css";
import ToastProvider from "@/components/providers/ToastProvider";
import ClientProviders from "@/components/ClientProviders";
import GlobalDeferredWidgets from "@/components/GlobalDeferredWidgets";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Fleet360",
  description: "Unified Transport Management Platform",
};

// Applies the saved theme class to <html> before paint, so there is no flash of
// the wrong theme on load. Defaults to dark (the app's baseline).
//
// The driver app (/driver-app/*) is permanently dark — drivers in the
// desert need high contrast and the mobile UI was designed dark-only.
// We force dark for those routes regardless of the saved preference.
const THEME_NO_FLASH = `(function(){try{var path=window.location.pathname;var isDriverApp=path.indexOf('/driver-app')===0;var c=localStorage.getItem('fleet360-theme')||'dark';var d=isDriverApp||c==='dark'||(c==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.add(d?'dark':'light');e.style.colorScheme=d?'dark':'light';}catch(_){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH }} />
      </head>
      <body className="antialiased min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)] transition-colors duration-150">
        <ThemeProvider>
          <ClientProviders>
            <ToastProvider>
              {children}
              <GlobalDeferredWidgets />
            </ToastProvider>
          </ClientProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
