'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, ScanLine, AlertTriangle } from 'lucide-react';
import ChauffeurDriverIcon from '@/components/icons/ChauffeurDriverIcon';

export default function SchoolBusDriverLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) =>
    href === '/school-bus/driver' ? path === '/school-bus/driver' : path.startsWith(href);

  const tabs = [
    { href: '/school-bus/driver',          label: 'Trips',     Icon: ClipboardList },
    { href: '/school-bus/driver/scan',     label: 'Scan',      Icon: ScanLine },
    { href: '/school-bus/driver/incident', label: 'Incident',  Icon: AlertTriangle },
    { href: '/school-bus/driver/profile',  label: 'Me',        Icon: ChauffeurDriverIcon },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="sticky top-0 z-10 bg-gradient-to-r from-red-700 to-rose-700 px-4 py-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-red-100/70">Fleet360 SchoolBus</div>
            <div className="text-base font-bold">Driver</div>
          </div>
          <Link href="/school-bus" className="text-xs text-red-100/80 hover:text-white">Desktop</Link>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto pb-20 px-4 pt-4 max-w-2xl mx-auto w-full">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-white/10 px-1 pt-1 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4 max-w-2xl mx-auto">
          {tabs.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-xl text-[10px] ${active ? 'text-rose-300' : 'text-slate-400'}`}>
                <Icon className="w-5 h-5" strokeWidth={1.75} />
                <span className="font-medium">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
