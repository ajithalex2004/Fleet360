'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldAlert, Sparkles } from 'lucide-react';

const TABS = [
  { href: '/rental/damage-claims',    label: 'Damage Claims',        icon: ShieldAlert, exact: true },
  { href: '/rental/damage-claims/ai', label: 'AI Damage Assessment', icon: Sparkles,    exact: false },
];

export default function DamageClaimsSubLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-1 w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.exact
            ? pathname === tab.href
            : pathname?.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
