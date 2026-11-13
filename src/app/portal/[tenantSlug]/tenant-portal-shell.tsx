'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { BACK_BUTTON } from '@/lib/ui/toggle';

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

const NAV_RAC: Array<{ href: string; label: string; icon: string; exact?: boolean }> = [
  { href: '/rac',            label: 'Fleet Overview',     icon: '🚗', exact: true },
  { href: '/rac/fleet',      label: 'Fleet Vehicles',     icon: '🚘' },
  { href: '/rac/customers',  label: 'Customer Portal',    icon: '👥' },
  { href: '/rac/bookings',   label: 'Bookings',           icon: '📅' },
  { href: '/rac/agreements', label: 'Rental Agreements',  icon: '📋' },
  { href: '/rac/invoices',   label: 'Invoices',           icon: '🧾' },
];

const NAV_SCHOOL_BUS: Array<{ href: string; label: string; icon: string; exact?: boolean }> = [
  { href: '/school-bus', label: 'Routes', icon: '🗺️', exact: true },
];

const NAV_FINANCE: Array<{ href: string; label: string; icon: string; exact?: boolean }> = [
  { href: '/finance', label: 'Dashboard', icon: '📊', exact: true },
];

const NAV_LEASING: Array<{ href: string; label: string; icon: string; exact?: boolean }> = [
  { href: '/leasing', label: 'Overview', icon: '📋', exact: true },
  { href: '/leasing/contracts', label: 'My Contracts', icon: '📜' },
  { href: '/leasing/invoices', label: 'My Invoices', icon: '🧾' },
  { href: '/leasing/documents', label: 'My Documents', icon: '📄' },
];

function slugifyPortalTenant(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const slug = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || null;
}

function matchesTenantSlug(
  slugLower: string,
  candidate: { id?: string | null; code?: string | null; name?: string | null },
): boolean {
  const options = [
    candidate.code?.trim().toLowerCase(),
    slugifyPortalTenant(candidate.code),
    slugifyPortalTenant(candidate.name),
    candidate.name?.trim().toLowerCase().replace(/\s+/g, '-'),
    candidate.id?.trim().toLowerCase(),
  ].filter((v): v is string => Boolean(v));
  return options.includes(slugLower);
}

const PLAN_COLORS: Record<string, string> = {
  ENTERPRISE: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  PROFESSIONAL: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  STANDARD: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  STARTER: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

/* ─────────────────────────── Sidebar ─────────────────────────── */
function Sidebar({ tenant, slug }: { tenant: TenantData | null; slug: string }) {
  const pathname = usePathname() ?? '';
  const base = `/portal/${slug}`;

  const hasRAC = tenant?.modules.some(m => ['RAC', 'rac', 'rental', 'RENTAL'].includes(m.module) && m.isEnabled) ?? false;
  const hasBus = tenant?.modules.some(m => ['SCHOOL_BUS', 'school_bus', 'school-bus'].includes(m.module) && m.isEnabled) ?? false;
  const hasLeasing = tenant?.modules.some(m => ['LEASING', 'leasing'].includes(m.module) && m.isEnabled) ?? false;

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
            {NAV_RAC.map(n => <NavItem key={n.href} {...n} exact={n.exact} />)}
            <a
              href="/rac-portal"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 px-3 py-2 mt-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/20 transition-all"
            >
              <span className="flex items-center gap-2 truncate">
                <span>🏢</span>
                <span className="truncate">Customer B2B Portal ↗</span>
              </span>
            </a>
          </NavGroup>
        )}

        {hasBus && (
          <NavGroup label="School Bus">
            {NAV_SCHOOL_BUS.map(n => <NavItem key={n.href} {...n} exact={n.exact} />)}
          </NavGroup>
        )}

        {hasLeasing && (
          <NavGroup label="Vehicle Leasing">
            {NAV_LEASING.map(n => <NavItem key={n.href} {...n} exact={n.exact} />)}
          </NavGroup>
        )}

        {tenant && (
          <NavGroup label="Finance">
            {NAV_FINANCE.map(n => <NavItem key={n.href} {...n} exact={n.exact} />)}
          </NavGroup>
        )}
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
          className={`${BACK_BUTTON} mt-2`}
        >
          <span>←</span>
          <span>Back to Platform</span>
        </Link>
      </div>
    </aside>
  );
}

