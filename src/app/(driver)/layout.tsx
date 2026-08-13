/**
 * src/app/(driver)/layout.tsx
 *
 * Driver mobile app route group. Sits inside the root layout (which
 * already provides `<html>` and `<body>` for the SSR dev server), so
 * this layout must NOT render its own html/body — that would create
 * a nested `<html>` and trigger a hydration mismatch.
 *
 * For the Capacitor static export, a separate root layout lives at
 * `mobile-app/src/app/layout.tsx` that does own the html/body. The
 * driver-app pages + this layout are copied into `mobile-app/` at
 * build time, where the mobile-app root layout takes over.
 *
 * The driver app is permanently dark — drivers in the desert in
 * midday sun need high contrast. We use a tiny client component to
 * force `<html>` to `class="dark"` on mount, overriding whatever
 * theme the admin app's `ThemeProvider` chose.
 */

import type { Metadata, Viewport } from 'next';
import React from 'react';
import { ForceDarkTheme } from '@/components/driver-app/ForceDarkTheme';

export const metadata: Metadata = {
  title: 'Fleet360 Driver',
  description: 'Driver app for Fleet360 — DVIR, navigation, schedule.',
  applicationName: 'Fleet360 Driver',
  // PWA manifest — points at /driver-manifest.webmanifest which is
  // served by Next.js from the public/ dir. Same file is shipped in
  // the Capacitor bundle via mobile-app/public/.
  manifest: '/driver-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Fleet360 Driver',
    statusBarStyle: 'black-translucent',
    startupImage: [
      // iOS startup images — basic dark splash at common iPhone sizes.
      // 1170×2532 is iPhone 13/14 Pro, the most common current target.
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
    // Don't let Chrome auto-link phone numbers / addresses in the
    // DVIR defect fields (they contain arbitrary text that could
    // look like a phone number).
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
      {/* Force the dark theme on every render — the parent ThemeProvider
          may have applied 'light' from the user's saved preference. We
          override at the html level on mount. */}
      <ForceDarkTheme />
      <div className="dark min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </div>
    </>
  );
}
