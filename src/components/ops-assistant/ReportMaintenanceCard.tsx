'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface Props {
  fromDate?: string;
  toDate?: string;
  title?: string;
}

export default function ReportMaintenanceCard({ fromDate, toDate, title = 'Maintenance & Workshop BI Cost Report' }: Props) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
        const res = await fetch(`/api/reports/maintenance?${params.toString()}`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setData(json);
        }
      } catch (err) {
        console.error('Failed to load maintenance report:', err);
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
      </div>
    );
  }

  const summary = data?.summary ?? {
    totalCost: 0,
    averagePerVehicle: 0,
    highestCostVehicle: 'N/A',
    costByCategory: [],
  };

  const costByCategory: Array<{ category: string; cost: number }> = summary.costByCategory ?? [];
  const topCategories = costByCategory.slice(0, 4);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 w-full max-w-2xl shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🔧</span>
            <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
              WORKSHOP TCO
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Preventive service costs, breakdown repairs, and parts expenditures
          </p>
        </div>
        <Link
          href="/reports/maintenance"
          className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-xs font-semibold transition-all flex items-center gap-1"
        >
          <span>Maintenance BI</span>
          <span>→</span>
        </Link>
      </div>

      {/* KPI Highlight Tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-2xl font-bold text-rose-400">
            AED {Math.round(summary.totalCost).toLocaleString()}
          </p>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">Total Repair Spend</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center">
          <p className="text-2xl font-bold text-amber-400">
            AED {Math.round(summary.averagePerVehicle).toLocaleString()}
          </p>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">Avg Cost / Asset</p>
        </div>
        <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-center truncate">
          <p className="text-sm font-bold text-white truncate mt-1">{summary.highestCostVehicle || 'None'}</p>
          <p className="text-[11px] font-medium text-slate-400 mt-1">Highest Cost Asset</p>
        </div>
      </div>

      {/* Spend by Repair Category */}
      {topCategories.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cost by Maintenance Category</p>
          <div className="space-y-2">
            {topCategories.map((cat, i) => {
              const pct = summary.totalCost > 0 ? Math.round((cat.cost / summary.totalCost) * 100) : 0;
              return (
                <div key={i} className="bg-slate-900/40 rounded-xl p-2.5 text-xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-white">{cat.category || 'General Service'}</span>
                    <span className="font-bold text-rose-300">AED {Math.round(cat.cost).toLocaleString()} ({pct}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs text-slate-400">
        <span>Includes parts inventory & garage quotations</span>
        <Link href="/reports/maintenance" className="text-rose-400 hover:text-rose-300 font-medium">
          Open in Maintenance BI Module →
        </Link>
      </div>
    </div>
  );
}
