/**
 * src/components/bus-ops/outsource/OutsourceComparisonDrawer.tsx
 *
 * Phase 2E: Interactive Quote Comparison Screen for Fleet360 Operations.
 * Displays quotes side-by-side with commercial breakdown and award decision controls.
 */

'use client';

import React, { useState } from 'react';
import {
  X,
  Award,
  DollarSign,
  CheckCircle2,
  Clock,
  Truck,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

interface OutsourceComparisonDrawerProps {
  request: any;
  isOpen: boolean;
  onClose: () => void;
  onAwarded: () => void;
}

export function OutsourceComparisonDrawer({
  request,
  isOpen,
  onClose,
  onAwarded,
}: OutsourceComparisonDrawerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen || !request) return null;

  const quotes = request.quotes || [];

  const handleAward = async (quoteId: string) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'AWARD_QUOTE',
          requestId: request.id,
          quoteId,
          tripId: request.sourceReferenceId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to award quote');
      }

      setFeedback('✓ Quote successfully awarded! Other quotes transitioned to NOT_SELECTED.');
      setTimeout(() => {
        setFeedback(null);
        onAwarded();
        onClose();
      }, 1500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error awarding quote');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/70 backdrop-blur-sm animate-in fade-in font-sans">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-2xl bg-slate-950 border-l border-slate-800 text-slate-100 flex flex-col justify-between shadow-2xl text-xs">
          {/* Top Bar */}
          <div className="p-5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Quote Comparison & Procurement</span>
              <h2 className="text-base font-black text-white mt-0.5">Request: {request.requestNumber}</h2>
              <p className="text-[11px] text-slate-400">
                {request.pickupLocation} → {request.dropoffLocation} ({request.requiredCapacity} Seats)
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Main Body */}
          <div className="p-6 space-y-5 flex-1 overflow-y-auto">
            {feedback && (
              <div className="p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{feedback}</span>
              </div>
            )}

            {/* Comparison Matrix Cards */}
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-300 block">Received Partner Quotes ({quotes.length})</span>

              {quotes.length > 0 ? (
                <div className="space-y-3">
                  {quotes.map((q: any) => {
                    const isAwarded = request.award?.quoteId === q.id;
                    return (
                      <div
                        key={q.id}
                        className={`p-5 rounded-3xl border transition space-y-3 ${
                          isAwarded
                            ? 'bg-emerald-950/30 border-emerald-500/50'
                            : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white">{q.partner?.legalName}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                              PREFERRED
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block">Total Quoted</span>
                            <span className="font-mono text-base font-black text-cyan-300">
                              AED {Number(q.totalAmount).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {/* Commercial Breakdown */}
                        <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl bg-slate-950/60 border border-slate-800/60 text-[11px]">
                          <div>
                            <span className="text-slate-400 block">Base Rate:</span>
                            <span className="font-mono text-white font-semibold">AED {Number(q.amount).toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">VAT (5%):</span>
                            <span className="font-mono text-white font-semibold">AED {Number(q.vatAmount).toFixed(2)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">Revision:</span>
                            <span className="text-slate-200 font-semibold">Rev {q.revisionNo}</span>
                          </div>
                        </div>

                        {q.notes && (
                          <div className="text-[11px] text-slate-400 bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/40">
                            <span className="font-semibold text-slate-300">Notes:</span> {q.notes}
                          </div>
                        )}

                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                          <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span>Valid until {new Date(q.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </span>

                          {!request.award && (
                            <button
                              onClick={() => handleAward(q.id)}
                              disabled={submitting}
                              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 transition disabled:opacity-50 active:scale-95 flex items-center gap-1.5"
                            >
                              <Award className="w-3.5 h-3.5" />
                              <span>Award to this Partner</span>
                            </button>
                          )}

                          {isAwarded && (
                            <span className="px-3 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Awarded</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center text-slate-500 rounded-2xl bg-slate-900 border border-slate-800">
                  No quotes received for this request yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
