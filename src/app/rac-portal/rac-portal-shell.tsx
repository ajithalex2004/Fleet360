'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  CalendarCheck,
  Car,
  CreditCard,
  FileSignature,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';

export type RacPortalUiRole =
  | 'RAC_B2B_VIEWER'
  | 'RAC_B2B_BOOKER'
  | 'RAC_B2B_FINANCE'
  | 'RAC_B2B_ADMIN'
  | 'RAC_B2B_USER';

export const BOOKING_PORTAL_ROLES: readonly RacPortalUiRole[] = [
  'RAC_B2B_BOOKER',
  'RAC_B2B_USER',
  'RAC_B2B_ADMIN',
];

export const FINANCE_PORTAL_ROLES: readonly RacPortalUiRole[] = [
  'RAC_B2B_FINANCE',
  'RAC_B2B_ADMIN',
];

export function canBookRacPortal(role: string | null | undefined): boolean {
  return Boolean(role && (BOOKING_PORTAL_ROLES as readonly string[]).includes(role));
}

export function canFinanceRacPortal(role: string | null | undefined): boolean {
  return Boolean(role && (FINANCE_PORTAL_ROLES as readonly string[]).includes(role));
}

export interface RacPortalMe {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    role: RacPortalUiRole;
    isActive: boolean;
  };
  customer: {
    id: string;
    fullName: string;
    companyName: string | null;
    email: string | null;
    phone: string | null;
    customerType: string;
    corporateCode: string | null;
    tradeLicense: string | null;
    vatNumber: string | null;
    paymentTermsDays: number;
    blacklisted: boolean;
    creditLimit: number;
    outstandingBalance: number;
    availableCredit: number;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  stats: {
    activeBookingsCount: number;
    activeAgreementsCount: number;
    activePreAuthCount: number;
    activePreAuthTotal: number;
  };
}

