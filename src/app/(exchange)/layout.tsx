/**
 * src/app/(exchange)/layout.tsx
 *
 * Dedicated Application Shell for Fleet360 Exchange (Transport Partners).
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Briefcase,
  DollarSign,
  Truck,
  Users,
  ShieldCheck,
  FileText,
  Building2,
  ExternalLink,
  ChevronRight,
  Radio,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/exchange/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/exchange/jobs', label: 'Jobs & Requests', icon: Briefcase },
  { href: '/exchange/quotations', label: 'Quotations', icon: DollarSign },
  { href: '/exchange/fleet', label: 'Fleet Register', icon: Truck },
  { href: '/exchange/drivers', label: 'Driver Roster', icon: Users },
  { href: '/exchange/compliance', label: 'Compliance Vault', icon: ShieldCheck },
  { href: '/exchange/invoices', label: 'Invoices & Billing', icon: FileText },
  { href: '/exchange/profile', label: 'Company Profile', icon: Building2 },
];

export default function ExchangeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800/80 bg-slate-900/90 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo & Platform Tag */}
          <div className="p-5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-cyan-600 flex items-center justify-center text-white font-black shadow-lg shadow-cyan-600/30">
                ⚡
              </div>
              <div>
                <div className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
                  FLEET360 <span className="text-cyan-400 font-bold text-xs bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/30">EXCHANGE</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium">Transport Partner Network</div>
              </div>
            </div>
          </div>

          {/* Partner Status Pill */}
          <div className="px-4 py-3 border-b border-slate-800/50 bg-slate-950/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-semibold text-slate-300">ABC Transport LLC</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                ACTIVE
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Code: ABC-DXB · Dubai, UAE</div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition ${
                    active
                      ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {active && <ChevronRight className="w-3.5 h-3.5 opacity-80" />}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 text-[11px] text-slate-500 flex items-center justify-between">
          <span>Fleet360 Exchange v1.0</span>
          <Link href="/login" className="text-cyan-400 hover:underline flex items-center gap-1">
            <span>Log out</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 border-b border-slate-800 bg-slate-900/60 px-6 flex items-center justify-between backdrop-blur">
          <div className="text-xs font-semibold text-slate-400 flex items-center gap-2">
            <span>Partner Portal</span>
            <span>/</span>
            <span className="text-white capitalize">{pathname?.split('/')[2] || 'Dashboard'}</span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-mono">
              🇦🇪 UAE Dirham (AED)
            </span>
            <div className="w-8 h-8 rounded-full bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 font-bold flex items-center justify-center">
              P1
            </div>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
