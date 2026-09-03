'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function BookingPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';

  const navItems = [
    { href: '/booking-portal', label: 'All Bookings', icon: '📋' },
    { href: '/booking-portal/new', label: 'New Booking', icon: '➕' },
    { href: '/booking-portal/approvals', label: 'Pending Approvals', icon: '⏳' },
    { href: '/booking-portal/my-bookings', label: 'My Bookings', icon: '📌' },
  ];

  return (
    <ModuleGuard moduleId="booking-portal" moduleName="Booking Portal" moduleIcon="📲">
      <div className="flex flex-col h-screen bg-[#09090b] text-white">
        <PlatformHomeBar moduleName="Booking Portal" moduleIcon="🎫" accentColor="from-amber-500 via-yellow-500 to-amber-600" />
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 border-r border-amber-500/20 bg-zinc-950/95 overflow-y-auto flex flex-col justify-between">
            <div>
              {/* Header */}
              <div className="p-6 border-b border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-zinc-900/40 to-transparent">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-yellow-500 to-amber-600 flex items-center justify-center text-black shadow-lg shadow-amber-500/20">
                    <span className="text-lg">🎫</span>
                  </div>
                  <div>
                    <h1 className="text-white font-bold text-sm tracking-wide">Booking Portal</h1>
                    <p className="text-[11px] font-mono text-amber-300/80">Executive Mobility</p>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <nav className="p-4 space-y-2">
                {navItems.map((item) => {
                  const isActive = pathname === item.href || (item.href !== '/booking-portal' && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-transparent text-amber-300 border-l-4 border-amber-400 font-bold shadow-md shadow-amber-500/10'
                          : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className="text-lg">{item.icon}</span>
                      <span className="text-xs font-semibold tracking-wide">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Bottom Status Badge */}
            <div className="p-4 border-t border-amber-500/20 bg-zinc-950">
              <div className="bg-zinc-900/80 border border-amber-500/20 rounded-xl p-3 flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <div>
                  <p className="text-[10px] font-mono font-bold text-amber-300 uppercase">Universal Engine</p>
                  <p className="text-[11px] text-zinc-400">All 6 Mobility Modes</p>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-auto bg-[#09090b]">
            <div className="p-6 md:p-8 max-w-7xl mx-auto">{children}</div>
          </div>
        </div>
      </div>
    </ModuleGuard>
  );
}
