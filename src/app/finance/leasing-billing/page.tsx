'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Banknote, FileText, Gauge, Receipt, RefreshCw, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { usePermissions } from '@/contexts/PermissionContext';

const WORKSPACES = [
  {
    title: 'Leasing Invoices',
    href: '/finance/leasing-billing/invoices',
    icon: FileText,
    description: 'Create, approve, send, cancel, and reconcile lease invoices.',
    tag: 'sourceModule: leasing',
  },
  {
    title: 'Pre-Billing',
    href: '/finance/leasing-billing/pre-billing',
    icon: Receipt,
    description: 'Review draft billing statements before invoice creation.',
    tag: 'lease_pre_billing',
  },
  {
    title: 'Receivables',
    href: '/finance/leasing-billing/receivables',
    icon: Banknote,
    description: 'Track AR aging, dunning activity, overdue balances, and collections.',
    tag: 'lease_receivables',
  },
  {
    title: 'Receipts & Payments',
    href: '/finance/leasing-billing/payments',
    icon: RefreshCw,
    description: 'Record receipts, payments, direct debit activity, and settlement status.',
    tag: 'lease_cash',
  },
  {
    title: 'Operational Charges',
    href: '/finance/leasing-billing/traffic-fines',
    icon: Gauge,
    description: 'Manage fines, fuel, mileage overage, and billable operational charges.',
    tag: 'lease_chargeback',
  },
  {
    title: 'Approval & Audit Policy',
    href: '/approvals?sourceModule=leasing&category=billing',
    icon: ShieldCheck,
    description: 'Review dangerous billing actions queued for approval and audit.',
    tag: 'finance.leasing.approve',
  },
];

interface Reconciliation {
  totalLeasingInvoices: number;
  mirroredInvoices: number;
  missingFinanceMirror: number;
  totalMismatches: number;
  statusMismatches: number;
  duplicateMirrors: number;
  orphanFinanceMirrors: number;
  tenantMismatches: number;
  orphanRows: Array<{
    financeInvoiceId: string;
    referenceId: string | null;
    financeStatus: string | null;
    financeTotal: number;
    issue: 'ORPHAN' | 'TENANT_MISMATCH';
    leaseTenantId: string | null;
  }>;
  rows: Array<{
    leaseInvoiceId: string;
    invoiceNo: string | null;
    lesseeName: string | null;
    leasingStatus: string | null;
    financeStatus: string | null;
    leaseTotal: number;
    financeTotal: number | null;
    mirrored: boolean;
    statusMatches: boolean;
    duplicateMirrors: number;
    totalMatches: boolean;
  }>;
}

