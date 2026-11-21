'use client';

import React from 'react';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';
import AppShell from '@/components/nav/AppShell';

/**
 * Booking Portal chrome. Uses the global AppShell (sidebar + workspace tabs)
 * like every other module; the sub-pages (All bookings, New booking,
 * Approvals, My bookings, Marketplace) come from the `booking-portal` entry
 * in src/lib/nav/modules.ts. Colours follow the global Light/Dark theme.
 */
export default function BookingPortalShell({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="booking-portal" moduleName="Booking Portal" moduleIcon="📲">
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-main)]">
        <PlatformHomeBar moduleName="Booking Portal" moduleIcon="🎫" accentColor="from-cyan-500 to-blue-600" />
        <AppShell>
          <div className="p-6">{children}</div>
        </AppShell>
      </div>
    </ModuleGuard>
  );
}
