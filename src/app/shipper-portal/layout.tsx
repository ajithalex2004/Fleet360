'use client';

/**
 * Shipper Portal layout.
 *
 * Two visual modes:
 *   • Auth pages (/login, /setup)  — minimal background, no chrome.
 *     We don't have a user yet, so there's nothing to render in a header.
 *   • Portal pages (everything else) — full chrome: branded top bar, slim
 *     side nav, customer name pill, logout. Fetches /api/shipper-portal/me
 *     on mount; redirects to /login on 401.
 *
 * Visual accent is teal/emerald to differentiate from tenant operator
 * surfaces (blue/violet) so it's clear at a glance which side a user is
 * looking at.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Ship, LayoutDashboard, PackageOpen, Plus, LogOut } from 'lucide-react';

interface PortalMe {
  user: { id: string; email: string; fullName: string | null; role: string };
  customer: {
    id: string; nameEn: string | null; nameAr: string | null;
    email: string | null; phone: string | null;
    portalTrackingLevel: string;
  } | null;
}

const NAV = [
  { href: '/shipper-portal',           label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/shipper-portal/shipments', label: 'Shipments', icon: PackageOpen,    exact: false },
];

export default function ShipperPortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // Auth surfaces — no chrome, no session check.
  const isAuthSurface = useMemo(
    () => pathname?.startsWith('/shipper-portal/login') || pathname?.startsWith('/shipper-portal/setup'),
    [pathname],
  );

  const [me, setMe] = useState<PortalMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthSurface) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/shipper-portal/me', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) {
          router.replace('/shipper-portal/login');
          return;
        }
        if (!res.ok) { setLoading(false); return; }
        const data = await res.json();
        setMe(data);
      } catch {
        // Network failure — surface as login redirect.
        if (!cancelled) router.replace('/shipper-portal/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthSurface, router]);

  const logout = async () => {
    await fetch('/api/shipper-portal/auth/logout', { method: 'POST' });
    router.replace('/shipper-portal/login');
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
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Render portal chrome
  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Top bar */}
      <header className="border-b border-white/10 bg-slate-900 px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Ship className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">Fleet360</p>
            <p className="text-[10px] text-emerald-300 uppercase tracking-wider">Shipper Portal</p>
          </div>
        </div>

        {me?.customer && (
          <span className="ml-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {me.customer.nameEn ?? 'Organisation'}
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
        {/* Sidebar */}
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
                    ? 'bg-gradient-to-r from-emerald-600/30 to-teal-600/30 text-emerald-200 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}>
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
          <div className="border-t border-white/5 my-3" />
          <Link href="/shipper-portal/shipments/new"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white">
            <Plus className="w-4 h-4" /> New Shipment
          </Link>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8 bg-slate-950 text-white">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
