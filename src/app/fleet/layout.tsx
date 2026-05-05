'use client';
import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

import ModuleGuard from '@/components/ModuleGuard';
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { href: '/fleet', label: 'Dashboard', icon: '📊' },
    ],
  },
  {
    label: 'Masters',
    items: [
      { href: '/fleet/vehicle-types', label: 'Vehicle Types', icon: '🗂️' },
      { href: '/fleet/vehicles', label: 'Vehicle Master', icon: '🚗' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/fleet/lifecycle', label: 'Lifecycle Events', icon: '🔄' },
      { href: '/fleet/work-orders', label: 'Work Orders', icon: '🔧' },
      { href: '/fleet/allocations', label: 'Allocations', icon: '📌' },
      { href: '/fleet/transfers', label: 'Transfers', icon: '↔️' },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { href: '/fleet/insurance', label: 'Insurance', icon: '🛡️' },
      { href: '/fleet/documents', label: 'Documents', icon: '📄' },
      { href: '/fleet/hos', label: 'Driver HoS', icon: '⏱️' },
    ],
  },
  {
    label: 'Finance & Analytics',
    items: [
      { href: '/fleet/fuel', label: 'Fuel Logs', icon: '⛽' },
      { href: '/fleet/fines', label: 'Traffic Fines', icon: '⚠️' },
      { href: '/fleet/tco', label: 'TCO Analysis', icon: '💹' },
    ],
  },
  {
    label: 'AI Intelligence',
    items: [
      { href: '/fleet/intelligence', label: 'Predictive Maintenance', icon: '🧠' },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href.split('/').length === 2) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  // Ensure all fleet-specific tables exist in the DB on first module load
  useEffect(() => {
    fetch('/api/fleet/init').catch(() => {/* silent — tables already exist */});
  }, []);

  return (
    <ModuleGuard moduleId="fleet" moduleName="Fleet Management" moduleIcon="🚘">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName={t('module.fleet')} moduleIcon="F" accentColor="from-orange-500 to-amber-600" />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 border-r border-white/10 bg-slate-800/30 overflow-y-auto flex-shrink-0">
          <div className="p-5 border-b border-white/10 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white font-bold text-sm">FM</div>
            <div>
              <p className="text-white font-semibold text-sm">{t('module.fleet')}</p>
              <p className="text-slate-400 text-xs">Smart Mobility</p>
            </div>
          </div>
          <nav className="p-3 space-y-4">
            {NAV_SECTIONS.map(section => (
              <div key={section.label}>
                <p className="px-4 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{tLabel(section.label)}</p>
                <div className="space-y-0.5">
                  {section.items.map(item => (
                    <Link key={item.href} href={item.href}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                        isActive(pathname, item.href)
                          ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 text-orange-400 border border-orange-500/30'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-300'
                      }`}>
                      <span className="text-base leading-none">{item.icon}</span>
                      <span className="text-sm font-medium">{tLabel(item.label)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
