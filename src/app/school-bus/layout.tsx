'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import PlatformHomeBar from '@/components/PlatformHomeBar';

import ModuleGuard from '@/components/ModuleGuard';
const NAV = [
  // ── Core ──────────────────────────────────────────────────
  { href: '/school-bus',                label: '🏫 Dashboard',        exact: true },
  { href: '/school-bus/dispatch',       label: '🚦 Dispatch Board' },

  // ── Sprint 1 — Foundation ─────────────────────────────────
  { href: '/school-bus/routes',         label: '🗺️ Routes' },
  { href: '/school-bus/stops',          label: '📍 Stop Management' },
  { href: '/school-bus/attendants',     label: '👩 Nanny Registry' },
  { href: '/school-bus/students',       label: '👧 Students' },
  { href: '/school-bus/attendance',     label: '📋 Attendance' },

  // ── Sprint 2 — Ops Intelligence ──────────────────────────
  { href: '/school-bus/live-map',       label: '🛰️ Live Map' },
  { href: '/school-bus/schedules',      label: '📅 Schedules' },
  { href: '/school-bus/trips',          label: '🛤️ Trip Logs' },

  // ── Sprint 3 — Finance & Enrollment ──────────────────────
  { href: '/school-bus/allocations',       label: '💺 Seat Allocations' },
  { href: '/school-bus/seat-availability', label: '🪑 Seat Availability' },
  { href: '/finance/invoices?module=SCHOOL_BUS', label: '💰 Fees → Finance',  external: true },

  // ── Sprint 4 — Safety & Analytics ────────────────────────
  { href: '/school-bus/driver-scores',  label: '🎯 Driver Scores' },
  { href: '/school-bus/analytics',      label: '📊 System Analytics' },
  { href: '/school-bus/reports',        label: '📈 Reports' },

  // ── AI Intelligence ──────────────────────────────────────
  { href: '/school-bus/intelligence',   label: '🧠 Route Optimisation' },

  // ── Legacy / External ────────────────────────────────────
  { href: '/school-bus/route-planner',  label: '✨ Route Optimizer' },
];

export default function SchoolBusLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tLabel, t } = useLanguage();

  // Parent PWA bypasses the desktop chrome — owns its own mobile shell.
  // Use exact-or-segment-bounded checks to avoid matching unintended pages.
  const isParentPwa =
    pathname === '/school-bus/parent' ||
    pathname?.startsWith('/school-bus/parent/');
  if (isParentPwa) return <>{children}</>;

  return (
    <ModuleGuard moduleId="school-bus" moduleName="School Bus Transportation" moduleIcon="🏫">
    <div className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden">
      <PlatformHomeBar moduleName={t('module.school_bus')} moduleIcon="🏫" accentColor="from-yellow-400 to-amber-500" />
      <div className="flex flex-1 overflow-hidden">
      <aside className="w-60 flex-shrink-0 bg-slate-900/80 border-r border-white/10 flex flex-col">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏫</span>
            <div>
              <p className="text-xs font-bold text-white">{t('module.school_bus')}</p>
              <p className="text-xs text-slate-500">Transportation</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((n, i) => {
            // Section headers before sprint groups
            const header =
              i === 2  ? 'Foundation' :
              i === 7  ? 'Ops Intelligence' :
              i === 10 ? 'Finance & Enrolment' :
              i === 13 ? 'Safety & Analytics' :
              i === 16 ? 'AI Intelligence' :
              i === 17 ? 'Tools' : null;

            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            return (
              <div key={n.href}>
                {header && (
                  <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    {header}
                  </p>
                )}
                <Link href={n.href}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                    active
                      ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 font-medium'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}>
                  <span>{tLabel(n.label)}</span>
                </Link>
              </div>
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
