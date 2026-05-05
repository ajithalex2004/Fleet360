'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

import ModuleGuard from '@/components/ModuleGuard';
const NAV_ITEMS = [
  { href: '/reports',                    label: 'Dashboard' },
  { href: '/reports/fleet-utilization',  label: 'Fleet Utilization' },
  { href: '/reports/revenue',            label: 'Revenue Analysis' },
  { href: '/reports/maintenance',        label: 'Maintenance Cost' },
  { href: '/reports/driver-performance', label: 'Driver Performance' },
  { href: '/reports/scheduled',          label: 'Scheduled Reports' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();
  return (
    <ModuleGuard moduleId="reports" moduleName="Reports & Analytics" moduleIcon="📊">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName={t('module.reports')} moduleIcon="RP" accentColor="from-slate-500 to-slate-600" />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 bg-gradient-to-br from-indigo-950 to-slate-900 border-r border-white/10 p-6 overflow-y-auto flex-shrink-0">
          <h2 className="text-lg font-bold text-white mb-6">{t('module.reports')}</h2>
          <nav className="space-y-2">
            {NAV_ITEMS.map(item => (
              <Link key={item.href} href={item.href}
                className={`block px-4 py-2 rounded-lg transition-all ${
                  pathname === item.href
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium'
                    : 'text-slate-300 hover:bg-white/5'
                }`}>
                {tLabel(item.label)}
              </Link>
            ))}
          </nav>
        </div>
        <main className="flex-1 overflow-y-auto p-8">
          {children}
        </main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