export default function FinanceLeasingBillingPage() {
  const { can } = usePermissions();
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState('');
  const canBackfill =
    can('finance', 'edit', 'leasing_billing') ||
    can('finance', 'create', 'leasing_billing') ||
    can('finance', 'approve', 'leasing_billing') ||
    can('leasing', 'approve', 'invoices');

  const loadReconciliation = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/finance/leasing-billing/reconciliation', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load reconciliation');
      setReconciliation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadReconciliation(); }, [loadReconciliation]);

  const runBackfill = async () => {
    setBackfilling(true);
    setError('');
    try {
      const res = await fetch('/api/finance/leasing-billing/reconciliation', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Backfill failed');
      setReconciliation(data.reconciliation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leasing Billing"
        subtitle="Finance-owned control plane for Vehicle Leasing invoices, pre-billing, AR, receipts, and chargebacks"
        icon={Banknote}
        accent="emerald"
      />

      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-200">Canonical finance location</p>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">
              These records still originate from Vehicle Leasing, but financial ownership sits in Finance & Billing.
              Every record should remain identifiable by tenant, corporate customer, contract, vehicle, and source module.
            </p>
          </div>
          <Link
            href="/leasing"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200 hover:border-emerald-400/40 hover:text-white"
          >
            Leasing operations <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">Leasing to Finance reconciliation</p>
            <p className="mt-1 text-sm text-slate-400">
              Confirms every Leasing invoice has a Finance mirror tagged with source module, source invoice, customer, and contract references.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadReconciliation}
              disabled={loading || backfilling}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              onClick={runBackfill}
              disabled={loading || backfilling || (
                !canBackfill ||
                !(reconciliation?.missingFinanceMirror ?? 0) &&
                !(reconciliation?.totalMismatches ?? 0) &&
                !(reconciliation?.orphanFinanceMirrors ?? 0) &&
                !(reconciliation?.tenantMismatches ?? 0) &&
                !(reconciliation?.duplicateMirrors ?? 0)
              )}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {backfilling ? 'Backfilling...' : 'Backfill Finance Mirrors'}
            </button>
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

        <div className="mt-5 grid gap-3 md:grid-cols-4 xl:grid-cols-6">
          {[
            ['Leasing invoices', reconciliation?.totalLeasingInvoices ?? 0, 'text-white'],
            ['Finance mirrors', reconciliation?.mirroredInvoices ?? 0, 'text-emerald-300'],
            ['Missing mirrors', reconciliation?.missingFinanceMirror ?? 0, (reconciliation?.missingFinanceMirror ?? 0) > 0 ? 'text-amber-300' : 'text-slate-300'],
            ['Amount mismatches', reconciliation?.totalMismatches ?? 0, (reconciliation?.totalMismatches ?? 0) > 0 ? 'text-rose-300' : 'text-slate-300'],
            ['Status mismatches', reconciliation?.statusMismatches ?? 0, (reconciliation?.statusMismatches ?? 0) > 0 ? 'text-rose-300' : 'text-slate-300'],
            ['Duplicate mirrors', reconciliation?.duplicateMirrors ?? 0, (reconciliation?.duplicateMirrors ?? 0) > 0 ? 'text-rose-300' : 'text-slate-300'],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
              <p className={`mt-2 text-2xl font-bold ${color}`}>{loading ? '-' : value}</p>
            </div>
          ))}
        </div>

        {reconciliation?.rows?.some(row => !row.mirrored || !row.totalMatches || !row.statusMatches || row.duplicateMirrors > 1) && (
          <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/80 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Leasing</th>
                  <th className="px-4 py-3">Finance</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reconciliation.rows.filter(row => !row.mirrored || !row.totalMatches || !row.statusMatches || row.duplicateMirrors > 1).slice(0, 8).map(row => (
                  <tr key={row.leaseInvoiceId} className="bg-slate-900/60">
                    <td className="px-4 py-3 font-mono text-xs text-slate-200">{row.invoiceNo ?? row.leaseInvoiceId.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-slate-300">{row.lesseeName ?? '-'}</td>
                    <td className="px-4 py-3 text-slate-300">{row.leasingStatus ?? '-'}</td>
                    <td className="px-4 py-3 text-amber-300">{row.mirrored ? row.financeStatus ?? '-' : 'Missing mirror'}</td>
                    <td className="px-4 py-3 text-xs text-slate-300">
                      {!row.mirrored ? 'Missing mirror' : row.duplicateMirrors > 1 ? `Duplicate x${row.duplicateMirrors}` : !row.statusMatches ? 'Status mismatch' : !row.totalMatches ? 'Amount mismatch' : 'Healthy'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200">AED {row.leaseTotal.toLocaleString('en-AE')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {Boolean((reconciliation?.orphanRows?.length ?? 0) > 0) && (
          <div className="mt-5 overflow-hidden rounded-xl border border-rose-500/20">
            <div className="border-b border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200">
              Orphan or tenant-mismatch Finance mirrors
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/80 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Finance Invoice</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Issue</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reconciliation?.orphanRows?.slice(0, 8).map(row => (
                  <tr key={row.financeInvoiceId} className="bg-slate-900/60">
                    <td className="px-4 py-3 font-mono text-xs text-slate-200">{row.financeInvoiceId.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-slate-300">{row.referenceId ?? '-'}</td>
                    <td className="px-4 py-3 text-rose-300">{row.issue === 'TENANT_MISMATCH' ? 'Tenant mismatch' : 'Orphan mirror'}</td>
                    <td className="px-4 py-3 text-right text-slate-200">AED {row.financeTotal.toLocaleString('en-AE')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {WORKSPACES.map(item => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition-all hover:border-emerald-400/40 hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-1 group-hover:text-emerald-300" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-white">{item.title}</h2>
              <p className="mt-2 min-h-12 text-sm leading-6 text-slate-400">{item.description}</p>
              <span className="mt-4 inline-flex rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                {item.tag}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <p className="text-sm font-semibold text-white">Multi-tenant assignment rule</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Full finance teams should receive Finance & Billing access. Leasing-only tenants can still access this workspace
          when Vehicle Leasing is enabled, while broader finance pages stay protected by the Finance module subscription.
        </p>
      </div>
    </div>
  );
}
