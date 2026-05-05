'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

interface Invoice {
  id: string;
  invoiceNo: string | null;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number | null;
  currency: string;
  status: string;
}

const STATUS_BG: Record<string, string> = {
  PAID: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  SENT: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  OVERDUE: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  DRAFT: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
  VOID: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
};

export default function PortalRacInvoicesPage() {
  const params = useParams();
  const search = useSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const customerId = search.get('customerId') ?? '';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!customerId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/rental/invoices');
      const data = res.ok ? await res.json() : [];
      const mine = (Array.isArray(data) ? data : []).filter((i: any) => i.customerId === customerId);
      setInvoices(mine);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const totalOutstanding = invoices
    .filter((i) => !['PAID', 'CANCELLED', 'VOID'].includes(i.status))
    .reduce((s, i) => s + Number(i.balanceDue ?? i.totalAmount ?? 0), 0);

  if (!customerId) {
    return (
      <div className="p-6">
        <p className="text-slate-400 text-sm">Pick a customer first.</p>
        <Link href={`/portal/${tenantSlug}/rac`} className="text-cyan-400 underline text-sm">
          ← Back to customer picker
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href={`/portal/${tenantSlug}/rac/customers?customerId=${customerId}`} className="text-xs text-slate-500 hover:text-cyan-400">
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-1">Invoices & Payments</h1>
        <p className="text-sm text-slate-400 mt-1">
          {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
          {totalOutstanding > 0 && (
            <> · <span className="text-rose-300">AED {totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })} outstanding</span></>
          )}
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
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-cyan-300 text-xs">{i.invoiceNo ?? i.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{new Date(i.invoiceDate).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{new Date(i.dueDate).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{Number(i.subtotal ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{Number(i.taxAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-white font-semibold">
                    {i.currency} {Number(i.totalAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-300">{Number(i.paidAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right">
                    {i.balanceDue && Number(i.balanceDue) > 0 ? (
                      <strong className="text-rose-300">{Number(i.balanceDue).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500 italic">
        Read-only view. Payment confirmations should be sent to your account manager.
      </p>
    </div>
  );
}
