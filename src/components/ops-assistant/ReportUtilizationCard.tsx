'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface UtilizationRow {
  id: string;
  vehicle: string;
  plate: string;
  utilizationPercent: number;
  activeDays: number;
  idleDays: number;
  maintenanceDays: number;
  totalKM: number;
  revenue: number;
}

interface UtilizationData {
  rows: UtilizationRow[];
  totals: {
    totalVehicles: number;
    avgUtilization: number;
    totalRevenue: number;
    totalActiveDays: number;
    totalMaintenanceDays: number;
  };
  period: { from: string; to: string; days: number };
}

interface Props {
  fromDate?: string;
  toDate?: string;
  title?: string;
}

export default function ReportUtilizationCard({ fromDate, toDate, title = 'Fleet Utilization BI Report' }: Props) {
  const [data, setData] = useState<UtilizationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
        const res = await fetch(`/api/reports/fleet-utilization?${params.toString()}`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setData(json);
        }
      } catch (err) {
        console.error('Failed to load utilization report:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-5 w-full max-w-2xl animate-pulse space-y-3">
        <div className="flex justify-between items-center">
          <div className="h-4 bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-slate-700 rounded w-1/6" />
        </div>
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="h-16 bg-slate-700/50 rounded-xl" />
          <div className="h-16 bg-slate-700/50 rounded-xl" />
          <div className="h-16 bg-slate-700/50 rounded-xl" />
        </div>
        <div className="h-24 bg-slate-700/30 rounded-xl mt-3" />
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? {
    totalVehicles: rows.length,
    avgUtilization: rows.length ? Math.round(rows.reduce((s, r) => s + (r.utilizationPercent || 0), 0) / rows.length) : 0,
    totalRevenue: rows.reduce((s, r) => s + (r.revenue || 0), 0),
    totalActiveDays: rows.reduce((s, r) => s + (r.activeDays || 0), 0),
    totalMaintenanceDays: rows.reduce((s, r) => s + (r.maintenanceDays || 0), 0),
  };

  const topVehicles = [...rows].sort((a, b) => b.utilizationPercent - a.utilizationPercent).slice(0, 4);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 w-full max-w-2xl shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              BI ENGINE
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Analyzing {totals.totalVehicles} vehicles over the selected reporting window
          </p>
        </div>
        <Link
          href="/reports/fleet-utilization"
          className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition-all flex items-center gap-1"
        >
          <span>Full BI Heatmap</span>
          <span>→</span>
        </Link>
      </div>

      {/* KPI Highlight Tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-2xl font-bold text-emerald-400">{totals.avgUtilization}%</p>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">Average Utilization</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-2xl font-bold text-cyan-400">AED {totals.totalRevenue.toLocaleString()}</p>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">Attributable Revenue</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-2xl font-bold text-amber-400">{totals.totalMaintenanceDays} d</p>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">Workshop Downtime</p>
        </div>
      </div>

      {/* Top Assets Utilization Breakdown */}
      {topVehicles.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Top Utilized Assets</p>
          <div className="space-y-2">
            {topVehicles.map(v => (
              <div key={v.id} className="bg-slate-900/40 rounded-xl p-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white truncate">{v.vehicle}</span>
                    <span className="font-mono text-[10px] text-slate-400">[{v.plate || 'No Plate'}]</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400 text-[11px] mt-1">
                    <span>Active: {v.activeDays}d</span>
                    <span>·</span>
                    <span>Idle: {v.idleDays}d</span>
                    <span>·</span>
                    <span>KM: {v.totalKM.toLocaleString()}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-sm font-bold text-emerald-400">{Math.round(v.utilizationPercent)}%</span>
                  <div className="w-16 h-1 bg-slate-700 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, v.utilizationPercent)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Quick Action */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs text-slate-400">
        <span>Export format: CSV / PDF / BI Dashboard</span>
        <Link href="/reports/fleet-utilization" className="text-emerald-400 hover:text-emerald-300 font-medium">
          Open in BI Reports Module →
        </Link>
      </div>
    </div>
  );
}
