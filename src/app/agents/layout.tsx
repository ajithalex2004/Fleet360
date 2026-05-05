'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';

import ModuleGuard from '@/components/ModuleGuard';
// Global module navigator — all top-level modules for quick access
const GLOBAL_MODULES = [
  { href: '/platform',   label: 'Platform',      icon: '🏠' },
  { href: '/fleet',      label: 'Fleet',         icon: '🚗' },
  { href: '/leasing',    label: 'Leasing',       icon: '📋' },
  { href: '/rental',     label: 'RAC',           icon: '🔑' },
  { href: '/school-bus', label: 'School Bus',    icon: '🚌' },
  { href: '/bus-ops',    label: 'Staff Transport', icon: '🚍' },
  { href: '/logistics',  label: 'Logistics',     icon: '🚚' },
  { href: '/dispatch',   label: 'Dispatch',      icon: '📡' },
  { href: '/incidents',  label: 'Incidents',     icon: '🚑' },
  { href: '/finance',    label: 'Finance',       icon: '💰' },
  { href: '/agents',     label: 'AI Agents',     icon: '🤖' },
  { href: '/admin',      label: 'Admin',         icon: '⚙️' },
];

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <ModuleGuard moduleId="agents" moduleName="AI Agent Ecosystem" moduleIcon="🤖">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar
        moduleName="AI Agent Ecosystem"
        moduleIcon="🤖"
        accentColor="from-violet-500 to-purple-600"
      />
      <div className="flex flex-1 overflow-hidden">

        {/* Global cross-module sidebar */}
        <div className="w-52 flex-shrink-0 border-r border-white/10 bg-slate-900/80 overflow-y-auto hidden md:flex flex-col">
          {/* Module header */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-base">🤖</div>
              <div>
                <p className="text-white font-semibold text-xs">AI Agents</p>
                <p className="text-slate-500 text-[10px]">Smart Mobility</p>
              </div>
            </div>
          </div>

          {/* Module quick-nav */}
          <nav className="p-3 flex-1">
            <p className="px-2 mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">All Modules</p>
            <div className="space-y-0.5">
              {GLOBAL_MODULES.map(item => {
                const active = item.href === '/agents'
                  ? pathname?.startsWith('/agents')
                  : pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all text-xs font-medium ${
                      active
                        ? 'bg-gradient-to-r from-violet-500/20 to-purple-500/20 text-violet-300 border border-violet-500/30'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-sm leading-none">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Footer badge */}
          <div className="p-3 mx-3 mb-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <p className="text-violet-400 text-[10px] font-bold mb-0.5">10 AGENTS LIVE</p>
            <p className="text-slate-500 text-[9px]">Autonomous · Always watching</p>
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
