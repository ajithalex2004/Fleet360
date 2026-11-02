/**
 * src/app/(driver)/layout.tsx
 *
 * Driver mobile app route group. Sits inside the root layout (which
 * already provides `<html>` and `<body>` for the SSR dev server), so
 * this layout must NOT render its own html/body - that would create
 * a nested `<html>` and trigger a hydration mismatch.
 *
 * For the Capacitor static export, a separate root layout lives at
 * `mobile-app/src/app/layout.tsx` that does own the html/body. The
 * driver-app pages + this layout are copied into `mobile-app/` at
 * build time, where the mobile-app root layout takes over.
 */

import type { Metadata, Viewport } from 'next';
import React from 'react';
import { ForceDarkTheme } from '@/components/driver-app/ForceDarkTheme';
import { MobileLanguageProvider } from '@/contexts/MobileLanguageContext';
import { MobileThemeProvider } from '@/contexts/MobileThemeContext';
import { DriverTrackingProvider } from '@/contexts/DriverTrackingContext';

export const metadata: Metadata = {
  title: 'Fleet360 Driver',
  description: 'Driver app for Fleet360 — DVIR, navigation, schedule.',
  applicationName: 'Fleet360 Driver',
  manifest: '/driver-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Fleet360 Driver',
    statusBarStyle: 'black-translucent',
    startupImage: [
      { url: '/icon-512.png', media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)' },
    ],
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0F172A',
  colorScheme: 'dark',
};

export default function DriverAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ForceDarkTheme />
      <MobileThemeProvider>
        <MobileLanguageProvider defaultLanguage="en">
          <DriverTrackingProvider>
            <div className="dark min-h-screen bg-slate-950 text-slate-100 antialiased">
              {children}
            </div>
          </DriverTrackingProvider>
        </MobileLanguageProvider>
      </MobileThemeProvider>
    </>
  );
}
