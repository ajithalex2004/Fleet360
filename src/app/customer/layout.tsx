'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import PlatformHomeBar from '@/components/PlatformHomeBar';

import ModuleGuard from '@/components/ModuleGuard';
export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const tabs = [
    { label: 'Home', href: '/customer', icon: '🏠' },
    { label: 'Bookings', href: '/customer/my-bookings', icon: '📅' },
    { label: 'Services', href: '/customer/my-services', icon: '🚗' },
    { label: 'Profile', href: '/customer/profile', icon: '👤' },
  ];

  return (
    <ModuleGuard moduleId="customer" moduleName="Customer App" moduleIcon="📱">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName="Customer Portal" moduleIcon="👤" accentColor="from-blue-500 to-indigo-600" />
      {/* Main Content */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {children}
        </div>
      </div>

      {/* Bottom Tab Navigation */}
      <div className="border-t border-white/10 bg-slate-800/50 backdrop-blur">
        <div className="grid grid-cols-4 gap-0">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center py-4 px-2 text-xs font-medium transition-all ${
                pathname === tab.href
                  ? 'text-blue-400 bg-blue-500/10 border-t-2 border-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              <span className="text-2xl mb-1">{tab.icon}</span>
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
