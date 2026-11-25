'use client';

/**
 * Booking Portal module frame — inside the main app shell (sidebar, theme),
 * with the same breadcrumb + page tabs as Port Drayage.
 */

import React from 'react';
import { CalendarCheck, PlusCircle, Clock, Bookmark, Gavel, Wrench } from 'lucide-react';
import ModuleGuard from '@/components/ModuleGuard';
import { ModuleSubNav, type ModuleTab } from '@/components/ui/module-subnav';

const BOOKING_TABS: ModuleTab[] = [
  { href: '/booking-portal', label: 'All Bookings', icon: CalendarCheck, exact: true },
  { href: '/booking-portal/new', label: 'New Booking', icon: PlusCircle },
  { href: '/booking-portal/service-request', label: 'Service Request', icon: Wrench },
  { href: '/booking-portal/approvals', label: 'Pending Approvals', icon: Clock },
  { href: '/booking-portal/my-bookings', label: 'My Requests', icon: Bookmark },
  { href: '/booking-portal/marketplace', label: 'Limo & Bus Marketplace', icon: Gavel },
];

export default function BookingPortalShell({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard moduleId="booking-portal" moduleName="Booking Portal" moduleIcon="📲">
      <div className="space-y-5 pb-12">
        <ModuleSubNav parent={{ label: 'Live Operations' }} title="Booking Portal" tabs={BOOKING_TABS} />
        <div>{children}</div>
      </div>
    </ModuleGuard>
  );
}
