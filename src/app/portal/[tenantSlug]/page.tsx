'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTenantPortal } from './layout';
import { MODULE_BY_KEY, type ModuleKey } from '@/lib/modules';

/* ─────────────────────────── Types ─────────────────────────── */
interface ModuleBilling {
  module: string;
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED';
  nextBillingDate: string | null;
  monthlyFee: number;
  currency: string;
}

interface BillingSummary {
  tenantId: string;
  modules: ModuleBilling[];
  totalMonthlyFee: number;
  currency: string;
  outstandingAmount: number;
  overdueAmount: number;
}

interface PLData {
  summary?: {
    totalRevenue: number;
    totalCosts: number;
    grossProfit: number;
    currency: string;
  };
}

interface SubInvoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: string;
  dueDate: string;
  description: string;
}

/* ─────────────────────────── Helpers ─────────────────────────── */
function fmt(n: number, currency = 'AED') {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  TRIAL:     'bg-amber-500/20 text-amber-300 border-amber-500/30',
  SUSPENDED: 'bg-red-500/20 text-red-300 border-red-500/30',
  PAID:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  PENDING:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  OVERDUE:   'bg-red-500/20 text-red-300 border-red-500/30',
};

// ── Module meta for the subscription cards ──────────────────────────────────
//
// Subscription cards (line ~192) look up MODULE_META[m.module] where
// m.module is whatever the tenant has stored in tenant_modules. After the
// canonical-key migration (see prisma/migrations/20260624000002_*), this
// is always a canonical ModuleKey. We project MODULE_BY_KEY through a
// small map that adds the portal-specific emoji icon and a relative path
// (the registry stores an absolute href; the portal links are relative to
// the tenant slug).
//
// Keys are canonical ModuleKeys. To support any leftover pre-migration rows
// (where the DB might still hold 'rac' or 'school_bus'), we also project
// legacy aliases through the same map — see LEGACY_OVERRIDES below.

type ModuleMeta = { icon: string; label: string; path: string; color: string };

