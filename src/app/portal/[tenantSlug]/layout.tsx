'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

/* ─────────────────────────── Types ─────────────────────────── */
interface TenantModule {
  id: string;
  module: string;
  isEnabled: boolean;
}

interface TenantData {
  id: string;
  name: string;
  code: string;
  plan: string;
  modules: TenantModule[];
}

interface TenantContextType {
  tenant: TenantData | null;
  tenantSlug: string;
  loading: boolean;
  hasModule: (mod: string) => boolean;
}

/* ─────────────────────────── Context ─────────────────────────── */
const TenantContext = createContext<TenantContextType>({
  tenant: null,
  tenantSlug: '',
  loading: true,
  hasModule: () => false,
});

export function useTenantPortal() {
  return useContext(TenantContext);
}

/* ─────────────────────────── Nav config ─────────────────────────── */
const NAV_HOME = [
  { href: '', label: 'Dashboard', icon: '🏠', exact: true },
];

const NAV_RAC = [
  { href: '/rac', label: 'Fleet', icon: '🚗' },
  { href: '/rac/bookings', label: 'Bookings', icon: '📅' },
  { href: '/rac/agreements', label: 'Rental Agreements', icon: '📋' },
  { href: '/rac/customers', label: 'My Customers', icon: '👥' },
];

const NAV_SCHOOL_BUS = [
  { href: '/school-bus', label: 'Routes', icon: '🗺️' },
  { href: '/school-bus/students', label: 'Students', icon: '🎒' },
  { href: '/school-bus/attendance', label: 'Attendance', icon: '✅' },
  { href: '/school-bus/alerts', label: 'Parent Alerts', icon: '🔔' },
];

const NAV_FINANCE = [
  { href: '/finance', label: 'Dashboard', icon: '📊' },
  { href: '/finance/my-invoices', label: 'My Invoices', icon: '🧾' },
  { href: '/finance/customer-invoices', label: 'Customer Invoices', icon: '💳' },
  { href: '/finance/pl-report', label: 'P&L Report', icon: '📈' },
  { href: '/finance/bank-recon', label: 'Bank Recon', icon: '🏦' },
];

const NAV_SUPPORT = [
  { href: '/support', label: 'Help', icon: '❓' },
];

const PLAN_COLORS: Record<string, string> = {
  ENTERPRISE: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  PROFESSIONAL: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  STANDARD: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  STARTER: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

/* ─────────────────────────── Sidebar ─────────────────────────── */
function Sidebar({ tenant, slug }: { tenant: TenantData | null; slug: string }) {
  const pathname = usePathname();
  const base = `/portal/${slug}`;

  const hasRAC = tenant?.modules.some(m => m.module === 'RAC' && m.isEnabled) ?? false;
  const hasBus = tenant?.modules.some(m => ['SCHOOL_BUS', 'school_bus'].includes(m.module) && m.isEnabled) ?? false;

  function isActive(href: string, exact = false) {
    const full = base + href;
    if (exact) return pathname === full;
    return pathname.startsWith(full) && (href !== '' || pathname === full);
  }

  function NavItem({ href, label, icon, exact = false }: { href: string; label: string; icon: string; exact?: boolean }) {
    const active = isActive(href, exact);
    return (
      <Link
        href={base + href}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
          active
            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-medium'
            : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
        }`}
      >
        <span className="text-base leading-none">{icon}</span>
        <span className="truncate">{label}</span>
      </Link>
    );
  }

  function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className="mb-3">
        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600">{label}</p>
        <div className="space-y-0.5">{children}</div>
      </div>
    );
  }

  const planColor = tenant ? (PLAN_COLORS[tenant.plan] ?? PLAN_COLORS.STANDARD) : PLAN_COLORS.STANDARD;

  return (
    <aside className="w-60 flex-shrink-0 bg-slate-900 border-r border-white/8 flex flex-col overflow-y-auto">
      {/* Tenant header */}
      <div className="px-4 py-4 border-b border-white/8">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            {tenant?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{tenant?.name ?? 'Loading…'}</p>
            <p className="text-xs text-slate-500 truncate">{tenant?.code ?? slug}</p>
          </div>
        </div>
        {tenant && (
          <div className="mt-3">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${planColor}`}>
              {tenant.plan} PLAN
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3">
        <NavGroup label="Home">
          {NAV_HOME.map(n => <NavItem key={n.href} {...n} exact={n.exact} />)}
        </NavGroup>

        {hasRAC && (
          <NavGroup label="Rent-A-Car">
            {NAV_RAC.map(n => <NavItem key={n.href} {...n} />)}
          </NavGroup>
        )}

        {hasBus && (
          <NavGroup label="School Bus">
            {NAV_SCHOOL_BUS.map(n => <NavItem key={n.href} {...n} />)}
          </NavGroup>
        )}

        <NavGroup label="Finance">
          {NAV_FINANCE.map(n => <NavItem key={n.href} {...n} />)}
        </NavGroup>

        <NavGroup label="Support">
          {NAV_SUPPORT.map(n => <NavItem key={n.href} {...n} />)}
        </NavGroup>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/8">
        <div className="rounded-xl bg-slate-800/60 border border-white/5 p-3 text-center">
          <p className="text-[10px] text-slate-500 font-medium">Powered by</p>
          <p className="text-xs text-cyan-400 font-semibold mt-0.5">Smart Mobility</p>
          {tenant && (
            <p className="text-[10px] text-slate-600 mt-1 truncate">{tenant.plan} Tier</p>
          )}
        </div>
        <Link
          href="/platform"
          className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
        >
          <span>←</span>
          <span>Back to Platform</span>
        </Link>
      </div>
    </aside>
  );
}

/* ─────────────────────────── Layout ─────────────────────────── */
export default function TenantPortalLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantSlug) return;
    (async () => {
      try {
        const res = await fetch('/api/admin/tenants');
        if (!res.ok) throw new Error('Failed to fetch tenants');
        const all: TenantData[] = await res.json();
        const found = all.find(
          t => t.code?.toLowerCase() === tenantSlug.toLowerCase() ||
               t.name?.toLowerCase().replace(/\s+/g, '-') === tenantSlug.toLowerCase()
        );
        setTenant(found ?? null);
      } catch (err) {
        console.error('[TenantPortal] fetch tenant:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantSlug]);

  const hasModule = (mod: string) =>
    tenant?.modules.some(m => m.module.toLowerCase() === mod.toLowerCase() && m.isEnabled) ?? false;

  return (
    <TenantContext.Provider value={{ tenant, tenantSlug, loading, hasModule }}>
      <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
        <Sidebar tenant={tenant} slug={tenantSlug} />
        <main className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-slate-500 text-sm">Loading tenant portal…</p>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </TenantContext.Provider>
  );
}
