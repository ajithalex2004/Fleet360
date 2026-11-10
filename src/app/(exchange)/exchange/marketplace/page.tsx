/**
 * src/app/(exchange)/exchange/marketplace/page.tsx
 *
 * Phase 3 & Phase 14: Private Fleet360 Marketplace Opportunity Feed for Partners.
 * Multi-domain opportunities with blind quoting, staged disclosure, Multi-Emirate
 * Zone Match filtering, Preferred Exclusive Window badges, and Quote Revisions (Rev N+1).
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  RefreshCw,
  X,
  ShieldCheck,
  Sparkles,
  MapPin,
} from 'lucide-react';
import { OpportunityCard } from '@/components/exchange/marketplace/OpportunityCard';

export default function MarketplaceOpportunityFeedPage() {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [partnerServiceAreas, setPartnerServiceAreas] = useState<Array<{ emirate: string; zoneName: string | null }>>([]);
  const [hasPreferredRelationship, setHasPreferredRelationship] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeDomain, setActiveDomain] = useState<string>('ALL');
  const [zoneFilter, setZoneFilter] = useState<'ALL' | 'MATCHED_ONLY'>('ALL');
  const [quoteFilter, setQuoteFilter] = useState<'ALL' | 'UNQUOTED' | 'QUOTED'>('ALL');
  const [selectedOpp, setSelectedOpp] = useState<any | null>(null);
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(true);
  const [lastLiveSyncAt, setLastLiveSyncAt] = useState<string | null>(null);

  const emitExchangeEvent = useCallback((type: string, requestId?: string) => {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('fleet360-exchange-live');
        bc.postMessage({ type, requestId, source: 'exchange-marketplace', timestamp: Date.now() });
        bc.close();
      }
    } catch {
      // Ignore if BroadcastChannel is unavailable
    }
  }, []);

  const fetchOpportunities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/exchange/marketplace');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error ?? 'Could not load the marketplace.');
        return;
      }
      setLoadError(null);
      if (json.opportunities) setOpportunities(json.opportunities);
      if (Array.isArray(json.partnerServiceAreas)) setPartnerServiceAreas(json.partnerServiceAreas);
      setHasPreferredRelationship(Boolean(json.hasPreferredRelationship));
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOpportunities();
  }, [fetchOpportunities]);

  // ARCH-5: Cross-Portal Live Sync (BroadcastChannel + 10s Live Opportunity Stream)
  useEffect(() => {
    if (!liveSyncEnabled) return;
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        bc = new BroadcastChannel('fleet360-exchange-live');
        bc.onmessage = () => {
          setLastLiveSyncAt(new Date().toLocaleTimeString('en-AE'));
          void fetchOpportunities();
        };
      }
    } catch {
      // Fallback
    }

    const timer = setInterval(() => {
      setLastLiveSyncAt(new Date().toLocaleTimeString('en-AE'));
      void fetchOpportunities();
    }, 10_000);

    return () => {
      clearInterval(timer);
      if (bc) bc.close();
    };
  }, [liveSyncEnabled, fetchOpportunities]);

  const openQuoteModal = (opp: any) => {
    const existingQuote = opp?.request?.quotes?.[0];
    setSelectedOpp(opp);
    setQuoteAmount(existingQuote?.amount != null ? String(Number(existingQuote.amount)) : '');
    setQuoteNotes('');
  };

  const filteredOpps = opportunities.filter((o) => {
    if (activeDomain !== 'ALL' && o.domain !== activeDomain) return false;
    if (zoneFilter === 'MATCHED_ONLY' && o.emirateMatch === false) return false;
    const hasQuoted = (o.request?.quotes?.length || 0) > 0;
    if (quoteFilter === 'UNQUOTED' && hasQuoted) return false;
    if (quoteFilter === 'QUOTED' && !hasQuoted) return false;
    return true;
  });

  const matchedZoneCount = opportunities.filter((o) => o.emirateMatch !== false).length;
  const unquotedCount = opportunities.filter((o) => !(o.request?.quotes?.length > 0)).length;
  const quotedCount = opportunities.filter((o) => (o.request?.quotes?.length || 0) > 0).length;

  const handleQuoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOpp || !quoteAmount) return;

    const existingQuote = selectedOpp?.request?.quotes?.[0];
    const isRevision = Boolean(existingQuote?.id);

    setSubmitting(true);
    try {
      const res = await fetch('/api/exchange/jobs/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isRevision
            ? {
                action: 'REVISE',
                quoteId: existingQuote.id,
                requestId: selectedOpp.outsourceRequestId,
                amount: parseFloat(quoteAmount),
                notes: quoteNotes,
              }
            : {
                requestId: selectedOpp.outsourceRequestId,
                amount: parseFloat(quoteAmount),
                notes: quoteNotes,
              }
        ),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit quote');
      }

      setFeedback(
        isRevision
          ? `✓ Quote revised to Rev ${(existingQuote.revisionNo || 1) + 1} for ${selectedOpp.request?.requestNumber || 'RFQ'}!`
          : `✓ Blind quote submitted for ${selectedOpp.request?.requestNumber || 'RFQ'}!`
      );
      setTimeout(() => setFeedback(null), 5000);
      setSelectedOpp(null);
      setQuoteAmount('');
      setQuoteNotes('');
      await fetchOpportunities();
      emitExchangeEvent(isRevision ? 'QUOTE_REVISED' : 'QUOTE_SUBMITTED', selectedOpp.outsourceRequestId);
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
        <div className="flex items-center gap-2 flex-wrap">
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
          <button
            type="button"
            onClick={() => setLiveSyncEnabled((v) => !v)}
            title={
              liveSyncEnabled
                ? `Live Opportunity Stream Active${lastLiveSyncAt ? ` (Last sync: ${lastLiveSyncAt})` : ''}`
                : 'Click to resume Live Opportunity Stream'
            }
            className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition ${
              liveSyncEnabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                liveSyncEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span>{liveSyncEnabled ? 'LIVE 10s' : 'PAUSED'}</span>
          </button>
          <button
            type="button"
            onClick={() => void fetchOpportunities()}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition"
            title="Refresh Opportunities"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Phase 14: Multi-Emirate Zone Match & Preferred Exclusive Window Filter Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-400 font-semibold flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span>Your Registered Service Areas:</span>
          </span>
          {partnerServiceAreas.length > 0 ? (
            partnerServiceAreas.map((sa, idx) => (
              <span
                key={`${sa.emirate}-${sa.zoneName || idx}`}
                className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold"
              >
                {sa.emirate.replace(/_/g, ' ')}
                {sa.zoneName ? ` (${sa.zoneName})` : ''}
              </span>
            ))
          ) : (
            <span className="text-slate-400 text-[11px]">All UAE Emirates</span>
          )}
          {hasPreferredRelationship && (
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Preferred Partner Priority Access Active</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex p-0.5 bg-slate-950 border border-slate-800 rounded-xl text-[11px]">
            <button
              type="button"
              onClick={() => setZoneFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                zoneFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              All Zones ({opportunities.length})
            </button>
            <button
              type="button"
              onClick={() => setZoneFilter('MATCHED_ONLY')}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1 ${
                zoneFilter === 'MATCHED_ONLY'
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3 h-3" />
              <span>My Emirates ({matchedZoneCount})</span>
            </button>
          </div>

          <div className="flex p-0.5 bg-slate-950 border border-slate-800 rounded-xl text-[11px]">
            <button
              type="button"
              onClick={() => setQuoteFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                quoteFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setQuoteFilter('UNQUOTED')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                quoteFilter === 'UNQUOTED' ? 'bg-cyan-600/30 text-cyan-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              Awaiting Quote ({unquotedCount})
            </button>
            <button
              type="button"
              onClick={() => setQuoteFilter('QUOTED')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                quoteFilter === 'QUOTED' ? 'bg-emerald-600/30 text-emerald-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              Quoted ({quotedCount})
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-xs font-semibold text-emerald-300">
          {feedback}
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-xs text-amber-300">
          {loadError}
        </div>
      )}

      {/* Opportunities Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOpps.length > 0 ? (
          filteredOpps.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opportunity={opp}
              onQuoteClick={(o) => openQuoteModal(o)}
            />
          ))
        ) : (
          <div className="col-span-3 p-12 text-center text-slate-500 rounded-3xl bg-slate-900/40 border border-slate-800">
            No open marketplace opportunities matching the selected filters.
          </div>
        )}
      </div>

      {/* Quotation / Revision Modal */}
      {selectedOpp && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-3xl text-slate-100 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-bold text-cyan-400 uppercase">
                  {selectedOpp.request?.quotes?.length > 0
                    ? `Blind Quote Revision (Rev ${(selectedOpp.request.quotes[0].revisionNo || 1) + 1})`
                    : 'Blind Quotation'}
                </span>
                <h3 className="font-bold text-base text-white">
                  {selectedOpp.request?.quotes?.length > 0 ? 'Revise Quote on ' : 'Quote on '}
                  {selectedOpp.request?.requestNumber || selectedOpp.id.slice(0, 8)}
                </h3>
              </div>
              <button onClick={() => setSelectedOpp(null)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedOpp.request?.quotes?.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 flex items-center justify-between">
                <span>Current Active Quote (Rev {selectedOpp.request.quotes[0].revisionNo || 1}):</span>
                <span className="font-mono font-bold text-emerald-400">
                  AED {Number(selectedOpp.request.quotes[0].amount).toFixed(2)} + VAT
                </span>
              </div>
            )}

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
                  {submitting
                    ? 'Submitting...'
                    : selectedOpp.request?.quotes?.length > 0
                    ? `Submit Rev ${(selectedOpp.request.quotes[0].revisionNo || 1) + 1}`
                    : 'Submit Blind Quote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
