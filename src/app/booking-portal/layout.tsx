'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';

import ModuleGuard from '@/components/ModuleGuard';
export default function BookingPortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navItems = [
    { href: '/booking-portal', label: 'All Bookings', icon: '📋' },
    { href: '/booking-portal/new', label: 'New Booking', icon: '➕' },
    { href: '/booking-portal/approvals', label: 'Pending Approvals', icon: '⏳' },
    { href: '/booking-portal/my-bookings', label: 'My Bookings', icon: '📌' },
  ];

  return (
    <ModuleGuard moduleId="booking-portal" moduleName="Booking Portal" moduleIcon="📲">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName="Booking Portal" moduleIcon="🎫" accentColor="from-violet-500 to-purple-600" />
      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-white/10 bg-black overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
              <span className="text-lg">🎫</span>
            </div>
            <div>
              <h1 className="text-white font-bold">Booking Portal</h1>
              <p className="text-xs text-slate-400">Reservations</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-violet-500/20 to-purple-500/20 text-violet-400 border border-violet-500/30'
                    : 'text-slate-400 hover:bg-white/5'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </div>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
