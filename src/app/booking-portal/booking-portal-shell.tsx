'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarCheck, PlusCircle, Clock, Bookmark, Sparkles, ShieldCheck } from 'lucide-react';
import PlatformHomeBar from '@/components/PlatformHomeBar';
import ModuleGuard from '@/components/ModuleGuard';

export default function BookingPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';

  const navItems = [
    { href: '/booking-portal', label: 'All Bookings', icon: CalendarCheck },
    { href: '/booking-portal/new', label: 'New Booking', icon: PlusCircle },
    { href: '/booking-portal/approvals', label: 'Pending Approvals', icon: Clock },
    { href: '/booking-portal/my-bookings', label: 'My Bookings', icon: Bookmark },
  ];

  return (
    <ModuleGuard moduleId="booking-portal" moduleName="Booking Portal" moduleIcon="📲">
      <div className="obsidian-glass dark [color-scheme:dark] flex flex-col h-screen bg-[#0b0d14] text-white selection:bg-cyan-500/30 selection:text-cyan-200">
        <PlatformHomeBar moduleName="Booking Portal" moduleIcon="🎫" accentColor="from-cyan-500 via-blue-500 to-indigo-600" />
        <div className="flex flex-1 overflow-hidden">
          {/* Frosted Obsidian Glass Sidebar */}
          <div className="w-64 border-r border-white/10 bg-[#0d111d]/85 backdrop-blur-xl overflow-y-auto flex flex-col justify-between flex-shrink-0">
            <div>
              {/* Header */}
              <div className="p-5 border-b border-white/10 bg-gradient-to-r from-cyan-950/30 via-slate-900/30 to-transparent">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white font-extrabold shadow-lg shadow-cyan-500/30">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h1 className="text-white font-bold text-sm tracking-wide">Booking Portal</h1>
                    <p className="text-xs text-slate-400">Fleet Reservations</p>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <nav className="p-3 space-y-1.5">
                {navItems.map((item) => {
                  const isActive = pathname === item.href || (item.href !== '/booking-portal' && pathname.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-transparent text-cyan-300 border-l-4 border-cyan-400 font-bold shadow-md shadow-cyan-500/15'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                      <span className="text-xs font-semibold tracking-wide">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
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
