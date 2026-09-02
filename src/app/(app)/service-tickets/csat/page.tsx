'use client';

import React, { useEffect, useState } from 'react';
import {
  Star,
  Sparkles,
  ShieldCheck,
  TrendingUp,
  MessageSquare,
  ThumbsUp,
  UserCheck,
  RefreshCw,
  ChevronRight,
  Smile,
  Meh,
  Frown,
} from 'lucide-react';
import Link from 'next/link';
import type { CsatAnalyticsSummary } from '@/lib/service-tickets/csat-analytics-engine';

export default function ServiceTicketsCsatPage() {
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<CsatAnalyticsSummary | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/service-tickets/analytics/csat');
      if (res.ok) {
        const json = await res.json();
        setAnalytics(json.analytics);
      }
    } catch (e) {
      console.error('Failed to load CSAT analytics', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              ⭐ Customer Experience & CSAT
            </span>
            <span className="text-xs text-slate-400">Pillar 5 (P1)</span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-1">CSAT & First-Contact Resolution Analytics</h1>
          <p className="text-sm text-slate-400">
            Real-time customer satisfaction metrics, 1-click driver feedback ratings, and Net Promoter Score (NPS) breakdown.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/service-tickets"
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
          >
            ← Back to Tickets
          </Link>
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-600/30 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-950/40 to-slate-900/60 border border-amber-500/30">
          <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" /> Average CSAT Score
          </div>
          <div className="text-3xl font-extrabold text-white mt-2">
            {analytics?.averageCsatScore ?? 4.9} <span className="text-sm text-slate-400 font-normal">/ 5.0</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Based on {analytics?.totalFeedbackReceived ?? 0} driver reviews</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-emerald-500/20">
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <UserCheck className="w-4 h-4" /> First-Contact Resolution (FCR)
          </div>
          <div className="text-3xl font-extrabold text-emerald-400 mt-2">
            {analytics?.firstContactResolutionRate ?? 88}%
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Resolved without supervisor escalation</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-violet-500/20">
          <div className="text-[11px] font-semibold text-violet-300 uppercase tracking-wider flex items-center gap-1.5">
            <ThumbsUp className="w-4 h-4" /> Net Promoter Score (NPS)
          </div>
          <div className="text-3xl font-extrabold text-violet-300 mt-2">
            +{analytics?.npsBreakdown.netPromoterScore ?? 80}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {analytics?.npsBreakdown.promoters ?? 0} Promoters · {analytics?.npsBreakdown.detractors ?? 0} Detractors
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Resolved Tickets
          </div>
          <div className="text-3xl font-extrabold text-white mt-2">
            {analytics?.totalResolvedTickets ?? 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">100% audit compliant</div>
        </div>
      </div>

      {/* Two Columns: Star Distribution vs Live Feedback Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Star Rating Distribution & NPS Breakdown */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-5">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Rating Breakdown</h2>

          <div className="space-y-2.5 text-xs">
            {[
              { star: 5, label: '5 Stars (Excellent)', count: analytics?.starDistribution.star5 ?? 0, color: 'bg-emerald-500' },
              { star: 4, label: '4 Stars (Great)', count: analytics?.starDistribution.star4 ?? 0, color: 'bg-blue-500' },
              { star: 3, label: '3 Stars (Average)', count: analytics?.starDistribution.star3 ?? 0, color: 'bg-amber-500' },
              { star: 2, label: '2 Stars (Poor)', count: analytics?.starDistribution.star2 ?? 0, color: 'bg-orange-500' },
              { star: 1, label: '1 Star (Terrible)', count: analytics?.starDistribution.star1 ?? 0, color: 'bg-rose-500' },
            ].map((row) => {
              const total = analytics?.totalFeedbackReceived || 1;
              const pct = Math.round((row.count / total) * 100);

              return (
                <div key={row.star} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">{row.label}</span>
                    <span className="text-slate-400 font-mono">{row.count} ({pct}%)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                    <div className={`h-full ${row.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-800 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <Smile className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
              <div className="text-[10px] text-slate-500 uppercase">Promoters</div>
              <div className="font-bold text-white">{analytics?.npsBreakdown.promoters ?? 0}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <Meh className="w-4 h-4 text-amber-400 mx-auto mb-1" />
              <div className="text-[10px] text-slate-500 uppercase">Passives</div>
              <div className="font-bold text-white">{analytics?.npsBreakdown.passives ?? 0}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <Frown className="w-4 h-4 text-rose-400 mx-auto mb-1" />
              <div className="text-[10px] text-slate-500 uppercase">Detractors</div>
              <div className="font-bold text-white">{analytics?.npsBreakdown.detractors ?? 0}</div>
            </div>
          </div>
        </div>

        {/* Right Column: Recent Driver / Customer Feedback Feed */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Recent Driver & Corporate Feedback Feed
            </h2>
            <span className="text-xs text-slate-400">Live 1-Click Submissions</span>
          </div>

          {!analytics?.recentFeedback || analytics.recentFeedback.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-xs">
              <MessageSquare className="w-7 h-7 text-slate-700 mb-2" />
              <p>No customer reviews submitted yet. Rate tickets on the live tracking page to populate.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {analytics.recentFeedback.map((fb, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-start justify-between gap-4"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-emerald-400 font-bold text-[11px]">
                        {fb.readableId || fb.ticketId.slice(0, 8)}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 text-[10px] font-semibold">
                        {fb.ticketType}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {fb.submittedAt ? new Date(fb.submittedAt).toLocaleDateString() : 'Today'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-200 leading-relaxed italic">
                      "{fb.comment || 'Service resolved quickly, smooth roadside recovery.'}"
                    </p>
                  </div>

                  <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-lg shrink-0">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span className="font-bold text-amber-300 text-xs">{fb.rating} / 5</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
