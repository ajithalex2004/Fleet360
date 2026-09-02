/**
 * src/app/(exchange)/exchange/quotations/page.tsx
 *
 * Partner Quotations & Revisions Register for Fleet360 Exchange.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { DollarSign, Clock, CheckCircle2, XCircle, ArrowUpRight } from 'lucide-react';

export default function ExchangeQuotationsPage() {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadQuotes() {
      try {
        const res = await fetch('/api/exchange/jobs/quotes').then((r) => r.json());
        setQuotes(res.quotes || []);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }
    void loadQuotes();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-black text-white">Commercial Quotations</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          History of all submitted quotes, revisions, and client acceptance statuses.
        </p>
      </div>

      <div className="rounded-3xl bg-slate-900/60 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="p-4">Request No</th>
              <th className="p-4">Revision</th>
              <th className="p-4">Subtotal</th>
              <th className="p-4">VAT (5%)</th>
              <th className="p-4">Total Amount</th>
              <th className="p-4">Validity</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {quotes.length > 0 ? (
              quotes.map((q) => (
                <tr key={q.id} className="hover:bg-slate-800/30 transition">
                  <td className="p-4 font-mono font-bold text-cyan-300">
                    {q.request?.requestNumber || q.requestId?.slice(0, 8)}
                  </td>
                  <td className="p-4 text-slate-300 font-semibold">Rev {q.revisionNo}</td>
                  <td className="p-4 text-slate-300 font-mono">AED {Number(q.amount).toFixed(2)}</td>
                  <td className="p-4 text-slate-400 font-mono">AED {Number(q.vatAmount).toFixed(2)}</td>
                  <td className="p-4 font-bold text-white font-mono">AED {Number(q.totalAmount).toFixed(2)}</td>
                  <td className="p-4 text-slate-400">
                    {new Date(q.validUntil).toLocaleDateString()}
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        q.status === 'ACCEPTED'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : q.status === 'SUPERSEDED'
                          ? 'bg-slate-800 text-slate-400 border-slate-700'
                          : 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                      }`}
                    >
                      {q.status}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  No submitted quotations found yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
