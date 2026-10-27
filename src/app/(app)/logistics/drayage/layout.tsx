'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Anchor, Bell, PlusCircle, UserCheck, Navigation, History,
  Layers, Wallet, BarChart3, Truck, MapPin, FileSpreadsheet,
  ChevronRight,
} from 'lucide-react';

const DRAYAGE_TABS = [
  { href: '/logistics/drayage', label: 'Dashboard', icon: Anchor, exact: true },
  { href: '/logistics/drayage/notifications', label: 'Notifications', icon: Bell },
  { href: '/logistics/drayage/create-jobs', label: 'Create Jobs', icon: PlusCircle },
  { href: '/logistics/drayage/assignment', label: 'Job Assignment', icon: UserCheck },
  { href: '/logistics/drayage/tracking', label: 'Job Tracking', icon: Navigation },
  { href: '/logistics/drayage/history', label: 'Job History', icon: History },
  { href: '/logistics/drayage/containers', label: 'Containers', icon: Layers },
  { href: '/logistics/drayage/payments', label: 'Payments', icon: Wallet },
  { href: '/logistics/drayage/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/logistics/drayage/trailers', label: 'Trailers', icon: Truck },
  { href: '/logistics/drayage/terminal-map', label: 'Terminal Map', icon: MapPin },
  { href: '/logistics/drayage/reports', label: 'Reports', icon: FileSpreadsheet },
];

export default function DrayageLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isTabActive = (tab: (typeof DRAYAGE_TABS)[number]) => {
    if (tab.exact) {
      return pathname === tab.href;
    }
    return pathname.startsWith(tab.href);
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Top Header & Breadcrumb */}
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-2 font-medium">
          <Link href="/logistics" className="hover:text-[var(--text-main)] transition-colors">
            Logistics
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span className="text-[var(--text-main)] font-semibold">Port & Container Drayage</span>
        </div>

        {/* Sub-Navigation Strip (Native Fleet360 Theme) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2">
          {DRAYAGE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isTabActive(tab);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                  active
                    ? 'bg-blue-600/15 border-blue-500/40 text-blue-400 font-bold shadow-sm'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--border-strong)]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-blue-400' : 'text-[var(--text-muted)]'}`} />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Sub-Page Content */}
      <div>{children}</div>
    </div>
  );
}
