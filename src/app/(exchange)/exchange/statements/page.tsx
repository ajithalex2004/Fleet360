/**
 * src/app/(exchange)/exchange/statements/page.tsx
 *
 * Phase 5: Partner Settlement Statements, Official UAE FTA Tax Invoice PDFs,
 * and Non-Blocking Commercial Dispute Resolution for Fleet360 Exchange.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
  Building2,
  Scale,
  X,
} from 'lucide-react';

export default function PartnerStatementsPage() {
  const [statements, setStatements] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatement, setSelectedStatement] = useState<any | null>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const loadStatements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/exchange/invoices?includeStatements=1');
      const json = await res.json().catch(() => ({}));
      if (Array.isArray(json.statements)) setStatements(json.statements);
      if (Array.isArray(json.invoices)) setInvoices(json.invoices);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatements();
  }, [loadStatements]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Commercial Reconciliation & Remittance</span>
          </span>
          <h1 className="text-2xl font-black text-white mt-0.5">
            Partner Settlement Statements & Disputes
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Periodic consolidated statements, official UAE FTA Tax Invoice PDFs, and non-blocking line-item dispute resolution.
          </p>
        </div>

        <button
          onClick={() => setShowDisputeModal(true)}
          className="px-4 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center gap-1.5 transition"
        >
          <Scale className="w-4 h-4" />
          <span>Contest Deduction / Raise Dispute</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Statements Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-bold uppercase text-[10px] border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Statement #</th>
                <th className="py-3 px-4">Billing Period</th>
                <th className="py-3 px-4">Commercial Model</th>
                <th className="py-3 px-4">Invoices</th>
                <th className="py-3 px-4">Gross (excl. VAT)</th>
                <th className="py-3 px-4">VAT (5%)</th>
                <th className="py-3 px-4">Deductions</th>
                <th className="py-3 px-4">Net Payable</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">UAE FTA Tax Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {statements.length > 0 ? (
                statements.map((s) => {
                  const firstSnap = (s.invoices?.[0]?.award?.commercialSnapshot || {}) as Record<string, any>;
                  const commercialModel = s.commercialModel || firstSnap.commercialModel || 'AGENCY';
                  const feePct = s.platformFeePct ?? firstSnap.platformFeePct ?? 3;
                  return (
                  <tr key={s.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-white">{s.statementNumber}</td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold text-[10px]">
                        {commercialModel}
                      </span>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {commercialModel === 'AGENCY' ? `Net-Remit (${feePct}% Fee)` : 'IFRS 15 Principal'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono">{s.invoices?.length || 0} Invoices</td>
                    <td className="py-3 px-4 font-mono">AED {Number(s.grossAmount).toFixed(2)}</td>
                    <td className="py-3 px-4 font-mono text-cyan-400">AED {Number(s.vatAmount).toFixed(2)}</td>
                    <td className="py-3 px-4 font-mono text-rose-400">
                      {Number(s.totalDeductions) > 0 ? `-AED ${Number(s.totalDeductions).toFixed(2)}` : 'AED 0.00'}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                      AED {Number(s.netPayable).toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        {s.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        onClick={() => setSelectedStatement(s)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] inline-flex items-center gap-1.5"
                      >
                        <FileText className="w-3 h-3 text-cyan-400" />
                        <span>Preview</span>
                      </button>
                      <a
                        href={`/api/exchange/documents/statement/${s.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-300 font-bold text-[11px] inline-flex items-center gap-1.5"
                      >
                        <Download className="w-3 h-3" />
                        <span>FTA PDF</span>
                      </a>
                    </td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500">
                    {loading ? 'Loading settlement statements...' : 'No settlement statements generated yet for this period.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* UAE FTA Tax Invoice Modal */}
      {selectedStatement && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white text-slate-900 rounded-3xl p-8 space-y-6 shadow-2xl font-sans">
            <div className="flex justify-between items-start border-b border-slate-200 pb-6">
              <div>
                <span className="px-2.5 py-1 rounded bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">
                  UAE FTA TAX INVOICE / SETTLEMENT STATEMENT
                </span>
                <h2 className="text-2xl font-black mt-2">{selectedStatement.statementNumber}</h2>
                <p className="text-xs text-slate-500">
                  Period: {new Date(selectedStatement.periodStart).toLocaleDateString()} to{' '}
                  {new Date(selectedStatement.periodEnd).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right text-xs text-slate-600">
                <div className="font-bold text-slate-900">Fleet360 Enterprise Exchange</div>
                <div>Buyer TRN: {selectedStatement.tenantTrn || '100-XXXX-XXXX-XXX'}</div>
                <div>Supplier TRN: {selectedStatement.partnerTrn || '100-YYYY-YYYY-YYY'}</div>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">Gross Approved Services (Excl. VAT)</span>
                <span className="font-mono font-bold">AED {Number(selectedStatement.grossAmount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-600">UAE Standard Output VAT (5%)</span>
                <span className="font-mono font-bold">AED {Number(selectedStatement.vatAmount).toFixed(2)}</span>
              </div>
              {Number(selectedStatement.totalDeductions) > 0 && (
                <div className="flex justify-between py-2 border-b border-slate-100 text-rose-600">
                  <span className="flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>SLA Penalties / Platform Commission Deductions</span>
                  </span>
                  <span className="font-mono font-bold">-AED {Number(selectedStatement.totalDeductions).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between py-3 bg-slate-900 text-white px-4 rounded-xl text-sm font-black">
                <span>Net Remittance Payable</span>
                <span className="font-mono text-emerald-400">AED {Number(selectedStatement.netPayable).toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                onClick={() => setSelectedStatement(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
              >
                Close
              </button>
              <a
                href={`/api/exchange/documents/statement/${selectedStatement.id}`}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Official Signed PDF</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Raise Commercial Dispute Modal */}
      {showDisputeModal && (
        <RaiseDisputeModal
          invoices={invoices}
          onClose={() => setShowDisputeModal(false)}
          onRaised={() => {
            setShowDisputeModal(false);
            showToast('✓ Commercial dispute registered! Uncontested line items remain clear for settlement.');
            void loadStatements();
          }}
        />
      )}
    </div>
  );
}

function RaiseDisputeModal({
  invoices,
  onClose,
  onRaised,
}: {
  invoices: any[];
  onClose: () => void;
  onRaised: () => void;
}) {
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id || '');
  const [disputedAmount, setDisputedAmount] = useState('150');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceId || !Number(disputedAmount) || !reason.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RAISE_DISPUTE',
          invoiceId,
          disputedAmount: Number(disputedAmount),
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to raise dispute');
      }
      onRaised();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error raising dispute');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Contest Variance / Raise Commercial Dispute</h3>
            <p className="text-[11px] text-slate-400">
              Non-blocking dispute workflow: uncontested invoice base amounts remain eligible for settlement
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Select Invoice *</label>
            <select
              required
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white"
            >
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — AED {Number(inv.totalAmount).toFixed(2)} ({inv.verificationStatus || inv.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Disputed Amount (AED) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={disputedAmount}
              onChange={(e) => setDisputedAmount(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Evidence & Reason *</label>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Gate entry log confirms 2.5h detention at Jebel Ali Terminal 2; GPS timestamp attached."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !invoiceId}
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold shadow-lg shadow-amber-600/30 transition disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
