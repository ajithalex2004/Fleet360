/**
 * src/app/(exchange)/exchange/marketplace/page.tsx
 *
 * Phase 3: Private Fleet360 Marketplace Opportunity Feed for Partners.
 * Multi-domain opportunities with blind quoting and staged disclosure.
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
  Globe,
  Filter,
  Search,
  RefreshCw,
  Send,
  AlertCircle,
  X,
} from 'lucide-react';
import { OpportunityCard } from '@/components/exchange/marketplace/OpportunityCard';

export default function MarketplaceOpportunityFeedPage() {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDomain, setActiveDomain] = useState<string>('ALL');
  const [selectedOpp, setSelectedOpp] = useState<any | null>(null);
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function fetchOpportunities() {
      try {
        const res = await fetch('/api/exchange/marketplace');
        const json = await res.json();
        if (json.opportunities) setOpportunities(json.opportunities);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }
    void fetchOpportunities();
  }, []);

  const filteredOpps = opportunities.filter((o) => {
    if (activeDomain !== 'ALL' && o.domain !== activeDomain) return false;
    return true;
  });

  const handleQuoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOpp || !quoteAmount) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_QUOTE',
          requestId: selectedOpp.outsourceRequestId,
          amount: parseFloat(quoteAmount),
          notes: quoteNotes,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit quote');
      }

      alert('✓ Quote submitted to Marketplace RFQ successfully!');
      setSelectedOpp(null);
      setQuoteAmount('');
      setQuoteNotes('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error submitting quote');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 font-sans">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>Private B2B Marketplace</span>
          </span>
          <h1 className="text-2xl font-black text-white mt-0.5">Exchange Network Opportunities</h1>
          <p className="text-xs text-slate-400 mt-1">
            Discover and quote on outsourced transport requirements published by enterprise fleets across the UAE.
          </p>
        </div>

        {/* Domain Filter Tabs */}
        <div className="flex p-1 bg-slate-900 border border-slate-800 rounded-2xl text-xs">
          {[
            { id: 'ALL', label: 'All Domains' },
            { id: 'PASSENGER_TRANSPORT', label: 'Passenger' },
            { id: 'FREIGHT', label: 'Freight' },
            { id: 'RECOVERY', label: 'Recovery' },
            { id: 'LIMOUSINE', label: 'Limousine' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveDomain(tab.id)}
              className={`px-3 py-1.5 rounded-xl font-bold transition ${
                activeDomain === tab.id
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Opportunities Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOpps.length > 0 ? (
          filteredOpps.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opportunity={opp}
              onQuoteClick={(o) => setSelectedOpp(o)}
            />
          ))
        ) : (
          <div className="col-span-3 p-12 text-center text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800">
            No open marketplace opportunities matching the selected domain.
          </div>
        )}
      </div>

      {/* Quotation Modal */}
      {selectedOpp && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-3xl text-slate-100 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-bold text-cyan-400 uppercase">Blind Quotation</span>
                <h3 className="font-bold text-base text-white">Quote on {selectedOpp.request?.requestNumber || selectedOpp.id.slice(0, 8)}</h3>
              </div>
              <button onClick={() => setSelectedOpp(null)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleQuoteSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Quote Base Amount (AED, excl. VAT) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={quoteAmount}
                  onChange={(e) => setQuoteAmount(e.target.value)}
                  placeholder="e.g. 850.00"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">5% UAE VAT will be automatically added to total quotation.</span>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Commercial Notes / Terms</label>
                <textarea
                  rows={2}
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                  placeholder="e.g. Rate includes fuel, toll gates, and professional chauffeur."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedOpp(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !quoteAmount}
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold shadow-lg shadow-cyan-600/30 transition disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit Blind Quote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
