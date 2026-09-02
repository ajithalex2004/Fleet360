/**
 * src/components/bus-ops/outsource/OutsourceDisputeModal.tsx
 *
 * Commercial Dispute Management Modal for Operations & Finance.
 */

'use client';

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, DollarSign, X } from 'lucide-react';

interface OutsourceDisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: any;
  onDisputeRaised: () => void;
}

export function OutsourceDisputeModal({
  isOpen,
  onClose,
  invoice,
  onDisputeRaised,
}: OutsourceDisputeModalProps) {
  const [disputedAmount, setDisputedAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !invoice) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputedAmount || !reason) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/bus-ops/outsource/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RAISE_DISPUTE',
          partnerId: invoice.partnerId,
          invoiceId: invoice.id,
          disputedAmount: parseFloat(disputedAmount),
          reason,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to raise dispute');
      }

      alert('✓ Commercial dispute opened. Uncontested line items remain eligible for settlement.');
      onDisputeRaised();
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error raising dispute');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans text-xs">
      <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-3xl p-6 text-slate-100 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-sm text-white">Raise Commercial Dispute</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-400">Invoice Number:</span>
            <span className="font-mono font-bold text-white">{invoice.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Total Invoice Amount:</span>
            <span className="font-mono text-cyan-300">AED {Number(invoice.totalAmount).toFixed(2)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Disputed Amount (AED) *</label>
            <input
              type="number"
              step="0.01"
              required
              max={Number(invoice.totalAmount)}
              value={disputedAmount}
              onChange={(e) => setDisputedAmount(e.target.value)}
              placeholder="e.g. 150.00"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              Uncontested balance of AED {(Number(invoice.totalAmount) - (parseFloat(disputedAmount) || 0)).toFixed(2)} will remain unblocked.
            </span>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Dispute Reason / Justification *</label>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Invoiced waiting time charge of 2 hours not supported by GPS logs."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !disputedAmount || !reason}
              className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold shadow-lg shadow-amber-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Opening Dispute...' : 'Open Dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
