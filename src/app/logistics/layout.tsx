'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ModuleGuard from '@/components/ModuleGuard';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import { useLanguage } from '@/contexts/LanguageContext';

const NAV = [
  { href: '/logistics', label: 'Dashboard', exact: true },
  { href: '/logistics/control-tower', label: 'Control Tower' },
  { href: '/logistics/shift-handovers', label: 'Shift Handover' },
  { href: '/logistics/field-ops', label: 'Field Ops Mobile' },
  { href: '/logistics/dispatch', label: 'Dispatch Board' },
  { href: '/logistics/marketplace', label: 'Freight Marketplace' },
  { href: '/logistics/master-data', label: 'Master Data' },
  { href: '/logistics/carriers', label: 'Carrier Onboarding' },
  { href: '/logistics/carrier-scorecards', label: 'Carrier Scorecards' },
  { href: '/logistics/rate-contracts', label: 'Rate Contracts' },
  { href: '/logistics/planner', label: 'Route Optimizer' },
  { href: '/logistics/trips', label: 'All Trips' },
  { href: '/logistics/vehicles', label: 'Vehicles' },
  { href: '/logistics/drivers', label: 'Drivers' },
  { href: '/logistics/tracking', label: 'Live Tracking' },
  { href: '/logistics/customer-tracking', label: 'Customer Tracking' },
  { href: '/logistics/quotes', label: 'Freight Quotes' },
  { href: '/logistics/accessorials', label: 'Accessorials' },
  { href: '/logistics/finance-reconciliation', label: 'Finance Reconciliation' },
  { href: '/logistics/analytics', label: 'Analytics' },
];

export default function LogisticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  return (
    <ModuleGuard moduleId="logistics" moduleName="Logistics Management" moduleIcon="L">
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
        <PlatformHomeBar moduleName={t('module.logistics')} moduleIcon="L" accentColor="from-amber-500 to-orange-600" />
        <div className="flex flex-1 overflow-hidden">
          <aside className="flex w-56 flex-shrink-0 flex-col border-r border-white/10 bg-black">
            <div className="border-b border-white/10 px-4 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-sm font-black text-slate-950">L</span>
                <div>
                  <p className="text-xs font-bold text-white">{t('module.logistics')}</p>
                  <p className="text-xs text-slate-500">Management System</p>
                </div>
              </div>
            </div>
            <nav className="flex-1 space-y-0.5 px-2 py-3">
              {NAV.map(item => {
                const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-all ${
                      active
                        ? 'border border-amber-500/30 bg-amber-500/20 font-medium text-amber-300'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {tLabel(item.label)}
                  </Link>
                );
              })}
            </nav>
          </aside>
          <main className="flex-1 overflow-y-auto">
            <div className="p-6">{children}</div>
          </main>
        </div>
      </div>
    </ModuleGuard>
  );
}
