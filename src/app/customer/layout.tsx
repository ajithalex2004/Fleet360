'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BriefcaseBusiness,
  CalendarDays,
  CarFront,
  ChevronRight,
  Home,
  LogOut,
  Menu,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';

interface CustomerIdentity {
  customerId: string;
  customerName: string;
  domain: string;
  role: string;
}

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [identity, setIdentity] = useState<CustomerIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);

  const tabs = useMemo(() => [
    { label: 'Home', href: '/customer', icon: Home },
    { label: 'Bookings', href: '/customer/my-bookings', icon: CalendarDays },
    { label: 'Services', href: '/customer/my-services', icon: CarFront },
    { label: 'Profile', href: '/customer/profile', icon: UserRound },
  ], []);

  useEffect(() => {
    let mounted = true;
    fetch('/api/customer/identity', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!mounted) return;
        setIdentity(data?.customer ?? null);
      })
      .catch(() => {
        if (mounted) setIdentity(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('xl_mobility_session');
    window.location.href = '/login';
  };

  const nav = (
    <nav className="space-y-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={() => setNavOpen(false)}
            className={`flex h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition ${
              active
                ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/30'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07111f] text-white">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="min-h-screen bg-[#07111f] px-4 py-10 text-white">
        <div className="mx-auto max-w-lg rounded-lg border border-white/10 bg-slate-900/80 p-6 shadow-2xl">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-amber-400/15 text-amber-200">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold">Customer access not assigned</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Your sign-in is valid, but this account is not linked to a corporate customer portal.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/platform" className="rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5">
              Open platform
            </Link>
            <button onClick={signOut} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07111f] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07111f]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 text-slate-200 hover:bg-white/5 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-400 text-slate-950">
              <BriefcaseBusiness className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-cyan-100">{identity.customerName}</p>
              <p className="truncate text-xs text-slate-400">{identity.domain || 'Corporate customer portal'}</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <span className="rounded-md border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
              {identity.role.replace(/^CUSTOMER_/, '').replace('_', ' ')}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm font-semibold text-slate-200 hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 lg:grid-cols-[260px_1fr]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] border-r border-white/10 p-4 lg:block">
          {nav}
          <div className="mt-6 rounded-md border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Account</p>
            <p className="mt-2 text-sm font-semibold text-white">{identity.customerName}</p>
            <p className="mt-1 text-xs text-slate-400">{identity.domain || 'Managed by tenant admin'}</p>
          </div>
        </aside>

        <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#07111f]/95 backdrop-blur lg:hidden">
        <div className="grid grid-cols-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  active ? 'text-cyan-200' : 'text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-80 max-w-[86vw] border-r border-white/10 bg-[#091526] p-4 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">{identity.customerName}</p>
                <p className="text-xs text-slate-400">{identity.domain}</p>
              </div>
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-slate-200"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            <button
              type="button"
              onClick={signOut}
              className="mt-6 flex h-11 w-full items-center justify-between rounded-md border border-white/10 px-3 text-sm font-semibold text-slate-200"
            >
              Sign out
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
