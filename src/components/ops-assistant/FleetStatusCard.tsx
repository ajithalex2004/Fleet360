'use client';
import React, { useEffect, useState } from 'react';

interface FleetStats {
  totalVehicles: number;
  available: number;
  inMaintenance: number;
  allocated: number;
  expiringDocs: number;
  openWorkOrders: number;
  expiringInsurance: number;
  byLifecycleStage: { stage: string; count: number }[];
  byUsage: { usage: string; count: number }[];
}

interface Props { highlight?: string; }

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  available:    { label: 'Available',    color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30', icon: '✅' },
  inMaintenance:{ label: 'Maintenance',  color: 'text-amber-400',   bg: 'bg-amber-500/15 border-amber-500/30',   icon: '🔧' },
  allocated:    { label: 'Allocated',    color: 'text-blue-400',    bg: 'bg-blue-500/15 border-blue-500/30',    icon: '📌' },
  reserved:     { label: 'Reserved',     color: 'text-purple-400',  bg: 'bg-purple-500/15 border-purple-500/30', icon: '🔒' },
};

export default function FleetStatusCard({ highlight = 'all' }: Props) {
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/fleet/stats', { cache: 'no-store' });
      const data = await res.json();
      setStats(data);
      setLastUpdated(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, 30000);
    return () => clearInterval(timer);
  }, []);

  if (loading) return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/60 p-5 w-full max-w-2xl animate-pulse">
      <div className="h-4 bg-slate-700 rounded w-1/3 mb-4" />
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-700/60 rounded-xl" />)}
      </div>
    </div>
  );

  if (!stats) return <div className="text-slate-500 text-sm">Unable to load fleet data.</div>;

  const total = stats.totalVehicles || 1;
  const utilizationRate = Math.round(((total - stats.available - stats.inMaintenance) / total) * 100);

  const statusCards = [
    { key: 'available',     value: stats.available,     ...statusConfig.available },
    { key: 'inMaintenance', value: stats.inMaintenance, ...statusConfig.inMaintenance },
    { key: 'allocated',     value: stats.allocated,     ...statusConfig.allocated },
    { key: 'rented',        value: Math.max(0, total - stats.available - stats.inMaintenance - stats.allocated), label: 'Rented', color: 'text-cyan-400', bg: 'bg-cyan-500/15 border-cyan-500/30', icon: '🚗' },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-800/50 backdrop-blur-sm p-5 w-full max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🚗</span>
          <h3 className="text-sm font-semibold text-white">Live Fleet Status</h3>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Updated {lastUpdated.toLocaleTimeString()}</span>
          <button onClick={fetchStats} className="text-xs text-slate-400 hover:text-white bg-slate-700/60 px-2 py-1 rounded-lg transition-colors">↻</button>
        </div>
      </div>

      {/* Total + Utilization */}
      <div className="flex items-center gap-4 bg-slate-900/40 rounded-xl px-4 py-3">
        <div>
          <div className="text-3xl font-bold text-white">{stats.totalVehicles}</div>
          <div className="text-xs text-slate-400">Total Vehicles</div>
        </div>
        <div className="flex-1 h-px bg-white/10" />
        <div className="text-right">
          <div className={`text-2xl font-bold ${utilizationRate >= 75 ? 'text-emerald-400' : utilizationRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{utilizationRate}%</div>
          <div className="text-xs text-slate-400">Utilization Rate</div>
        </div>
        {/* Mini progress bar */}
        <div className="w-24">
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full transition-all" style={{ width: `${utilizationRate}%` }} />
          </div>
        </div>
      </div>

      {/* Status Grid */}
      <div className="grid grid-cols-4 gap-2">
        {statusCards.map(s => (
          <div key={s.key} className={`rounded-xl border p-3 text-center transition-all ${s.bg} ${highlight === s.key || highlight === 'all' ? 'scale-100' : 'opacity-70'}`}>
            <div className="text-lg mb-1">{s.icon}</div>
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            <div className="mt-1 text-xs text-slate-500">{Math.round((s.value / total) * 100)}%</div>
          </div>
        ))}
      </div>

      {/* Compliance Alerts */}
      {(stats.expiringDocs > 0 || stats.openWorkOrders > 0 || stats.expiringInsurance > 0) && (
        <div className="grid grid-cols-3 gap-2">
          {stats.expiringDocs > 0 && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              <span className="text-amber-400">📋</span>
              <div>
                <div className="text-xs font-semibold text-amber-400">{stats.expiringDocs}</div>
                <div className="text-xs text-slate-500">Docs Expiring</div>
              </div>
            </div>
          )}
          {stats.openWorkOrders > 0 && (
            <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-2">
              <span className="text-orange-400">🔧</span>
              <div>
                <div className="text-xs font-semibold text-orange-400">{stats.openWorkOrders}</div>
                <div className="text-xs text-slate-500">Work Orders</div>
              </div>
            </div>
          )}
          {stats.expiringInsurance > 0 && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <span className="text-red-400">🛡️</span>
              <div>
                <div className="text-xs font-semibold text-red-400">{stats.expiringInsurance}</div>
                <div className="text-xs text-slate-500">Insurance Expiry</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* By Usage breakdown */}
      {stats.byUsage.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 mb-2 uppercase tracking-wider">By Usage</div>
          <div className="flex flex-wrap gap-2">
            {stats.byUsage.map(u => (
              <span key={u.usage} className="text-xs bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-lg border border-white/5">
                {u.usage.replace(/_/g, ' ')} · <span className="text-white font-semibold">{u.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
