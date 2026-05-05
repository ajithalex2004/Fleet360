'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import PlatformHomeBar from '@/components/PlatformHomeBar';

import ModuleGuard from '@/components/ModuleGuard';
const NAV = [
  { href: '/logistics',            label: '📊 Dashboard',        exact: true },
  { href: '/logistics/dispatch',   label: '🚦 Dispatch Board' },
  { href: '/logistics/planner',    label: '🗺️ Route Optimizer' },
  { href: '/logistics/trips',      label: '📋 All Trips' },
  { href: '/logistics/vehicles',   label: '🚛 Vehicles' },
  { href: '/logistics/drivers',    label: '👤 Drivers' },
  { href: '/logistics/tracking',   label: '📍 Live Tracking' },
  { href: '/logistics/quotes',     label: '💰 Freight Quotes' },
  { href: '/logistics/analytics',  label: '📈 Analytics' },
];

export default function LogisticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();
  return (
    <ModuleGuard moduleId="logistics" moduleName="Logistics Management" moduleIcon="🚛">
    <div className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden">
      <PlatformHomeBar moduleName={t('module.logistics')} moduleIcon="🚛" accentColor="from-amber-500 to-orange-600" />
      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-slate-900/80 border-r border-white/10 flex flex-col">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚛</span>
            <div>
              <p className="text-xs font-bold text-white">{t('module.logistics')}</p>
              <p className="text-xs text-slate-500">Management System</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(n => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  active
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                {tLabel(n.label)}
              </Link>
            );
          })}
        </nav>
      </aside>
      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">{children}</div>
      </main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
