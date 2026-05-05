'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

import ModuleGuard from '@/components/ModuleGuard';
const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { href: '/rental',              label: 'Dashboard',            icon: '📊' },
      { href: '/rental/analytics',    label: 'Analytics & BI',       icon: '📈' },
    ],
  },
  {
    label: 'Sales Pipeline',
    items: [
      { href: '/rental/inquiries',          label: 'Inquiries',     icon: '🔍' },
      { href: '/rental/bookings/copilot',   label: 'AI Co-pilot',   icon: '✨' },
      { href: '/rental/quotations',         label: 'Quotations',    icon: '📋' },
    ],
  },
  {
    label: 'Reservations',
    items: [
      { href: '/rental/bookings',     label: 'Bookings',             icon: '📅' },
      { href: '/rental/availability', label: 'Vehicle Availability', icon: '🚗' },
    ],
  },
  {
    label: 'Rental Operations',
    items: [
      { href: '/rental/agreements',    label: 'Rental Agreements',   icon: '📄' },
      { href: '/rental/renewals',      label: 'Renewals',            icon: '🔄' },
      { href: '/rental/handover',      label: 'Handover & Return',   icon: '🔑' },
      { href: '/rental/damage-claims',     label: 'Damage Claims',       icon: '⚠️' },
      { href: '/rental/damage-claims/ai',  label: 'Damage AI Studio',    icon: '🤖' },
      { href: '/rental/transfers',         label: 'Vehicle Transfers',   icon: '🔀' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { href: '/rental/invoices',      label: 'Invoices',         icon: '🧾' },
      { href: '/rental/pricing',       label: 'Pricing',          icon: '💰' },
      { href: '/rental/rates',         label: 'Rate Engine',      icon: '⚙️' },
      { href: '/rental/rates/yield',   label: 'Yield Analyzer',   icon: '📊' },
      { href: '/rental/rates/events',  label: 'Rate Events',      icon: '🎉' },
      { href: '/rental/ancillaries',   label: 'Ancillaries',      icon: '🧰' },
    ],
  },
  {
    label: 'Customer',
    items: [
      { href: '/rental/customers', label: 'Customers',      icon: '👥' },
      { href: '/rental/documents', label: 'Document Vault', icon: '🗂️' },
    ],
  },
  {
    label: 'Compliance & Ops',
    items: [
      { href: '/rental/insurance', label: 'Insurance',         icon: '🛡️' },
      { href: '/rental/branches',  label: 'Branch Management', icon: '🏢' },
      { href: '/rental/alerts',    label: 'Expiry Alerts',     icon: '🚨' },
      { href: '/rental/staff',     label: 'Staff Management',  icon: '👔' },
    ],
  },
];

export default function RentalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  const isActive = (href: string) =>
    href === '/rental' ? pathname === '/rental' : pathname.startsWith(href);

  return (
    <ModuleGuard moduleId="rental" moduleName="Rent-a-Car" moduleIcon="🚗">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName={t('module.rental')} moduleIcon="RC" accentColor="from-teal-500 to-cyan-600" />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-gradient-to-br from-teal-950 to-slate-900 border-r border-white/10 p-4 overflow-y-auto flex-shrink-0">
          <h2 className="text-base font-bold text-white mb-4 px-2">{t('module.rental')}</h2>
          <nav className="space-y-5">
            {NAV_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2 mb-2">
                  {tLabel(group.label)}
                </p>
                <div className="space-y-0.5">
                  {group.items.map(item => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all text-sm ${
                        isActive(item.href)
                          ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-medium shadow-sm'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className="text-base leading-none">{item.icon}</span>
                      <span>{tLabel(item.label)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Phase badge */}
          <div className="mt-6 mx-2 bg-teal-900/40 border border-teal-500/20 rounded-xl p-3">
            <p className="text-xs font-bold text-teal-400">Smart Mobility — {t('module.rental')}</p>
            <p className="text-xs text-slate-500 mt-0.5">{tLabel('Inquiries · Quotes · Handover · Compliance')}</p>
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8 bg-slate-950 text-white">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
