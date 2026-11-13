'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tag, Calendar, TrendingUp } from 'lucide-react';

const TABS = [
  {
    href: '/rental/rates',
    label: 'Master Tariffs & Rate Calculator',
    icon: Tag,
    exact: true,
  },
  {
    href: '/rental/rates/events',
    label: 'Event Surge Multipliers',
    icon: Calendar,
    exact: false,
  },
  {
    href: '/rental/rates/yield',
    label: 'Dynamic Yield Simulator',
    icon: TrendingUp,
    exact: false,
  },
];

export default function RatesSubLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div className="bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] rounded-2xl p-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2 mb-2 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/30">
              1 Master Price List
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              Unified tariff schedules, festival event surges &amp; automated yield layers
            </span>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1.5" aria-label="Master Price List navigation">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.exact
              ? pathname === tab.href
              : Boolean(pathname?.startsWith(tab.href));
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]/60'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div>{children}</div>
    </div>
  );
}
