'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlatformHomeBar from '@/components/PlatformHomeBar';

import ModuleGuard from '@/components/ModuleGuard';
function isActive(pathname: string, href: string) {
  if (href.split('/').length === 2) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

const nav = [
  { href: '/customer-mgmt',           label: 'Customers',          icon: 'C' },
  { href: '/customer-mgmt/hierarchy', label: 'Hierarchy Setup',    icon: 'H' },
];

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ModuleGuard moduleId="customer-mgmt" moduleName="Customer Management" moduleIcon="🏢">
    <div className="flex flex-col h-screen bg-slate-900">
      <PlatformHomeBar moduleName="Customer Management" moduleIcon="C" accentColor="from-cyan-500 to-blue-600" />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 border-r border-white/10 bg-black overflow-y-auto flex-shrink-0">
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">C</div>
              <div>
                <p className="text-white font-semibold text-sm">Customers</p>
                <p className="text-slate-400 text-xs">XL AI Smart Mobility</p>
              </div>
            </div>
          </div>
          <nav className="p-3 space-y-1">
            {nav.map(item => (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${isActive(pathname, item.href) ? 'bg-cyan-500/20 text-white border border-cyan-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 ${isActive(pathname, item.href) ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-400'}`}>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto bg-slate-900">
          {children}
        </main>
      </div>
    </div>
  
    </ModuleGuard>
  );
}
