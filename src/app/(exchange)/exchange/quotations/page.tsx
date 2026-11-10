/**
 * src/app/(exchange)/exchange/quotations/page.tsx
 *
 * Phase 7: Partner Quotations & Multi-Revision Register for Fleet360 Exchange.
 * Supports multi-vertical filtering (Bus, Freight, Limousine, Recovery),
 * sanitized Stage 2 route corridor display, and 1-click Quote Revision (Rev N+1).
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Clock,
  CheckCircle2,
  RefreshCw,
  Edit3,
  X,
  Send,
  ShieldCheck,
} from 'lucide-react';

export default function ExchangeQuotationsPage() {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState<string>('ALL');
  const [revisingQuote, setRevisingQuote] = useState<any | null>(null);
  const [newAmount, setNewAmount] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/exchange/jobs/quotes').then((r) => r.json());
      setQuotes(res.quotes || []);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuotes();
  }, [loadQuotes]);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const filteredQuotes = quotes.filter((q) => {
    if (domainFilter !== 'ALL' && (q.request?.domain || 'PASSENGER_TRANSPORT') !== domainFilter) {
      return false;
    }
    return true;
  });

  const handleOpenRevise = (q: any) => {
    setRevisingQuote(q);
    setNewAmount(String(Number(q.amount || 0)));
    setNewNotes(q.notes || '');
  };

  const handleReviseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisingQuote || !newAmount) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/jobs/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: revisingQuote.requestId || revisingQuote.request?.id,
          amount: Number(newAmount),
          notes: newNotes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to submit quote revision');
      }
      showToast(
        `Submitted Rev ${json.quote?.revisionNo ?? (revisingQuote.revisionNo + 1)} for ${revisingQuote.request?.requestNumber || 'RFQ'}!`
      );
      setRevisingQuote(null);
      await loadQuotes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error revising quote');
    } finally {
      setSubmitting(false);
    }
  };

  const getDomainBadge = (domain?: string) => {
    switch (domain) {
      case 'FREIGHT':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'LIMOUSINE':
        return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      case 'RECOVERY':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      default:
        return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white">Commercial Quotations & Revisions Register</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Track submitted blind quotes across Bus, Freight, Limousine, and Recovery RFQs and issue competitive price revisions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex p-1 bg-slate-900 border border-slate-800 rounded-2xl text-xs">
            {[
              { id: 'ALL', label: 'All Domains' },
              { id: 'PASSENGER_TRANSPORT', label: 'Bus' },
              { id: 'FREIGHT', label: 'Freight' },
              { id: 'LIMOUSINE', label: 'Limousine' },
              { id: 'RECOVERY', label: 'Recovery' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setDomainFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl font-bold transition ${
                  domainFilter === tab.id
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => void loadQuotes()}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition"
            title="Refresh Quotations"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{feedback}</span>
        </div>
      )}

      <div className="rounded-3xl bg-slate-900/60 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="p-4">RFQ & Vertical</th>
              <th className="p-4">Sanitized Corridor & Date</th>
              <th className="p-4">Revision</th>
              <th className="p-4">Subtotal</th>
              <th className="p-4">VAT (5%)</th>
              <th className="p-4">Total (AED)</th>
              <th className="p-4">Validity</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredQuotes.length > 0 ? (
              filteredQuotes.map((q) => {
                const domain = q.request?.domain || 'PASSENGER_TRANSPORT';
                const disc = (q.request?.opportunity?.disclosurePayload || {}) as Record<string, any>;
                const corridor =
                  disc.originCity && disc.destinationCity
                    ? `${disc.originCity} → ${disc.destinationCity}`
                    : q.request?.vehicleTypeRequired || 'Stage 2 Sanitized Corridor';
                const canRevise =
                  q.status === 'SUBMITTED' &&
                  ['PUBLISHED', 'QUOTED', 'OPEN'].includes(q.request?.status || 'PUBLISHED');

                return (
                  <tr key={q.id} className="hover:bg-slate-800/30 transition">
                    <td className="p-4">
                      <div className="font-mono font-bold text-cyan-300">
                        {q.request?.requestNumber || q.requestId?.slice(0, 8)}
                      </div>
                      <span
                        className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[9px] font-bold border ${getDomainBadge(
                          domain
                        )}`}
                      >
                        {domain}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="text-slate-200 font-semibold">{corridor}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        <span>
                          {q.request?.serviceDate
                            ? new Date(q.request.serviceDate).toLocaleDateString()
                            : 'Scheduled'}{' '}
                          {q.request?.pickupTime ? `· ${q.request.pickupTime}` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-slate-300 font-semibold font-mono">Rev {q.revisionNo}</td>
                    <td className="p-4 text-slate-300 font-mono">AED {Number(q.amount).toFixed(2)}</td>
                    <td className="p-4 text-slate-400 font-mono">AED {Number(q.vatAmount).toFixed(2)}</td>
                    <td className="p-4 font-bold text-white font-mono">AED {Number(q.totalAmount).toFixed(2)}</td>
                    <td className="p-4 text-slate-400">
                      {q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          q.status === 'ACCEPTED' || q.status === 'AWARDED'
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : q.status === 'SUPERSEDED'
                            ? 'bg-slate-800 text-slate-400 border-slate-700'
                            : 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                        }`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      {canRevise ? (
                        <button
                          onClick={() => handleOpenRevise(q)}
                          className="px-3 py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 font-bold text-[11px] inline-flex items-center gap-1 transition"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Revise (Rev {q.revisionNo + 1})</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-500">
                  No submitted quotations found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Revise Quote Modal */}
      {revisingQuote && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                  Blind Quote Revision · Rev {revisingQuote.revisionNo + 1}
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  {revisingQuote.request?.requestNumber || 'Exchange RFQ'}
                </h3>
              </div>
              <button
                onClick={() => setRevisingQuote(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReviseSubmit} className="space-y-4 text-xs">
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400">Previous Quote (Rev {revisingQuote.revisionNo}):</span>
                <span className="font-mono font-bold text-slate-200">
                  AED {Number(revisingQuote.amount).toFixed(2)} + 5% VAT
                </span>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  Revised Base Amount (AED, excl. 5% VAT) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:border-cyan-500 focus:outline-none"
                />
                {newAmount && Number(newAmount) > 0 && (
                  <div className="mt-1.5 text-[11px] text-cyan-400 font-mono flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      +5% UAE VAT: AED {(Number(newAmount) * 0.05).toFixed(2)} · Total: AED{' '}
                      {(Number(newAmount) * 1.05).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  Revision Notes / Fleet Availability
                </label>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Optional commercial notes or standby fleet commitment..."
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRevisingQuote(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-cyan-600/25 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Submitting...' : `Submit Rev ${revisingQuote.revisionNo + 1}`}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
