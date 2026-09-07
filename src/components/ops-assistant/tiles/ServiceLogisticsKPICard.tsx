'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface LogisticsStats {
  inTransitTrips: number;
  onTimeRate: number;
  epodCompletionRate: number;
  totalFreightTonnage: number;
  coldChainCompliance: number;
  multiDropEfficiency: number;
  transitBreakdown: Array<{ corridor: string; trips: number; status: string; sla: string }>;
}

export default function ServiceLogisticsKPICard() {
  const [stats, setStats] = useState<LogisticsStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        if (!cancelled) {
          setStats({
            inTransitTrips: 35,
            onTimeRate: 99.1,
            epodCompletionRate: 100,
            totalFreightTonnage: 1420,
            coldChainCompliance: 99.8,
            multiDropEfficiency: 92.4,
            transitBreakdown: [
              { corridor: 'Dubai (JAFZA) ➔ Abu Dhabi (ICAD)', trips: 14, status: 'On Route', sla: '100% On-Time' },
              { corridor: 'Sharjah (SAIF) ➔ Al Ain Industrial', trips: 11, status: 'Departed', sla: '98.2% On-Time' },
              { corridor: 'Dubai ➔ Muscat Cross-Border (Oman)', trips: 10, status: 'Customs Cleared', sla: '99.5% On-Time' },
            ],
          });
        }
      } catch (err) {
        console.error('Failed to load Logistics KPI stats:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-5 w-full max-w-2xl animate-pulse space-y-3">
        <div className="flex justify-between items-center">
          <div className="h-4 bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-slate-700 rounded w-1/6" />
        </div>
        <div className="grid grid-cols-4 gap-2 pt-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-700/50 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const s = stats!;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 w-full max-w-2xl shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🚛</span>
            <h3 className="text-base font-bold text-white tracking-tight">Logistics & Heavy Freight Ops</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              FREIGHT DISPATCH
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Heavy truck consignments, digital ePOD, cold chain sensors & multi-drop optimizer
          </p>
        </div>
        <Link
          href="/logistics"
          className="px-2.5 py-1 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 text-xs font-semibold transition-all flex items-center gap-1"
        >
          <span>Freight Hub</span>
          <span>→</span>
        </Link>
      </div>

      {/* 4 KPI Metric Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-yellow-400">{s.inTransitTrips}</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Trips In Transit</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-emerald-400">{s.onTimeRate}%</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">On-Time SLA</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-cyan-400">{s.totalFreightTonnage} T</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Monthly Freight</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-xl font-bold text-emerald-400">{s.epodCompletionRate}%</p>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Digital ePOD Rate</p>
        </div>
      </div>

      {/* Active Corridor Breakdown */}
      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Heavy Transport Corridors</p>
        <div className="space-y-2">
          {s.transitBreakdown.map((corridor, idx) => (
            <div key={idx} className="bg-slate-900/40 rounded-xl p-2.5 text-xs flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white truncate">{corridor.corridor}</p>
                <div className="flex items-center gap-3 text-slate-400 text-[11px] mt-0.5">
                  <span className="text-yellow-400 font-medium">{corridor.trips} Consignments</span>
                  <span>·</span>
                  <span>Status: {corridor.status}</span>
                </div>
              </div>
              <span className="text-[11px] font-bold text-emerald-400 font-mono flex-shrink-0">{corridor.sla}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cold Chain & Safety */}
      <div className="rounded-xl bg-slate-900/50 border border-white/8 p-3 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-300">
          <span>❄️</span>
          <span>Cold Chain Telematics: <strong>{s.coldChainCompliance}%</strong> sensor temp compliance (2°C – 8°C)</span>
        </div>
        <span className="text-emerald-400 font-mono text-[11px] font-bold">IoT LIVE</span>
      </div>

      {/* Footer Quick CTAs */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-xs">
        <div className="flex items-center gap-2">
          <Link href="/logistics" className="px-2.5 py-1 rounded-lg bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/25 font-semibold">
            Live Dispatch Board
          </Link>
          <Link href="/reports/revenue" className="px-2.5 py-1 rounded-lg bg-slate-700/50 text-slate-300 hover:text-white font-medium">
            Logistics Revenue BI
          </Link>
        </div>
        <Link href="/logistics" className="text-yellow-400 hover:text-yellow-300 font-medium">
          Open Logistics Module →
        </Link>
      </div>
    </div>
  );
}
