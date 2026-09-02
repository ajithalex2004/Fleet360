/**
 * src/app/(exchange)/exchange/scorecard/page.tsx
 *
 * Partner Performance Scorecard & Tier Progression Dashboard.
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
  Award,
  Clock,
  FileCheck,
  ShieldCheck,
  Zap,
  TrendingUp,
  AlertCircle,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { PartnerTierBadge } from '@/components/exchange/PartnerTierBadge';

export default function PartnerScorecardPage() {
  const [scorecard, setScorecard] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchScorecard = async () => {
    try {
      const res = await fetch('/api/exchange/scorecard');
      const json = await res.json();
      if (json.scorecard) setScorecard(json.scorecard);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchScorecard();
  }, []);

  const handleRecalculate = async () => {
    if (!scorecard?.partnerId) return;
    setRefreshing(true);
    try {
      await fetch('/api/exchange/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: scorecard.partnerId }),
      });
      await fetchScorecard();
    } catch {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6 font-sans">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-cyan-400" />
            <span>Exchange Partner Trust & SLAs</span>
          </span>
          <h1 className="text-2xl font-black text-white mt-0.5">Performance Scorecard</h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time operational reliability, SLA adherence metrics, and tiered priority ranking across the Fleet360 Exchange Network.
          </p>
        </div>

        <button
          onClick={handleRecalculate}
          disabled={refreshing}
          className="px-4 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs inline-flex items-center gap-2 border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${refreshing ? 'animate-spin' : ''}`} />
          <span>{refreshing ? 'Recalculating...' : 'Refresh Scorecard'}</span>
        </button>
      </div>

      {/* Hero Tier Card */}
      {scorecard && (
        <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800 shadow-xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <PartnerTierBadge tier={scorecard.tier} showScore={false} />
                <span className="text-xs text-slate-400 font-mono">Partner: {scorecard.partner?.legalName}</span>
              </div>
              <h2 className="text-3xl font-black text-white">
                Composite Score: <span className="text-cyan-400 font-mono">{scorecard.compositeScore.toFixed(1)}</span>
                <span className="text-sm font-medium text-slate-500 ml-1">/ 100</span>
              </h2>
              <p className="text-xs text-slate-300 max-w-xl">
                {scorecard.tier === 'PLATINUM' && '★ Highest Priority: Your quotes receive VIP ranking and auto-award preference in enterprise RFQs.'}
                {scorecard.tier === 'GOLD' && '★ High Reliability Tier: Priority placement in Exchange Network opportunities and preferred sourcing.'}
                {scorecard.tier === 'SILVER' && '★ Verified Carrier: Strong execution record. Achieve 20 completed trips and 90% OTP to upgrade to Gold.'}
                {scorecard.tier === 'BRONZE' && '★ Active Partner: Complete 10 trips with 85% OTP to unlock Silver Tier benefits.'}
                {scorecard.tier === 'STANDARD' && '★ New Partner: Complete 5 outsourced trips with valid PODs to unlock Bronze Tier.'}
              </p>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-3 min-w-[280px]">
              <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-2xl">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Completed Trips</span>
                <span className="text-xl font-black text-white font-mono">{scorecard.completedTrips}</span>
              </div>
              <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-2xl">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">On-Time Deliveries</span>
                <span className="text-xl font-black text-emerald-400 font-mono">{scorecard.onTimeTrips}</span>
              </div>
              <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-2xl">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Exceptions Raised</span>
                <span className="text-xl font-black text-rose-400 font-mono">{scorecard.exceptionsCount}</span>
              </div>
              <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-2xl">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Quotes Submitted</span>
                <span className="text-xl font-black text-cyan-400 font-mono">{scorecard.quotesSubmitted}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5 Core KPI Metric Cards */}
      {scorecard && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            title="On-Time Performance (OTP)"
            weight="40% Weight"
            value={`${scorecard.onTimePerformance.toFixed(1)}%`}
            icon={<Clock className="w-4 h-4 text-emerald-400" />}
            status={scorecard.onTimePerformance >= 90 ? 'EXCELLENT' : 'NEEDS_ATTENTION'}
            desc="Arrivals at pickup within 15m window"
          />
          <KpiCard
            title="POD Quality Rate"
            weight="20% Weight"
            value={`${scorecard.podQualityRate.toFixed(1)}%`}
            icon={<FileCheck className="w-4 h-4 text-cyan-400" />}
            status={scorecard.podQualityRate >= 95 ? 'EXCELLENT' : 'GOOD'}
            desc="Completed proof with signatures/headcount"
          />
          <KpiCard
            title="Quote Responsiveness"
            weight="15% Weight"
            value={`${scorecard.quoteResponseRate.toFixed(1)}%`}
            icon={<Zap className="w-4 h-4 text-amber-400" />}
            status={scorecard.quoteResponseRate >= 75 ? 'EXCELLENT' : 'GOOD'}
            desc="Quotes submitted vs invitations"
          />
          <KpiCard
            title="Reliability Rate"
            weight="15% Weight"
            value={`${(100 - scorecard.exceptionRate).toFixed(1)}%`}
            icon={<ShieldCheck className="w-4 h-4 text-indigo-400" />}
            status={scorecard.exceptionRate === 0 ? 'EXCELLENT' : 'GOOD'}
            desc="Trips completed without breakdown/incident"
          />
          <KpiCard
            title="Commercial Cleanliness"
            weight="10% Weight"
            value={`${(100 - scorecard.disputeRate).toFixed(1)}%`}
            icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
            status={scorecard.disputeRate === 0 ? 'EXCELLENT' : 'GOOD'}
            desc="Invoiced trips without commercial dispute"
          />
        </div>
      )}
    </div>
  );
}

function KpiCard({ title, weight, value, icon, status, desc }: any) {
  return (
    <div className="p-4 rounded-3xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3 font-sans shadow-sm">
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">{icon}</div>
        <span className="text-[10px] font-bold text-slate-500 uppercase">{weight}</span>
      </div>

      <div>
        <h4 className="text-xs font-bold text-slate-300">{title}</h4>
        <div className="text-2xl font-black text-white font-mono mt-1">{value}</div>
        <p className="text-[10px] text-slate-500 mt-1">{desc}</p>
      </div>

      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
        <span className="text-slate-400 font-semibold">Status:</span>
        <span
          className={`px-2 py-0.5 rounded-full font-bold ${
            status === 'EXCELLENT'
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
          }`}
        >
          {status}
        </span>
      </div>
    </div>
  );
}
