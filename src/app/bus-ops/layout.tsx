'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

import ModuleGuard from '@/components/ModuleGuard';
const navItems = [
  { name: 'Dashboard',       href: '/bus-ops',               icon: '📊' },
  { name: 'Dispatch Board',  href: '/bus-ops/dispatch',      icon: '🚌' },
  { name: 'Routes',          href: '/bus-ops/routes',         icon: '🗺️' },
  { name: 'Route Optimizer', href: '/bus-ops/route-planner',  icon: '✨' },
  { name: 'Schedules',       href: '/bus-ops/schedules',      icon: '⏰' },
  { name: 'Passengers',      href: '/bus-ops/passengers',     icon: '👥' },
  { name: 'Staff Members',   href: '/bus-ops/staff',          icon: '👨‍💼' },
  { name: 'Analytics',       href: '/bus-ops/analytics',      icon: '📈' },
  { name: 'Incidents',       href: '/bus-ops/incidents',      icon: '⚠️' },
];

export default function BusOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  return (
    <ModuleGuard moduleId="bus-ops" moduleName="Staff Transportation" moduleIcon="🚌">
    <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-900">
      <PlatformHomeBar moduleName={t('module.bus_ops')} moduleIcon="B" accentColor="from-purple-500 to-pink-600" />
      <div className="flex flex-1 overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-white/10 bg-slate-900/95 overflow-y-auto">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm">
              B
            </div>
            <div>
              <p className="text-white font-semibold text-sm">{t('module.bus_ops')}</p>
              <p className="text-slate-400 text-xs">Fleet Management</p>
            </div>
          </div>
        </div>
        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                {tLabel(item.name)}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-8 bg-slate-900">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
