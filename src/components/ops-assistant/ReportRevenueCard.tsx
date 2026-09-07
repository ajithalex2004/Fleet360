'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface Props {
  period?: 'monthly' | 'quarterly' | 'yearly';
  title?: string;
}

export default function ReportRevenueCard({ period = 'monthly', title = 'Revenue & Financial BI Breakdown' }: Props) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/reports/revenue?period=${period}`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setData(json);
        }
      } catch (err) {
        console.error('Failed to load revenue report:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [period]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-5 w-full max-w-2xl animate-pulse space-y-3">
        <div className="flex justify-between items-center">
          <div className="h-4 bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-slate-700 rounded w-1/6" />
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="h-16 bg-slate-700/50 rounded-xl" />
          <div className="h-16 bg-slate-700/50 rounded-xl" />
        </div>
      </div>
    );
  }

  // Aggregate breakdown across the most recent bucket
  const buckets = data?.buckets ?? [];
  const latest = buckets[buckets.length - 1] ?? {};
  const totalRevenue = data?.totalRevenue ?? (latest.totalRevenue ?? 0);
  const racRevenue = data?.racRevenue ?? (latest.racRevenue ?? 0);
  const stsRevenue = data?.stsRevenue ?? (latest.stsRevenue ?? 0);
  const leasingRevenue = data?.leasingRevenue ?? (latest.leasingRevenue ?? 0);
  const logisticsRevenue = data?.logisticsRevenue ?? (latest.logisticsRevenue ?? 0);

  const lobs = [
    { name: 'Rent-A-Car (RAC)', amount: racRevenue, color: 'bg-emerald-400' },
    { name: 'Staff Transportation (STS)', amount: stsRevenue, color: 'bg-indigo-400' },
    { name: 'Vehicle Leasing', amount: leasingRevenue, color: 'bg-purple-400' },
    { name: 'Freight Logistics', amount: logisticsRevenue, color: 'bg-amber-400' },
  ].filter(l => l.amount > 0 || totalRevenue === 0);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 w-full max-w-2xl shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">💰</span>
            <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              {period.toUpperCase()} CADENCE
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Consolidated multi-line revenue, VAT billing and contract billing
          </p>
        </div>
        <Link
          href="/reports/revenue"
          className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 text-xs font-semibold transition-all flex items-center gap-1"
        >
          <span>Revenue Hub</span>
          <span>→</span>
        </Link>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3.5 text-center">
          <p className="text-2xl font-bold text-emerald-400">
            AED {Number(totalRevenue).toLocaleString()}
          </p>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">Total Attributable Revenue</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3.5 text-center">
          <p className="text-2xl font-bold text-indigo-400">
            {lobs.length} LOBs
          </p>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">Active Revenue Streams</p>
        </div>
      </div>

      {/* LOB Revenue Breakdown */}
      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Revenue Breakdown by Line of Business</p>
        <div className="space-y-2.5">
          {lobs.map((lob, idx) => {
            const pct = totalRevenue > 0 ? Math.round((lob.amount / totalRevenue) * 100) : 25;
            return (
              <div key={idx} className="bg-slate-900/40 rounded-xl p-2.5 text-xs space-y-1.5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${lob.color}`} />
                    <span className="font-semibold text-white">{lob.name}</span>
                  </div>
                  <span className="font-bold text-white">AED {Number(lob.amount).toLocaleString()}</span>
                </div>
                <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full ${lob.color} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs text-slate-400">
        <span>FTA Compliant Invoices & Salik Reconciled</span>
        <Link href="/reports/revenue" className="text-cyan-400 hover:text-cyan-300 font-medium">
          Open in Revenue BI Module →
        </Link>
      </div>
    </div>
  );
}