export function formatRacPortalRole(role: string | null | undefined): {
  shortLabel: string;
  fullLabel: string;
  badgeClass: string;
} {
  switch (role) {
    case 'RAC_B2B_ADMIN':
      return {
        shortLabel: 'Admin',
        fullLabel: 'Corporate B2B Admin',
        badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
      };
    case 'RAC_B2B_FINANCE':
      return {
        shortLabel: 'Finance',
        fullLabel: 'Corporate Finance',
        badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    case 'RAC_B2B_VIEWER':
      return {
        shortLabel: 'Viewer',
        fullLabel: 'Corporate Viewer',
        badgeClass: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
      };
    case 'RAC_B2B_BOOKER':
    case 'RAC_B2B_USER':
    default:
      return {
        shortLabel: 'Booker',
        fullLabel: 'Corporate Booker',
        badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
      };
  }
}

interface RacPortalContextValue {
  me: RacPortalMe | null;
  loading: boolean;
  refreshMe: () => Promise<void>;
}

const RacPortalContext = createContext<RacPortalContextValue>({
  me: null,
  loading: true,
  refreshMe: async () => {},
});

export function useRacPortal() {
  return useContext(RacPortalContext);
}

export function useRacPortalSession() {
  const { me, loading, refreshMe } = useContext(RacPortalContext);
  return {
    user: me?.user ?? null,
    customer: me?.customer ?? null,
    tenant: me?.tenant ?? null,
    stats: me?.stats ?? null,
    me,
    loading,
    refreshMe,
  };
}

const NAV_ITEMS = [
  { href: '/rac-portal', label: 'Overview', icon: LayoutDashboard, exact: true, adminOnly: false, bookingOnly: false },
  { href: '/rac-portal/book', label: 'Book Online', icon: Sparkles, exact: false, adminOnly: false, bookingOnly: true },
  { href: '/rac-portal/bookings', label: 'Reservations', icon: CalendarCheck, exact: false, adminOnly: false, bookingOnly: false },
  { href: '/rac-portal/agreements', label: 'Active Agreements', icon: FileSignature, exact: false, adminOnly: false, bookingOnly: false },
  { href: '/rac-portal/invoices', label: 'Billing & Card Holds', icon: CreditCard, exact: false, adminOnly: false, bookingOnly: false },
  { href: '/rac-portal/team', label: 'Team Access', icon: Users, exact: false, adminOnly: true, bookingOnly: false },
];

export default function RacPortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const isAuthSurface = useMemo(
    () => pathname?.startsWith('/rac-portal/login') || pathname?.startsWith('/rac-portal/setup'),
    [pathname],
  );

  const [me, setMe] = useState<RacPortalMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refreshMe = useCallback(async () => {
    try {
      const res = await fetch('/api/rac-portal/me', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/rac-portal/login');
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as RacPortalMe;
      setMe(data);
    } catch {
      router.replace('/rac-portal/login');
    }
  }, [router]);

  useEffect(() => {
    if (isAuthSurface) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/rac-portal/me', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) {
          router.replace('/rac-portal/login');
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as RacPortalMe;
          if (!cancelled) setMe(data);
        }
      } catch {
        if (!cancelled) router.replace('/rac-portal/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthSurface, router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    try {
      await fetch('/api/rac-portal/auth/logout', { method: 'POST' });
    } catch {
      // ignore network failure on logout
    }
    setMe(null);
    router.replace('/rac-portal/login');
  };

  if (isAuthSurface) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-900/20 via-slate-950 to-slate-950" />
        <div className="relative z-10 w-full flex justify-center">{children}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-9 h-9 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-400 tracking-wide">Loading Corporate Mobility Portal…</p>
        </div>
      </div>
    );
  }

  const isAdmin = me?.user.role === 'RAC_B2B_ADMIN';
  const canBook = canBookRacPortal(me?.user.role);
  const roleMeta = formatRacPortalRole(me?.user.role);
  const visibleNav = NAV_ITEMS.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.bookingOnly || canBook),
  );

  return (
    <RacPortalContext.Provider value={{ me, loading, refreshMe }}>
      <div className="flex flex-col h-screen bg-slate-950 text-white">
        {/* Top Enterprise Header */}
        <header className="border-b border-white/10 bg-slate-900/95 backdrop-blur px-4 lg:px-6 py-3 flex items-center gap-3 z-20">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <Link href="/rac-portal" className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Car className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-black tracking-tight text-white">
                Fleet<span className="text-cyan-400">360</span>
              </p>
              <p className="text-[10px] font-semibold text-cyan-300/80 uppercase tracking-widest">
                B2B Mobility Portal
              </p>
            </div>
          </Link>

          {me?.customer && (
            <div className="hidden md:flex items-center gap-2 ml-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 border border-white/10 text-xs font-medium text-slate-200">
                <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                {me.customer.companyName ?? me.customer.fullName}
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-[11px] font-medium text-cyan-300">
                {me.tenant.name}
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2.5 flex-wrap justify-end">
            {me && (
              <div className="hidden xl:flex items-center gap-2">
                {me.customer.creditLimit > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Credit Avail: AED {me.customer.availableCredit.toLocaleString('en-AE')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 border border-white/10 text-xs text-slate-300">
                    Net-{me.customer.paymentTermsDays || 30} Corporate Terms
                  </span>
                )}

                <Link
                  href="/rac-portal/invoices?tab=holds"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 font-medium hover:bg-amber-500/20 transition-colors"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Card Holds: AED {me.stats.activePreAuthTotal.toLocaleString('en-AE')} ({me.stats.activePreAuthCount})
                </Link>
              </div>
            )}

            {me?.user && (
              <div className="flex items-center gap-2 pl-2 border-l border-white/10">
                <div className="hidden sm:block text-right leading-tight">
                  <p className="text-xs font-semibold text-white">
                    {me.user.fullName ?? me.user.email}
                  </p>
                  <p className="text-[10px] text-slate-400">{roleMeta.fullLabel}</p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${roleMeta.badgeClass}`}
                >
                  {roleMeta.shortLabel}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-white/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden relative">
          {/* Sidebar Navigation */}
          <aside
            className={`${
              mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
            } fixed lg:static inset-y-0 left-0 z-30 w-64 flex-shrink-0 border-r border-white/10 bg-slate-900 px-3 py-5 flex flex-col justify-between transition-transform duration-200`}
          >
            <div className="space-y-1">
              {canBook && (
                <div className="px-3 pb-3 mb-2 border-b border-white/5">
                  <Link
                    href="/rac-portal/book"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 hover:opacity-95 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all"
                  >
                    <Sparkles className="w-4 h-4" />
                    Book Vehicle Online
                  </Link>
                </div>
              )}

              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = item.exact
                  ? pathname === item.href
                  : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      active
                        ? 'bg-gradient-to-r from-cyan-500/20 to-teal-500/15 text-cyan-200 border border-cyan-500/35'
                        : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      {item.label}
                    </span>
                    {item.href === '/rac-portal/bookings' && me && me.stats.activeBookingsCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold">
                        {me.stats.activeBookingsCount}
                      </span>
                    )}
                    {item.href === '/rac-portal/agreements' && me && me.stats.activeAgreementsCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                        {me.stats.activeAgreementsCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="px-3 pt-4 border-t border-white/10 space-y-2">
              <div className="rounded-xl bg-slate-800/60 border border-white/5 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  PCI-DSS Tokenized Holds
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Contracted corporate tariffs & instant security deposit pre-authorization.
                </p>
              </div>
            </div>
          </aside>

          {mobileOpen && (
            <div
              className="fixed inset-0 bg-black/60 z-20 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto bg-slate-950 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </RacPortalContext.Provider>
  );
}
