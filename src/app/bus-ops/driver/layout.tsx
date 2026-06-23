'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) =>
    href === '/bus-ops/driver' ? path === '/bus-ops/driver' : path.startsWith(href);

  const tabs = [
    { href: '/bus-ops/driver',         label: 'Today',     icon: '📋' },
    { href: '/bus-ops/driver/incident', label: 'Incident',  icon: '⚠️' },
    { href: '/bus-ops/driver/profile',  label: 'Me',        icon: '🤵' },
  ];

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-white flex flex-col">
      <header className="sticky top-0 z-10 bg-gradient-to-r from-violet-700 to-purple-700 px-4 py-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-violet-100/70">Fleet360 STS</div>
            <div className="text-base font-bold">Driver</div>
          </div>
          <Link href="/bus-ops" className="text-xs text-violet-100/80 hover:text-white">Desktop</Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-20 px-4 pt-4 max-w-2xl mx-auto w-full">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-white/10 px-1 pt-1 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-3 max-w-2xl mx-auto">
          {tabs.map(t => {
            const active = isActive(t.href);
            return (
              <Link key={t.href} href={t.href}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-xl text-[10px] ${active ? 'text-violet-300' : 'text-slate-400'}`}>
                <span className="text-2xl">{t.icon}</span>
                <span className="font-medium">{t.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