function projectMeta(key: ModuleKey): ModuleMeta {
  const m = MODULE_BY_KEY[key];
  return {
    icon:  PORTAL_ICONS[key],
    label: m.shortName ?? m.name,
    path:  m.href.replace(/^\//, ''),  // strip leading slash — tenant-relative
    color: m.gradient,
  };
}

// Portal-specific emoji glyphs (the registry uses lucide names; the portal
// keeps a consumer-friendly emoji set).
const PORTAL_ICONS: Readonly<Record<ModuleKey, string>> = {
  'service-tickets': '🎫',
  'agents':          '🤖',
  'maintenance':     '🔧',
  'leasing':         '📋',
  'rental':          '🚗',
  'bus-ops':         '🚌',
  'school-bus':      '🎒',
  'logistics':       '🚛',
  'incidents':       '🚨',
  'fleet':           '🚘',
  'driver-mgmt':     '👤',
  'customer-mgmt':   '🏢',
  'booking-portal':  '📲',
  'finance':         '💰',
  'compliance':      '⚖️',
  'customer':        '📱',
  'mobile-apps':     '📲',
  'reports':         '📊',
  'dispatch':        '🚦',
  'sustainability':  '🌱',
  'assets':          '📦',
};

// Curated subset of modules the portal shows prominently. These are the
// modules with billing/subscription UI in the tenant portal.
const PORTAL_FEATURED_KEYS: readonly ModuleKey[] = ['rental', 'bus-ops', 'school-bus', 'finance'];

const MODULE_META: Readonly<Record<string, ModuleMeta>> = Object.fromEntries(
  PORTAL_FEATURED_KEYS.map(k => [k, projectMeta(k)])
) as Record<string, ModuleMeta>;

// Legacy alias fallback — when a tenant's enabled_modules still contains a
// pre-migration value (e.g. 'rac'), this map routes it to the canonical
// meta. Once the migration runs and stale rows are cleaned up, this
// fallback is dead code. Kept for defense in depth.
const LEGACY_META_OVERRIDES: Readonly<Record<string, ModuleMeta>> = {
  rac:        projectMeta('rental'),
  school_bus: projectMeta('school-bus'),
};

/* ─────────────────────────── KPI Card ─────────────────────────── */
function KpiCard({ icon, label, value, sub, color = 'cyan' }: {
  icon: string; label: string; value: string; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    cyan:    'border-cyan-500/20 bg-cyan-500/5',
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
    amber:   'border-amber-500/20 bg-amber-500/5',
    red:     'border-red-500/20 bg-red-500/5',
    blue:    'border-blue-500/20 bg-blue-500/5',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colorMap[color] ?? colorMap.cyan}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────── Page ─────────────────────────── */
export default function TenantDashboard() {
  const params = useParams();
  const slug = (params?.tenantSlug as string) ?? '';
  const { tenant, hasModule } = useTenantPortal();

  const [billing, setBilling]   = useState<BillingSummary | null>(null);
  const [pl, setPL]             = useState<PLData | null>(null);
  const [invoices, setInvoices] = useState<SubInvoice[]>([]);
  const [loadingBilling, setLoadingBilling] = useState(true);
  const [loadingPL, setLoadingPL]           = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  const yearStart = today.slice(0, 4) + '-01-01';

  useEffect(() => {
    if (!tenant) return;

    // Billing
    fetch(`/api/billing?type=tenant_billing&tenantId=${tenant.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setBilling(d))
      .catch(() => {})
      .finally(() => setLoadingBilling(false));

    // P&L
    fetch(`/api/finance/management-accounts?type=income_statement&from=${yearStart}&to=${today}&tenantId=${tenant.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setPL(d))
      .catch(() => {})
      .finally(() => setLoadingPL(false));

    // Subscription invoices
    fetch(`/api/finance/invoices?clientTenantId=${tenant.id}&prefix=SUB&limit=10`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const rows = Array.isArray(d) ? d : d?.invoices ?? d?.data ?? [];
        setInvoices(rows);
      })
      .catch(() => {});
  }, [tenant, today, yearStart]);

  const activeModules = tenant?.modules.filter(m => m.isEnabled) ?? [];
  // After the canonical-key migration, tenants have modules stored as
  // ModuleKey (e.g. 'rental', 'school-bus'). The portal's local hasModule
  // does case-insensitive matching, so legacy keys still resolve, but we
  // check canonical keys here for clarity.
  const hasRAC = hasModule('rental');
  const hasBus = hasModule('school-bus');

  const revenue = pl?.summary?.totalRevenue ?? 0;
  const outstandingCount = invoices.filter(i => i.status !== 'PAID').length;
  const outstandingAmt = invoices.filter(i => i.status !== 'PAID').reduce((s, i) => s + i.amount, 0);

  const billingModules: ModuleBilling[] = billing?.modules ?? activeModules.map(m => ({
    module: m.module,
    status: 'ACTIVE' as const,
    nextBillingDate: null,
    monthlyFee: 0,
    currency: 'AED',
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Welcome header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Welcome back, {tenant?.name ?? 'Tenant'} 👋
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Tenant Portal · {slug}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            {tenant?.plan ?? '—'} Plan
          </span>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-700 text-slate-300 border border-slate-600">
            {activeModules.length} Module{activeModules.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Subscription status cards */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Module Subscriptions</h2>
        {loadingBilling ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="rounded-2xl border border-white/5 bg-slate-800/40 p-4 animate-pulse h-24" />
            ))}
          </div>
        ) : billingModules.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-slate-800/20 p-8 text-center">
            <p className="text-slate-500 text-sm">No module subscriptions found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {billingModules.map(m => {
              const meta = MODULE_META[m.module] ?? LEGACY_META_OVERRIDES[m.module] ?? { icon: '📦', label: m.module, path: '', color: 'from-slate-600 to-slate-500' };
              return (
                <div key={m.module} className="rounded-2xl border border-white/8 bg-slate-800/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{meta.icon}</span>
                      <span className="text-sm font-semibold text-white">{meta.label}</span>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[m.status] ?? STATUS_BADGE.PENDING}`}>
                      {m.status}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Monthly fee</span>
                      <span className="text-white font-medium">{fmt(m.monthlyFee, m.currency || 'AED')}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Next billing</span>
                      <span className="text-slate-300">{fmtDate(m.nextBillingDate)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* KPI row */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Quick KPIs</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon="💰"
            label="Revenue YTD"
            value={loadingPL ? '…' : fmt(revenue)}
            sub="From P&L statement"
            color="emerald"
          />
          <KpiCard
            icon="🧾"
            label="Outstanding Invoices"
            value={outstandingCount.toString()}
            sub={outstandingAmt > 0 ? fmt(outstandingAmt) + ' due' : 'All clear'}
            color={outstandingAmt > 0 ? 'red' : 'cyan'}
          />
          {hasRAC && (
            <KpiCard
              icon="🚗"
              label="Active Vehicles"
              value="—"
              sub="Visit Fleet page"
              color="blue"
            />
          )}
          {hasBus && (
            <KpiCard
              icon="🎒"
              label="Active Students"
              value="—"
              sub="Visit School Bus page"
              color="amber"
            />
          )}
          {!hasRAC && !hasBus && (
            <KpiCard icon="📦" label="Modules Active" value={activeModules.length.toString()} color="cyan" />
          )}
        </div>
      </section>

      {/* Outstanding subscription invoices */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Platform Subscription Invoices</h2>
          <Link href={`/portal/${slug}/finance`} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
            View all →
          </Link>
        </div>
        <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
          {invoices.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-slate-500 text-sm">No subscription invoices found</p>
              <p className="text-slate-600 text-xs mt-1">Platform invoices will appear here when raised</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Invoice #</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.slice(0, 8).map(inv => (
                  <tr key={inv.id} className="border-b border-white/5 hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-cyan-400">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-slate-300 truncate max-w-xs">{inv.description || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{fmt(inv.amount, inv.currency)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_BADGE[inv.status] ?? STATUS_BADGE.PENDING}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right text-xs ${inv.status === 'OVERDUE' ? 'text-red-400 font-semibold' : 'text-slate-400'}`}>
                      {fmtDate(inv.dueDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Module quick-access cards */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Quick Access</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {hasRAC && (() => {
            const m = MODULE_BY_KEY['rental'];
            const meta = MODULE_META['rental']!;
            return (
              <Link href={`/portal/${slug}/${meta.path}`} className="group rounded-2xl border border-white/8 bg-slate-800/40 hover:bg-slate-800/70 hover:border-blue-500/30 p-6 transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${m.gradient} flex items-center justify-center text-2xl flex-shrink-0`}>
                    {meta.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-white group-hover:text-blue-300 transition-colors">{meta.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Fleet · Bookings · Agreements</p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-600 group-hover:text-slate-400 transition-colors">Manage your rental fleet →</p>
              </Link>
            );
          })()}
          {hasBus && (() => {
            const m = MODULE_BY_KEY['school-bus'];
            const meta = MODULE_META['school-bus']!;
            return (
              <Link href={`/portal/${slug}/${meta.path}`} className="group rounded-2xl border border-white/8 bg-slate-800/40 hover:bg-slate-800/70 hover:border-amber-500/30 p-6 transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${m.gradient} flex items-center justify-center text-2xl flex-shrink-0`}>
                    {meta.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-white group-hover:text-amber-300 transition-colors">{meta.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Routes · Students · Attendance</p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-600 group-hover:text-slate-400 transition-colors">Manage student transport →</p>
              </Link>
            );
          })()}
          {(() => {
            const m = MODULE_BY_KEY['finance'];
            const meta = MODULE_META['finance']!;
            return (
              <Link href={`/portal/${slug}/${meta.path}`} className="group rounded-2xl border border-white/8 bg-slate-800/40 hover:bg-slate-800/70 hover:border-emerald-500/30 p-6 transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${m.gradient} flex items-center justify-center text-2xl flex-shrink-0`}>
                    {meta.icon}
                  </div>
                  <div>
                    <p className="font-semibold text-white group-hover:text-emerald-300 transition-colors">{meta.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">P&L · Invoices · Bank Recon</p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-600 group-hover:text-slate-400 transition-colors">View financial dashboard →</p>
              </Link>
            );
          })()}
        </div>
      </section>
    </div>
  );
}
