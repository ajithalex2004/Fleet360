'use client';

import { useEffect, useState, useCallback } from 'react';
import { Receipt, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface PendingPayment { id: string; referenceCode: string; status: string }
interface Invoice {
  id: string; invoiceNo: string | null; billingPeriod: string | null;
  issueDate: string; dueDate: string; totalAmount: number | string; currency: string | null;
  status: string; pendingPayment: PendingPayment | null;
}

const STATUS_COLOR: Record<string, string> = {
  PAID: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  OVERDUE: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  SENT: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  DRAFT: 'bg-slate-700/60 text-slate-300 border-slate-600',
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leasing-portal/invoices');
      setInvoices(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const payNow = async (invoiceId: string) => {
    setPaying(invoiceId);
    try {
      const res = await fetch(`/api/leasing-portal/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'BANK_TRANSFER' }),
      });
      const data = await res.json();
      if (!res.ok) { setToast({ type: 'err', msg: data.error ?? 'Failed to initiate payment' }); return; }
      setInstructions(prev => ({ ...prev, [invoiceId]: data.instructions }));
      setToast({ type: 'ok', msg: 'Payment initiated — see instructions below.' });
      void load();
    } finally {
      setPaying(null);
    }
  };

  if (loading) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Invoices & payments</h1>

      {toast && (
        <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${toast.type === 'ok' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'}`}>
          {toast.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {invoices.length === 0 && <div className="text-slate-500">No invoices yet.</div>}

      <div className="space-y-3">
        {invoices.map(inv => (
          <div key={inv.id} className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Receipt className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="font-medium">{inv.invoiceNo ?? inv.id.slice(0, 8)}</div>
                  <div className="text-xs text-slate-400">
                    {inv.billingPeriod ?? '—'} · Due {inv.dueDate?.slice(0, 10)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{inv.currency ?? 'AED'} {Number(inv.totalAmount).toLocaleString()}</span>
                <span className={`text-xs px-2 py-1 rounded-full border ${STATUS_COLOR[inv.status] ?? STATUS_COLOR.DRAFT}`}>{inv.status}</span>
              </div>
            </div>

            {inv.status !== 'PAID' && (
              <div className="mt-3">
                {inv.pendingPayment ? (
                  <div className="flex items-center gap-2 text-xs text-amber-300">
                    <Clock className="w-3.5 h-3.5" /> Payment pending confirmation (ref {inv.pendingPayment.referenceCode})
                  </div>
                ) : (
                  <button
                    onClick={() => payNow(inv.id)}
                    disabled={paying === inv.id}
                    className="text-xs px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium"
                  >
                    {paying === inv.id ? 'Starting…' : 'Pay now'}
                  </button>
                )}
                {instructions[inv.id] && (
                  <p className="mt-2 text-xs text-slate-300 bg-slate-900/60 border border-slate-700 rounded-lg p-3">
                    {instructions[inv.id]}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
