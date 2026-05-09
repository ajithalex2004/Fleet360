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
      { href: '/maintenance',                           label: 'Dashboard',              icon: '📊' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/maintenance/service-requests',          label: 'Service Requests',       icon: '🔧' },
      { href: '/maintenance/predictive',                label: 'Predictive Maintenance', icon: '🔮' },
    ],
  },
  {
    label: 'Work Management',
    items: [
      { href: '/maintenance/requests',                  label: 'Requests List',          icon: '📋' },
      { href: '/maintenance/history',                   label: 'Maintenance History',    icon: '🕐' },
      { href: '/maintenance/approvals',                 label: 'Approvals',              icon: '✅' },
      { href: '/maintenance/invoices',                  label: 'Invoices',               icon: '🧾' },
      { href: '/maintenance/analytics',                 label: 'Analytics',              icon: '📈' },
    ],
  },
  {
    label: 'Garage',
    items: [
      { href: '/maintenance/garage',                    label: 'Garage Management',      icon: '🏭' },
      { href: '/maintenance/garage-portal',             label: 'Submit Quote',           icon: '📝' },
      { href: '/maintenance/garage-portal/work-orders', label: 'Work Orders',            icon: '📄' },
    ],
  },
  {
    label: 'Alerts & Monitoring',
    items: [
      { href: '/maintenance/alert-config',              label: 'Alert Configuration',    icon: '⚙️' },
      { href: '/maintenance/action-centre',             label: 'Action Centre',          icon: '🔔' },
    ],
  },
  {
    label: 'Data Masters',
    items: [
      { href: '/maintenance/data-masters/garages',          label: 'Garages',            icon: '🏭' },
      { href: '/maintenance/data-masters/attachment-types', label: 'Attachment Types',   icon: '📎' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/admin/settings/integrations',               label: 'Integrations',           icon: '🔗' },
      { href: '/maintenance/admin/notifications',           label: 'Email / SMS Alerts',     icon: '✉️' },
      { href: '/maintenance/admin/notification-rules',      label: 'Notification Rules',     icon: '📐' },
    ],
  },
];

export default function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  const isActive = (href: string) =>
    href === '/maintenance' ? pathname === '/maintenance' : pathname.startsWith(href);

  return (
    <ModuleGuard moduleId="maintenance" moduleName="Vehicle Maintenance" moduleIcon="🔧">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName={t('module.maintenance')} moduleIcon="VM" accentColor="from-blue-500 to-indigo-600" />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-black border-r border-white/10 p-4 overflow-y-auto flex-shrink-0">
          <h2 className="text-base font-bold text-white mb-4 px-2">{t('module.maintenance')}</h2>
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
                          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium shadow-sm'
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
          <div className="mt-6 mx-2 bg-blue-900/40 border border-blue-500/20 rounded-xl p-3">
            <p className="text-xs font-bold text-blue-400">Smart Mobility — {t('module.maintenance')}</p>
            <p className="text-xs text-slate-500 mt-0.5">{tLabel('Predictive · Garage · Alerts · Analytics')}</p>
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
