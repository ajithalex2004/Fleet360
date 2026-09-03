'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Car, LayoutDashboard, FileText, Receipt, FolderOpen, AlertTriangle, LogOut } from 'lucide-react';
import { requestServerLogout } from '@/lib/client-session';

interface PortalMe {
  user: { id: string; email: string; fullName: string | null; role: string };
  lessee: { id: string; name: string; type: string } | null;
}

const NAV = [
  { href: '/leasing-portal',                label: 'Dashboard',      icon: LayoutDashboard, exact: true },
  // Renewal / early-termination self-service requests live on the
  // Contracts page (one action per contract) rather than their own nav
  // item — there's nothing else to show there.
  { href: '/leasing-portal/contracts',      label: 'Contracts',      icon: FileText,        exact: false },
  { href: '/leasing-portal/invoices',       label: 'Invoices & Pay', icon: Receipt,         exact: false },
  { href: '/leasing-portal/documents',      label: 'Documents',      icon: FolderOpen,      exact: false },
  { href: '/leasing-portal/damage-reports', label: 'Damage Reports', icon: AlertTriangle,   exact: false },
];

export default function LeasingPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const isAuthSurface = useMemo(
    () => pathname?.startsWith('/leasing-portal/login') || pathname?.startsWith('/leasing-portal/setup'),
    [pathname],
  );

  const [me, setMe] = useState<PortalMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthSurface) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/leasing-portal/me', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) {
          router.replace('/leasing-portal/login');
          return;
        }
        if (!res.ok) { setLoading(false); return; }
        const data = await res.json();
        setMe(data);
      } catch {
        if (!cancelled) router.replace('/leasing-portal/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthSurface, router]);

  const logout = () => {
    requestServerLogout('/api/leasing-portal/auth/logout');
    router.replace('/leasing-portal/login');
  };

  if (isAuthSurface) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        {children}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      <header className="border-b border-white/10 bg-slate-900 px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center">
            <Car className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">Fleet360</p>
            <p className="text-[10px] text-cyan-300 uppercase tracking-wider">Leasing Portal</p>
          </div>
        </div>

        {me?.lessee && (
          <span className="ml-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            {me.lessee.name}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {me?.user && (
            <span className="text-xs text-slate-400">
              {me.user.fullName ?? me.user.email}
            </span>
          )}
          <button onClick={logout}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5">
            <LogOut className="w-3.5 h-3.5" /> Log out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-56 flex-shrink-0 border-r border-white/10 bg-slate-900 px-3 py-4 space-y-1">
          {NAV.map(item => {
            const Icon = item.icon;
            const active = item.exact
              ? pathname === item.href
              : pathname?.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                  active
                    ? 'bg-gradient-to-r from-cyan-600/30 to-teal-600/30 text-cyan-200 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}>
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-y-auto p-8 bg-slate-950 text-white">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
