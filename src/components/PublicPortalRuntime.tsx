'use client';

import ToastProvider from '@/components/providers/ToastProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import ChunkErrorReloader from '@/components/ChunkErrorReloader';

/**
 * Lightweight client runtime for standalone external portals (`/rac-portal`,
 * `/leasing-portal`, `/carrier-portal`) and public OTP e-signing (`/sign/*`).
 *
 * Provides theme, toast notifications, and chunk-error recovery WITHOUT mounting
 * staff-only `PermissionProvider` (`/api/admin/session`), `BrandingProvider`
 * (`/api/auth/me`), `SubscriptionBanner` (`/api/admin/billing`), or the internal
 * staff `CommandPalette` (`Cmd+K`).
 */
export default function PublicPortalRuntime({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChunkErrorReloader />
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </>
  );
}