/* ─────────────────────────── Shell ─────────────────────────── */
export default function TenantPortalShell({ children }: { children: React.ReactNode }) {
  const params = useParams() ?? {};
  const tenantSlug = (params?.tenantSlug as string) ?? '';

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchedUserSlug, setMatchedUserSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const slugLower = tenantSlug.trim().toLowerCase();
    if (!slugLower) {
      setTenant(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMatchedUserSlug(null);

    (async () => {
      try {
        const res = await fetch('/api/admin/tenants', { cache: 'no-store' });
        if (res.ok) {
          const raw = await res.json();
          const all: TenantData[] = Array.isArray(raw) ? raw : (raw?.tenants ?? raw?.data ?? []);
          const found = all.find(t => matchesTenantSlug(slugLower, t));
          if (!cancelled) {
            setTenant(found ?? null);
          }
          return;
        }

        // Fallback for non-admin staff roles (e.g. 403 on /api/admin/tenants):
        // resolve the authenticated user's own tenant via /api/admin/session + /api/auth/me.
        const [sessionRes, meRes] = await Promise.all([
          fetch('/api/admin/session', { cache: 'no-store' }).catch(() => null),
          fetch('/api/auth/me', { cache: 'no-store' }).catch(() => null),
        ]);

        const sessionData = sessionRes?.ok ? await sessionRes.json() : null;
        const meData = meRes?.ok ? await meRes.json() : null;

        const id: string | null = sessionData?.tenant?.id ?? meData?.tenantId ?? null;
        const name: string = sessionData?.tenant?.name ?? meData?.tenantName ?? '';
        const code: string = sessionData?.tenant?.code ?? meData?.tenantCode ?? '';
        const plan: string = sessionData?.tenant?.plan ?? meData?.plan ?? 'STANDARD';
        const enabledModules: string[] = Array.isArray(sessionData?.tenant?.enabledModules)
          ? sessionData.tenant.enabledModules
          : Array.isArray(meData?.enabledModules)
          ? meData.enabledModules
          : [];

        if (!id) {
          if (!cancelled) setTenant(null);
          return;
        }

        const expectedSlug =
          code?.trim().toLowerCase() ||
          slugifyPortalTenant(code) ||
          slugifyPortalTenant(name) ||
          id.toLowerCase();

        if (!matchesTenantSlug(slugLower, { id, code, name })) {
          if (!cancelled) {
            setMatchedUserSlug(expectedSlug);
            setTenant(null);
          }
          return;
        }

        if (!cancelled) {
          setTenant({
            id,
            name: name || code || id,
            code: code || slugLower.toUpperCase(),
            plan,
            modules: enabledModules.map((mod, idx) => ({
              id: `${id}-${mod}-${idx}`,
              module: mod,
              isEnabled: true,
            })),
          });
        }
      } catch (err) {
        console.error('[TenantPortal] fetch tenant:', err);
        if (!cancelled) setTenant(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const hasModule = (mod: string) => {
    const needle = mod.toLowerCase();
    const aliases =
      needle === 'rental' || needle === 'rac'
        ? ['rac', 'rental']
        : needle === 'school-bus' || needle === 'school_bus'
        ? ['school-bus', 'school_bus']
        : [needle];
    return tenant?.modules.some(m => aliases.includes(m.module.toLowerCase()) && m.isEnabled) ?? false;
  };

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
          ) : !tenant ? (
            <div className="flex items-center justify-center h-full p-6">
              <div className="max-w-md w-full rounded-2xl border border-rose-500/30 bg-slate-900/80 p-6 text-center space-y-4">
                <div className="text-3xl">🔒</div>
                <h2 className="text-lg font-bold text-white">Tenant not found or unauthorized</h2>
                <p className="text-sm text-slate-400">
                  You do not have access to tenant portal <span className="font-mono text-slate-200">{tenantSlug || '—'}</span>, or this tenant does not exist.
                </p>
                <div className="flex items-center justify-center gap-3 pt-2">
                  {matchedUserSlug && (
                    <Link
                      href={`/portal/${matchedUserSlug}`}
                      className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400 transition-colors"
                    >
                      Open My Tenant Portal →
                    </Link>
                  )}
                  <Link
                    href="/platform"
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 border border-white/10 text-xs font-semibold hover:bg-slate-700 transition-colors"
                  >
                    Back to Platform
                  </Link>
                </div>
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
