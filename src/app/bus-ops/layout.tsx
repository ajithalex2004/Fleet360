'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';
import ModuleGuard from '@/components/ModuleGuard';
import {
  LayoutDashboard,
  RadioTower,
  Map as MapIcon,
  Sparkles,
  Recycle,
  Clock,
  Users,
  UserCog,
  LineChart,
  TrendingUp,
  AlertTriangle,
  Bluetooth,
  Trophy,
  BusFront,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  group: 'core' | 'ops' | 'people' | 'intel' | 'devices';
}

const navItems: NavItem[] = [
  { name: 'Dashboard',                 href: '/bus-ops',                 icon: LayoutDashboard, group: 'core' },
  { name: 'Dispatch Board',            href: '/bus-ops/dispatch',        icon: RadioTower,      group: 'core' },
  { name: 'Routes',                    href: '/bus-ops/routes',          icon: MapIcon,         group: 'ops' },
  { name: 'Route Optimizer',           href: '/bus-ops/route-planner',   icon: Sparkles,        group: 'ops' },
  { name: 'Re-optimise',               href: '/bus-ops/optimisation',    icon: Recycle,         group: 'ops' },
  { name: 'Schedules',                 href: '/bus-ops/schedules',       icon: Clock,           group: 'ops' },
  { name: 'Passengers',                href: '/bus-ops/passengers',      icon: Users,           group: 'people' },
  { name: 'Staff Members',             href: '/bus-ops/staff',           icon: UserCog,         group: 'people' },
  { name: 'Driver Scores',             href: '/bus-ops/drivers',         icon: Trophy,          group: 'people' },
  { name: 'Analytics',                 href: '/bus-ops/analytics',       icon: LineChart,       group: 'intel' },
  { name: 'Demand Forecast',           href: '/bus-ops/demand-forecast', icon: TrendingUp,      group: 'intel' },
  { name: 'Incidents',                 href: '/bus-ops/incidents',       icon: AlertTriangle,   group: 'intel' },
  // Driver / Passenger PWAs live in /mobile-apps — single source of truth.
  // BLE Gateways stays here (it's hardware admin, not a mobile app surface).
  { name: 'BLE Gateways',              href: '/bus-ops/gateways',        icon: Bluetooth,       group: 'devices' },
];

const GROUP_LABELS: Record<NavItem['group'], string> = {
  core:    'Overview',
  ops:     'Operations',
  people:  'People',
  intel:   'Intelligence',
  devices: 'Devices',
};

export default function BusOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  // Driver and passenger PWAs bypass the desktop chrome — they own their own
  // mobile shells (sticky header + bottom tabs).
  if (pathname?.startsWith('/bus-ops/driver') || pathname?.startsWith('/bus-ops/passenger')) {
    return <>{children}</>;
  }

  // Group items in render order for the sidebar
  const groupedOrder: NavItem['group'][] = ['core', 'ops', 'people', 'intel', 'devices'];
  const grouped = groupedOrder.map((g) => ({ key: g, label: GROUP_LABELS[g], items: navItems.filter((i) => i.group === g) }));

  return (
    <ModuleGuard moduleId="bus-ops" moduleName="Staff Transportation" moduleIcon="🚌">
      <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-950">
        <PlatformHomeBar moduleName={t('module.bus_ops')} moduleIcon="B" accentColor="from-purple-500 to-pink-600" />
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-64 flex-shrink-0 border-r border-white/5 bg-black overflow-y-auto">
            <div className="p-5 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <BusFront className="w-5 h-5 text-white" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{t('module.bus_ops')}</p>
                  <p className="text-slate-500 text-[11px] uppercase tracking-wider">Staff Transport</p>
                </div>
              </div>
            </div>
            <nav className="p-3 space-y-5">
              {grouped.map((g) => (
                <div key={g.key}>
                  <p className="px-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">{g.label}</p>
                  <div className="space-y-0.5">
                    {g.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href || (item.href !== '/bus-ops' && pathname?.startsWith(item.href));
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                            isActive
                              ? 'bg-gradient-to-r from-violet-600/20 to-purple-600/10 text-violet-200 ring-1 ring-violet-500/30'
                              : 'text-slate-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-violet-300' : 'text-slate-500'}`} strokeWidth={1.75} />
                          <span className="truncate">{tLabel(item.name)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
          <main className="flex-1 overflow-y-auto bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
            <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
          </main>
        </div>
      </div>
    </ModuleGuard>
  );
}
