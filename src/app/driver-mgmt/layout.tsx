'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

import ModuleGuard from '@/components/ModuleGuard';
const navItems = [
  { href: '/driver-mgmt',                      label: 'Dashboard',      icon: 'D' },
  { href: '/driver-mgmt/profiles',             label: 'Driver Profiles', icon: 'P' },
  { href: '/driver-mgmt/profiles?expiring=true', label: 'Compliance',   icon: '⚠', compliance: true },
  { href: '/driver-mgmt/documents',            label: 'Documents',      icon: 'D' },
  { href: '/driver-mgmt/shifts',               label: 'Shifts',         icon: 'S' },
  { href: '/driver-mgmt/training',             label: 'Training',       icon: 'T' },
  { href: '/driver-mgmt/performance',          label: 'Performance',    icon: 'A' },
];

function isActive(pathname: string, href: string) {
  if (href.split('/').length === 2) return pathname === href;
  return pathname === href || pathname.startsWith(href.split('?')[0] + '/');
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();
  return (
    <ModuleGuard moduleId="driver-mgmt" moduleName="Driver Management" moduleIcon="👤">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName={t('module.driver')} moduleIcon="D" accentColor="from-blue-500 to-indigo-600" />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 border-r border-white/10 bg-black overflow-y-auto flex-shrink-0">
          <div className="p-5 border-b border-white/10 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center text-white font-bold">D</div>
            <div>
              <p className="text-white font-semibold text-sm">{t('module.driver')}</p>
              <p className="text-slate-400 text-xs">Personnel Management</p>
            </div>
          </div>
          <nav className="p-3 space-y-1">
            {navItems.map(item => {
              const active = item.compliance
                ? false
                : isActive(pathname, item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    active
                      ? 'bg-gradient-to-r from-cyan-500/20 to-teal-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:bg-white/5'
                  }`}>
                  <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    item.compliance ? 'bg-amber-500/20' : 'bg-slate-700'
                  }`}>{item.icon}</span>
                  <span className="text-sm font-medium">{tLabel(item.label)}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
