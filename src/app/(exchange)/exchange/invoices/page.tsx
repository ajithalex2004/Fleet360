/**
 * src/app/(exchange)/exchange/invoices/page.tsx
 *
 * Invoices & Billing Register for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { FileText, Plus, CheckCircle2, DollarSign, X } from 'lucide-react';

export default function ExchangeInvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [awards, setAwards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const [resInv, resAw] = await Promise.all([
        fetch('/api/exchange/invoices').then((r) => r.json()),
        fetch('/api/exchange/jobs/awards').then((r) => r.json()),
      ]);
      setInvoices(resInv.invoices || []);
      setAwards(resAw.awards || []);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInvoices();
  }, []);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Invoices & Billing</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Submit invoices against completed outsourced trips and track payment approval status from enterprise clients.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 flex items-center gap-1.5 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Create Invoice</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Invoices Table */}
      <div className="rounded-3xl bg-slate-900/60 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="p-4">Invoice No</th>
              <th className="p-4">Invoice Date</th>
              <th className="p-4">Subtotal</th>
              <th className="p-4">VAT (5%)</th>
              <th className="p-4">Total Amount</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {invoices.length > 0 ? (
              invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4 font-mono font-bold text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <span>{inv.invoiceNumber}</span>
                  </td>
                  <td className="p-4 text-slate-400">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                  <td className="p-4 text-slate-300 font-mono">AED {Number(inv.subtotalAmount).toFixed(2)}</td>
                  <td className="p-4 text-slate-400 font-mono">AED {Number(inv.vatAmount).toFixed(2)}</td>
                  <td className="p-4 font-bold text-cyan-300 font-mono">AED {Number(inv.totalAmount).toFixed(2)}</td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        inv.status === 'APPROVED'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No invoices submitted yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <CreateInvoiceModal
          awards={awards}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            showToast('✓ Invoice submitted to enterprise finance team!');
            void loadInvoices();
          }}
        />
      )}
    </div>
  );
}

function CreateInvoiceModal({
  awards,
  onClose,
  onCreated,
}: {
  awards: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [awardId, setAwardId] = useState(awards[0]?.id || '');
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-ABC-${new Date().getFullYear()}-001`);
  const [subtotalAmount, setSubtotalAmount] = useState(
    awards[0]?.awardedPrice ? String(awards[0].awardedPrice) : '4800'
  );
  const [submitting, setSubmitting] = useState(false);

  const subtotal = Number(subtotalAmount) || 0;
  const vat = subtotal * 0.05;
  const total = subtotal + vat;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!awardId || !invoiceNumber || !subtotal) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: 'dummy-partner-id',
          awardId,
          invoiceNumber,
          subtotalAmount: subtotal,
          vatAmount: vat,
        }),
      });

      if (!res.ok) throw new Error('Failed to create invoice');
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error submitting invoice');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white">Generate Partner Invoice</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Select Awarded Trip *</label>
            <select
              value={awardId}
              onChange={(e) => {
                setAwardId(e.target.value);
                const found = awards.find((a) => a.id === e.target.value);
                if (found) setSubtotalAmount(String(found.awardedPrice || found.totalAwarded));
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            >
              {awards.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.request?.requestNumber || a.id.slice(0, 8)} — AED {Number(a.totalAwarded).toFixed(2)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Invoice Number *</label>
            <input
              type="text"
              required
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Subtotal Amount (AED) *</label>
            <input
              type="number"
              required
              step="0.01"
              value={subtotalAmount}
              onChange={(e) => setSubtotalAmount(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Totals */}
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-1 text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal:</span>
              <span className="font-mono text-white">AED {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>VAT (5%):</span>
              <span className="font-mono text-white">AED {vat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-cyan-400 font-bold pt-1 border-t border-slate-800">
              <span>Total Invoice Amount:</span>
              <span className="font-mono">AED {total.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
