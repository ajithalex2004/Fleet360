'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';

import ModuleGuard from '@/components/ModuleGuard';
const navItems = [
  { name: 'Overview',        href: '/dispatch',             icon: '📊' },
  { name: 'Command Centre',  href: '/dispatch/command',     icon: '🚦', badge: 'LIVE' },
  { name: 'Jobs',            href: '/dispatch/jobs',        icon: '📋' },
  { name: 'Merge Optimizer', href: '/dispatch/merge',       icon: '🔀' },
  { name: 'Analytics',       href: '/dispatch/analytics',   icon: '📈' },
];

// Admin-only items rendered below a divider
const adminNavItems = [
  { name: 'Admin Monitor',   href: '/admin/dispatch',       icon: '🏢' },
  // Specialist dispatch boards live in their own modules:
  { name: 'School Bus Board',href: '/school-bus/dispatch',  icon: '🚌' },
  { name: 'Ambulance Board', href: '/incidents/ambulance/dispatch', icon: '🚑' },
];

export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Command Centre is full-screen — no sidebar, no padding
  const isCommandCentre = pathname === '/dispatch/command';

  if (isCommandCentre) {
    return (
    <ModuleGuard moduleId="dispatch" moduleName="Dispatch Control" moduleIcon="🚦">
      <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-950">
        {children}
      </div>
    
    </ModuleGuard>
  );
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-950">
      <PlatformHomeBar
        moduleName="Dispatch Control"
        moduleIcon="🚦"
        accentColor="from-blue-500 to-cyan-500"
      />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 flex-shrink-0 border-r border-white/10 bg-black overflow-y-auto">
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-xl">
                🚦
              </div>
              <div>
                <p className="text-white font-bold text-sm">Dispatch Control</p>
                <p className="text-slate-400 text-xs">TRIPEXL Smart Mobility</p>
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-0.5">
            {navItems.map(item => {
              const active = item.href === '/dispatch'
                ? pathname === '/dispatch'
                : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    active
                      ? 'bg-blue-500/20 text-white border border-blue-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}>
                  <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
                  {item.name}
                  {'badge' in item && item.badge && (
                    <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/20 font-semibold">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Divider — specialist boards */}
            <div className="pt-3 pb-1">
              <p className="text-slate-600 text-[10px] font-semibold uppercase tracking-wider px-3">
                Specialist Boards
              </p>
            </div>
            {adminNavItems.map(item => {
              const active = pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    active
                      ? 'bg-slate-700/60 text-white border border-white/10'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                  }`}>
                  <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Quick launch command centre */}
          <div className="p-3 mt-2">
            <Link href="/dispatch/command"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-blue-500/20">
              🚦 Open Command Centre
            </Link>
          </div>

          <div className="p-4 mt-2 mx-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <p className="text-blue-400 text-xs font-semibold mb-1">DISPATCHER ZONE</p>
            <p className="text-slate-500 text-xs leading-relaxed">
              Tenant-scoped dispatch operations. Only your tenant's jobs and drivers are visible.
            </p>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto bg-slate-950">
          <div className="p-8 min-h-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
