/**
 * src/app/(exchange)/exchange/invoices/page.tsx
 *
 * Phase 4: Invoices, 3-Way Match Verification & Commercial Settlement Register for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
  FileText,
  Plus,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  X,
} from 'lucide-react';
import { usePartnerMembership } from '@/components/exchange/PartnerMembershipContext';

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
          <h1 className="text-xl font-black text-white">Invoices, 3-Way Match & Commercial Settlement</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Submit invoices with ancillary claims (waiting time, extra km, tolls) verified against frozen SHA-256 rate-card snapshots and ePOD evidence.
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
              <th className="p-4">Invoice No & Trip</th>
              <th className="p-4">Date</th>
              <th className="p-4">Subtotal & VAT</th>
              <th className="p-4">Total Claimed</th>
              <th className="p-4">3-Way Reconciliation</th>
              <th className="p-4">Commercial Model</th>
              <th className="p-4">Settlement Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {invoices.length > 0 ? (
              invoices.map((inv) => {
                const snap = (inv.award?.commercialSnapshot || {}) as Record<string, any>;
                const commercialModel = snap.commercialModel || 'AGENCY';
                const feePct = snap.platformFeePct != null ? Number(snap.platformFeePct) : 3;
                const verification = inv.verificationStatus || 'MATCHED';
                return (
                  <tr key={inv.id} className="hover:bg-slate-800/30 transition">
                    <td className="p-4">
                      <div className="font-mono font-bold text-white flex items-center gap-2">
                        <FileText className="w-4 h-4 text-cyan-400" />
                        <span>{inv.invoiceNumber}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {inv.award?.request?.requestNumber || inv.awardId?.slice(0, 8)} ·{' '}
                        {inv.award?.request?.pickupLocation || 'Route'} → {inv.award?.request?.dropoffLocation || 'Dest'}
                      </div>
                    </td>
                    <td className="p-4 text-slate-400">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                    <td className="p-4 font-mono">
                      <div className="text-slate-300">AED {Number(inv.subtotalAmount).toFixed(2)}</div>
                      <div className="text-[10px] text-slate-500">+5% VAT: AED {Number(inv.vatAmount).toFixed(2)}</div>
                    </td>
                    <td className="p-4 font-bold text-cyan-300 font-mono">
                      AED {Number(inv.totalAmount).toFixed(2)}
                    </td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          verification === 'MATCHED'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        {verification === 'MATCHED' ? (
                          <ShieldCheck className="w-3 h-3" />
                        ) : (
                          <AlertTriangle className="w-3 h-3" />
                        )}
                        {verification}
                      </span>
                      {inv.items?.length > 0 && (
                        <div className="text-[10px] text-slate-400 mt-1">
                          {inv.items.length} ancillary line item(s)
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-bold text-[10px]">
                        {commercialModel}
                      </span>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {commercialModel === 'AGENCY' ? `Platform Fee: ${feePct}%` : 'IFRS 15 Principal'}
                      </div>
                    </td>
                    <td className="p-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          inv.status === 'APPROVED' || inv.status === 'PAID'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  {loading ? 'Loading invoices...' : 'No invoices submitted yet.'}
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
            showToast('✓ Invoice submitted with 3-way match verification!');
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
  const membership = usePartnerMembership();
  const codePrefix = membership.status === 'ok' ? membership.partner.partnerCode : 'PARTNER';
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${codePrefix}-${new Date().getFullYear()}-001`);
  const initialBase = awards[0]?.awardedPrice
    ? Number(awards[0].awardedPrice)
    : awards[0]?.awardedAmount
      ? Number(awards[0].awardedAmount)
      : awards[0]?.totalAwarded
        ? Number((Number(awards[0].totalAwarded) / 1.05).toFixed(2))
        : 0;
  const initialFuelPct = Number(
    awards[0]?.commercialSnapshot?.rateCardSnapshot?.ancillaryCharges?.fuelSurchargePct ?? 0,
  );
  const [baseAmount, setBaseAmount] = useState(initialBase ? String(initialBase) : '');
  const [fuelSurcharge, setFuelSurcharge] = useState(
    initialBase && initialFuelPct > 0 ? String(((initialBase * initialFuelPct) / 100).toFixed(2)) : '0',
  );
  const [waitingCharge, setWaitingCharge] = useState('0');
  const [tollCharge, setTollCharge] = useState('0');
  const [extraKmCharge, setExtraKmCharge] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  const selectedAward = awards.find((a) => a.id === awardId) || awards[0] || null;
  const contractedBase = selectedAward
    ? Number(
        selectedAward.awardedPrice ??
          selectedAward.awardedAmount ??
          (Number(selectedAward.totalAwarded || 0) / 1.05).toFixed(2),
      )
    : 0;
  const contractedFuelPct = Number(
    selectedAward?.commercialSnapshot?.rateCardSnapshot?.ancillaryCharges?.fuelSurchargePct ?? 0,
  );
  const maxAllowedFuelSurcharge = Number(((contractedBase * contractedFuelPct) / 100).toFixed(2));

  const baseNum = Number(baseAmount) || 0;
  const fuelNum = Number(fuelSurcharge) || 0;
  const waitNum = Number(waitingCharge) || 0;
  const tollNum = Number(tollCharge) || 0;
  const extraKmNum = Number(extraKmCharge) || 0;

  const subtotal = baseNum + fuelNum + waitNum + tollNum + extraKmNum;
  const vat = subtotal * 0.05;
  const total = subtotal + vat;

  const baseOverclaim = contractedBase > 0 && baseNum > contractedBase + 0.01;
  const fuelOverclaim = fuelNum > maxAllowedFuelSurcharge + 0.01;
  const willAutoMatch = !baseOverclaim && !fuelOverclaim;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!awardId || !invoiceNumber || !subtotal) return;

    const items: any[] = [
      {
        description: 'Base Contracted / Awarded Trip Service',
        varianceReason: 'BASE_RATE',
        quantity: 1,
        unitPrice: baseNum,
      },
    ];
    if (fuelNum > 0) {
      items.push({
        description: `Contracted Fuel Surcharge Indexation (${contractedFuelPct}% index allowance)`,
        varianceReason: 'FUEL_SURCHARGE',
        quantity: 1,
        unitPrice: fuelNum,
      });
    }
    if (waitNum > 0) {
      items.push({
        description: 'Ancillary Waiting / Detention Time Beyond Free Allowance',
        varianceReason: 'WAITING_TIME',
        quantity: 1,
        unitPrice: waitNum,
      });
    }
    if (tollNum > 0) {
      items.push({
        description: 'Verified Salik / Darb Toll & Parking Charges',
        varianceReason: 'TOLL_PARKING',
        quantity: 1,
        unitPrice: tollNum,
      });
    }
    if (extraKmNum > 0) {
      items.push({
        description: 'Extra Route Kilometres / Diversion',
        varianceReason: 'EXTRA_KM',
        quantity: 1,
        unitPrice: extraKmNum,
      });
    }

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
          items,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create invoice');
      }
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error submitting invoice');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Submit Partner Tax Invoice (3-Way Match)</h3>
            <p className="text-[11px] text-slate-400">
              Reconciled against frozen SHA-256 Rate-Card Snapshot & verified GPS/ePOD timestamps
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Select Awarded Trip *</label>
              <select
                value={awardId}
                onChange={(e) => {
                  setAwardId(e.target.value);
                  const found = awards.find((a) => a.id === e.target.value);
                  if (found) {
                    const nextBase = Number(
                      found.awardedPrice ??
                        found.awardedAmount ??
                        (Number(found.totalAwarded || 0) / 1.05).toFixed(2),
                    );
                    const nextFuelPct = Number(
                      found.commercialSnapshot?.rateCardSnapshot?.ancillaryCharges?.fuelSurchargePct ?? 0,
                    );
                    setBaseAmount(String(nextBase));
                    setFuelSurcharge(
                      nextFuelPct > 0 ? String(((nextBase * nextFuelPct) / 100).toFixed(2)) : '0',
                    );
                  }
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Base Trip Amount (AED) *</label>
              <input
                type="number"
                required
                step="0.01"
                value={baseAmount}
                onChange={(e) => setBaseAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Waiting / Detention Claim (AED)</label>
              <input
                type="number"
                step="0.01"
                value={waitingCharge}
                onChange={(e) => setWaitingCharge(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Salik / Darb Tolls (AED)</label>
              <input
                type="number"
                step="0.01"
                value={tollCharge}
                onChange={(e) => setTollCharge(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Extra KM / Diversion (AED)</label>
              <input
                type="number"
                step="0.01"
                value={extraKmCharge}
                onChange={(e) => setExtraKmCharge(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Fuel Surcharge ({contractedFuelPct}% cap)
              </label>
              <input
                type="number"
                step="0.01"
                value={fuelSurcharge}
                onChange={(e) => setFuelSurcharge(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Live Pre-Submission 3-Way Match Preview */}
          <div
            className={`p-3 rounded-2xl border text-[11px] flex items-center justify-between ${
              willAutoMatch
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {willAutoMatch ? (
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <div>
                <div className="font-bold">
                  {willAutoMatch
                    ? 'Live 3-Way Match Preview: WILL AUTO-MATCH'
                    : 'Live 3-Way Match Preview: VARIANCE REVIEW HOLD'}
                </div>
                <div className="text-[10px] opacity-80">
                  Contracted Base: AED {contractedBase.toFixed(2)} · Fuel Index Allowance ({contractedFuelPct}%): AED{' '}
                  {maxAllowedFuelSurcharge.toFixed(2)}
                </div>
              </div>
            </div>
            <span className="font-mono font-bold uppercase px-2 py-0.5 rounded bg-black/30">
              {willAutoMatch ? 'MATCHED' : 'VARIANCE'}
            </span>
          </div>

          {/* Totals */}
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-1 text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal (Base + Ancillaries):</span>
              <span className="font-mono text-white">AED {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>UAE VAT (5%):</span>
              <span className="font-mono text-white">AED {vat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-cyan-400 font-bold pt-1 border-t border-slate-800">
              <span>Total Claimed Amount:</span>
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
              {submitting ? 'Verifying & Submitting...' : 'Submit for 3-Way Match'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
