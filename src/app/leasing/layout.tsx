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
      { href: '/leasing',              label: 'Dashboard',          icon: '📊' },
      { href: '/leasing/analytics',   label: 'Analytics & BI',     icon: '📈' },
      { href: '/leasing/crm',         label: 'CRM Pipeline',        icon: '🎯' },
    ],
  },
  {
    label: 'Sales Lifecycle',
    items: [
      { href: '/leasing/lead-channels',      label: 'Lead Channels',      icon: '🔌' },
      { href: '/leasing/inquiries',          label: 'Inquiries',          icon: '📩' },
      { href: '/leasing/quotations/copilot', label: 'AI Co-pilot',        icon: '✨' },
      { href: '/leasing/quotations',         label: 'Quotations',         icon: '💬' },
      { href: '/leasing/contracts-v2',       label: 'Agreements',         icon: '📜' },
      { href: '/leasing/contracts-v2/qa',    label: 'Contract Q&A (AI)',  icon: '💬' },
      { href: '/leasing/renewals',           label: 'Renewals',           icon: '🔄' },
      { href: '/leasing/early-terminations', label: 'Early Termination',  icon: '🚫' },
    ],
  },
  {
    label: 'Billing & Finance',
    items: [
      { href: '/leasing/invoices',       label: 'Invoices',           icon: '🧾' },
      { href: '/leasing/pre-billing',    label: 'Pre-Billing',        icon: '🔢' },
      { href: '/leasing/receipts',       label: 'Receipts',           icon: '🗒️' },
      { href: '/leasing/receivables',    label: 'Receivables (AR)',   icon: '📥' },
      { href: '/leasing/payments',       label: 'Payments',           icon: '💳' },
      { href: '/leasing/direct-debits',  label: 'Direct Debits',      icon: '🏦' },
    ],
  },
  {
    label: 'Operational Billing',
    items: [
      { href: '/leasing/traffic-fines',  label: 'Traffic Fines',      icon: '🚦' },
      { href: '/leasing/fuel',           label: 'Fuel Management',    icon: '⛽' },
      { href: '/leasing/mileage',        label: 'Mileage & Overage',  icon: '🛣️' },
      { href: '/leasing/field',          label: 'Field App (mobile)', icon: '📲' },
    ],
  },
  {
    label: 'Fleet & Compliance',
    items: [
      { href: '/leasing/insurance',        label: 'Insurance',          icon: '🛡️' },
      { href: '/leasing/drivers',          label: 'Drivers',            icon: '🧑‍✈️' },
      { href: '/leasing/documents',        label: 'Documents',          icon: '📄' },
      { href: '/leasing/amendments',       label: 'Amendments',         icon: '📝' },
      { href: '/leasing/handover',         label: 'Handover & Return',  icon: '🚗' },
      { href: '/leasing/vehicle-exchange', label: 'Vehicle Exchange',   icon: '🔁' },
      { href: '/leasing/transfers',        label: 'Vehicle Transfers',  icon: '🔀' },
      { href: '/leasing/returns',          label: 'Vehicle Returns',    icon: '↩️' },
      { href: '/leasing/remarketing',      label: 'Remarketing',        icon: '📢' },
    ],
  },
  {
    label: 'Customer',
    items: [
      { href: '/leasing/lessees',           label: 'Lessees',            icon: '👥' },
      { href: '/leasing/credit-assessments',label: 'Credit Assessment',  icon: '🏅' },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/leasing/workflow', label: 'Workflow & Approvals', icon: '✅' },
      { href: '/leasing/alerts',   label: 'Expiry Alerts',        icon: '🚨' },
      { href: '/leasing/branches', label: 'Branches',             icon: '🏢' },
      { href: '/leasing/staff',    label: 'Staff Management',     icon: '👔' },
    ],
  },
];

export default function LeasingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  const isActive = (href: string) =>
    href === '/leasing' ? pathname === '/leasing' : pathname.startsWith(href);

  // Field PWA bypasses the desktop chrome — operators are on phones, the
  // sidebar is dead weight there. The field route owns its own mobile shell.
  if (pathname?.startsWith('/leasing/field')) {
    return <>{children}</>;
  }

  return (
    <ModuleGuard moduleId="leasing" moduleName="Vehicle Leasing" moduleIcon="📋">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName={t('module.leasing')} moduleIcon="VL" accentColor="from-violet-500 to-purple-600" />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-black border-r border-white/10 p-4 overflow-y-auto flex-shrink-0">
          <h2 className="text-base font-bold text-white mb-4 px-2">{t('module.leasing')}</h2>
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
                          ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white font-medium shadow-sm'
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
          <div className="mt-6 mx-2 bg-violet-900/40 border border-violet-500/20 rounded-xl p-3">
            <p className="text-xs font-bold text-violet-400">Smart Mobility — {t('module.leasing')}</p>
            <p className="text-xs text-slate-500 mt-0.5">{tLabel('Contracts · Billing · Fleet · CRM')}</p>
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
