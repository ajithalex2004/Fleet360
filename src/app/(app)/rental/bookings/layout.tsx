'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Calendar, Sparkles } from 'lucide-react';

const SUB_TABS = [
  { href: '/rental/bookings', label: 'Reservations', icon: Calendar, exact: true },
  { href: '/rental/bookings/copilot', label: 'AI Booking Copilot', icon: Sparkles, exact: false },
] as const;

export default function BookingsSubLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <nav
        aria-label="Bookings Sub-Navigation"
        className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3 overflow-x-auto"
      >
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.exact
            ? pathname === tab.href
            : Boolean(pathname?.startsWith(tab.href));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/35 shadow-sm'
                  : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
