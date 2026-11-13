'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { BACK_BUTTON } from '@/lib/ui/toggle';
import { useVerifiedPortalTenant } from '../_use-verified-portal-tenant';

interface Invoice {
  id: string;
  customerId?: string | null;
  customer_id?: string | null;
  companyName?: string | null;
  company_name?: string | null;
  customerName?: string | null;
  customer_full_name?: string | null;
  customer_name?: string | null;
  invoiceNo?: string | null;
  invoice_no?: string | null;
  invoiceDate: string;
  invoice_date?: string;
  dueDate: string;
  due_date?: string;
  subtotal: number;
  taxAmount: number;
  tax_amount?: number;
  totalAmount: number;
  total_amount?: number;
  paidAmount: number;
  paid_amount?: number;
  balanceDue: number | null;
  balance_due?: number | null;
  currency: string;
  status: string;
  customer?: {
    fullName?: string | null;
    companyName?: string | null;
  } | null;
}

function unwrapInvoices(payload: unknown): Invoice[] {
  if (Array.isArray(payload)) return payload as Invoice[];
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    for (const k of ['data', 'invoices', 'items', 'rows']) {
      if (Array.isArray(rec[k])) return rec[k] as Invoice[];
    }
  }
  return [];
}

const STATUS_BG: Record<string, string> = {
  PAID: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  SENT: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  OVERDUE: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  DRAFT: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
  VOID: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
};

function PortalRacInvoicesInner() {
  const params = useParams() ?? {};
  const search = useSearchParams() ?? new URLSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const customerId = search.get('customerId') ?? '';
  const guard = useVerifiedPortalTenant(tenantSlug);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = customerId ? `?customerId=${encodeURIComponent(customerId)}&limit=200` : '?limit=200';
      const res = await fetch(`/api/rental/invoices${qs}`, { cache: 'no-store' });
      const data = res.ok ? await res.json() : [];
      const rows = unwrapInvoices(data);
      const filtered = customerId
        ? rows.filter((i) => (i.customerId ?? i.customer_id) === customerId)
        : rows;
      setInvoices(filtered);
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (guard.status !== 'verified') return;
    load();
  }, [guard.status, load]);

  const totalOutstanding = invoices
    .filter((i) => !['PAID', 'CANCELLED', 'VOID'].includes(i.status))
    .reduce((s, i) => s + Number(i.balanceDue ?? i.balance_due ?? i.totalAmount ?? i.total_amount ?? 0), 0);

  if (guard.status === 'checking') {
    return <div className="p-6 text-slate-500">Verifying tenant access…</div>;
  }

  if (guard.status === 'mismatch') {
    const targetPath = guard.expectedSlug
      ? `/portal/${guard.expectedSlug}/rac/invoices${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''}`
      : null;
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 space-y-3">
          <p className="text-rose-300 font-semibold text-base">Tenant Access Mismatch</p>
          <p className="text-slate-300 text-sm">
            Your signed-in session belongs to <span className="font-semibold text-white">{guard.tenant.name}</span>
            {guard.tenant.slug ? ` (${guard.tenant.slug})` : ''}, which does not match{' '}
            <span className="font-mono text-rose-200">/portal/{tenantSlug}/rac/invoices</span>. Cross-tenant invoice data display has been blocked.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {targetPath && (
              <Link
                href={targetPath}
                className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400 transition-colors"
              >
                Switch to /portal/{guard.expectedSlug}/rac/invoices →
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
    );
  }

  if (guard.status === 'unauthorized') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 space-y-3">
          <p className="text-amber-300 font-semibold text-base">Authentication Required</p>
          <p className="text-slate-300 text-sm">
            Unable to verify your tenant session for <span className="font-mono text-amber-200">/portal/{tenantSlug}/rac/invoices</span>.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors"
          >
            Go to Staff Sign In →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <Link
            href={customerId ? `/portal/${tenantSlug}/rac/customers?customerId=${customerId}` : `/portal/${tenantSlug}/rac`}
            className={BACK_BUTTON}
          >
            ← {customerId ? 'Back to customer dashboard' : 'Back to RAC overview'}
          </Link>
          <h1 className="text-2xl font-bold mt-1">Invoices & Payments</h1>
          <p className="text-sm text-slate-400 mt-1">
            {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
            {totalOutstanding > 0 && (
              <> · <span className="text-rose-300">AED {totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })} outstanding</span></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/portal/${tenantSlug}/rac/customers`}
            className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            👥 Filter by Customer
          </Link>
          <a
            href="/rac-portal"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition-colors"
          >
            🏢 Customer B2B Portal ↗
          </a>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : invoices.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No invoices on record.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Invoice No.</th>
                {!customerId && <th className="px-4 py-3">Customer</th>}
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">VAT</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">PDF</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const invNo = i.invoiceNo ?? i.invoice_no ?? i.id.slice(0, 8);
                const issued = i.invoiceDate ?? i.invoice_date ?? '';
                const due = i.dueDate ?? i.due_date ?? '';
                const tax = i.taxAmount ?? i.tax_amount ?? 0;
                const total = i.totalAmount ?? i.total_amount ?? 0;
                const paid = i.paidAmount ?? i.paid_amount ?? 0;
                const bal = i.balanceDue ?? i.balance_due;
                const custName =
                  i.companyName ??
                  i.customerName ??
                  i.company_name ??
                  i.customer_full_name ??
                  i.customer_name ??
                  i.customer?.companyName ??
                  i.customer?.fullName ??
                  '—';
                return (
                  <tr key={i.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-cyan-300 text-xs">{invNo}</td>
                    {!customerId && <td className="px-4 py-3 text-slate-300 text-xs">{custName}</td>}
                    <td className="px-4 py-3 text-slate-300 text-xs">{issued ? new Date(issued).toLocaleDateString('en-GB') : '—'}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{due ? new Date(due).toLocaleDateString('en-GB') : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{Number(i.subtotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{Number(tax).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right text-white font-semibold">
                      {i.currency || 'AED'} {Number(total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-300">{Number(paid).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right">
                      {bal != null && Number(bal) > 0 ? (
                        <strong className="text-rose-300">{Number(bal).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_BG[i.status] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                        {i.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <a
                          href={`/api/rental/invoices/${i.id}/pdf?lang=en&download=1`}
                          className="text-emerald-400 hover:text-emerald-300 text-xs"
                        >
                          EN
                        </a>
                        <span className="text-slate-700">·</span>
                        <a
                          href={`/api/rental/invoices/${i.id}/pdf?lang=ar&download=1`}
                          className="text-emerald-400 hover:text-emerald-300 text-xs"
                        >
                          AR
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500 italic">
        Read-only view. Online card payment and pre-authorization ledger are available in the standalone B2B portal (/rac-portal/invoices).
      </p>
    </div>
  );
}

export default function PortalRacInvoicesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-500">Loading invoices…</div>}>
      <PortalRacInvoicesInner />
    </Suspense>
  );
}
