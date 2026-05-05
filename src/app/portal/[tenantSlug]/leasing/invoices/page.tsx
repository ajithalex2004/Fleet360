'use client';

/**
 * Portal — Invoices (read-only).
 * Shows all invoices for the lessee. PDF download links per row.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

interface Invoice {
  id: string;
  invoiceNo: string | null;
  billingPeriod: string | null;
  issueDate: string;
  dueDate: string;
  subTotal: number;
  vatAmount: number;
  totalAmount: number;
  currency: string;
  status: string;
  paidAt?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  PAID: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  SENT: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  OVERDUE: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  DRAFT: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  CANCELLED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

export default function PortalInvoicesPage() {
  const params = useParams();
  const search = useSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const lesseeId = search.get('lesseeId') ?? '';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!lesseeId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/leasing/invoices?lesseeId=${lesseeId}`);
      const data = res.ok ? await res.json() : [];
      setInvoices(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [lesseeId]);

  useEffect(() => { load(); }, [load]);

  const totalOutstanding = invoices
    .filter(i => i.status !== 'PAID' && i.status !== 'CANCELLED')
    .reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);

  if (!lesseeId) {
    return (
      <div className="p-6">
        <p className="text-slate-400 text-sm">Pick a lessee first.</p>
        <Link href={`/portal/${tenantSlug}/leasing`} className="text-cyan-400 underline text-sm">
          ← Back to lessee picker
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href={`/portal/${tenantSlug}/leasing?lesseeId=${lesseeId}`}
          className="text-xs text-slate-500 hover:text-cyan-400"
        >
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-1">Invoices & Payments</h1>
        <p className="text-sm text-slate-400 mt-1">
          {invoices.length} invoice{invoices.length === 1 ? '' : 's'} ·
          AED {totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })} outstanding
        </p>
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
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">VAT</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(i => (
                <tr key={i.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-white">{i.invoiceNo ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{i.billingPeriod ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {i.issueDate ? new Date(i.issueDate).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {i.dueDate ? new Date(i.dueDate).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {Number(i.subTotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {Number(i.vatAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-white font-semibold">
                    {i.currency ?? 'AED'} {Number(i.totalAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        STATUS_COLORS[i.status] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                      }`}
                    >
                      {i.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Read-only view. Payment confirmations should be sent to your account manager.
      </p>
    </div>
  );
}
