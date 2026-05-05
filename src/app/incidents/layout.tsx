'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';

import ModuleGuard from '@/components/ModuleGuard';
const NAV = [
  { href: '/incidents',                    label: '🚨 Dashboard',        exact: true },
  { href: '/incidents/active',             label: '🔴 Active Incidents'             },
  { href: '/incidents/ambulance/dispatch', label: '🚑 Dispatch Board'               },
  { href: '/incidents/ambulance',          label: '📞 Clinical Call Log',  exact: true },
  { href: '/incidents/reports',            label: '📋 Incident Reports'              },
];

export default function IncidentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  // Ambulance Dispatch Board is full-screen (has its own PlatformHomeBar)
  const isDispatchBoard = pathname === '/incidents/ambulance/dispatch';
  if (isDispatchBoard) {
    return (
    <ModuleGuard moduleId="incidents" moduleName="Incident & Ambulance" moduleIcon="🚨">
      <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-950">
        {children}
      </div>
    
    </ModuleGuard>
  );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <aside className="w-60 flex-shrink-0 bg-slate-900/80 border-r border-white/10 flex flex-col">
        <div className="px-4 py-4 border-b border-white/10">
          <Link href="/platform" className="flex items-center gap-2 group">
            <span className="text-xl">🚨</span>
            <div>
              <p className="text-xs font-bold text-white group-hover:text-red-400 transition-colors">
                {t('module.incidents')}
              </p>
              <p className="text-xs text-slate-500">Management System</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(n => {
            const active = n.exact
              ? pathname === n.href
              : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  active
                    ? 'bg-red-500/20 text-red-300 border border-red-500/30 font-medium'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                {tLabel(n.label)}
                {n.label === '🚑 Dispatch Board' && (
                  <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/20 font-semibold">
                    LIVE
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Quick launch Dispatch Board */}
        <div className="p-3">
          <Link href="/incidents/ambulance/dispatch"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
              bg-gradient-to-r from-red-600 to-rose-600 text-white text-sm font-bold
              hover:opacity-90 transition-all shadow-lg shadow-red-500/20">
            🚑 Open Dispatch Board
          </Link>
        </div>

        <div className="px-4 py-3 border-t border-white/10">
          <Link href="/platform" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            ← {tLabel('Back')}
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
