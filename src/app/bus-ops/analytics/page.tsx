'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Analytics {
  kpis: {
    totalTrips: number; completedTrips: number; cancelledTrips: number; inTransitTrips: number;
    completionRate: number; cancellationRate: number; totalPassengers: number;
    totalRoutes: number; totalStaff: number; avgOccupancy: number;
    onTimeDeparturePct?: number; onTimeArrivalPct?: number;
    avgDepartureDelayMin?: number; avgArrivalDelayMin?: number;
    costPerTrip?: number; costPerPassenger?: number; costPerKm?: number; totalCost?: number;
    costBreakdown?: { fuel: number; driver: number; vehicle: number };
  };
  charts: {
    daily:   Array<{ day: string; trips: number; passengers: number }>;
    byShift: Array<{ name: string; value: number }>;
    byRoute: Array<{ name: string; trips: number; passengers: number }>;
    byHour:  Array<{ hour: string; trips: number }>;
    slaByRoute?: Array<{ name: string; trips: number; ontimePct: number; avgDelayMin: number }>;
    boardingMethods?: Array<{ method: string; count: number }>;
  };
}

const SHIFT_COLORS: Record<string, string> = {
  MORNING: '#f59e0b', EVENING: '#818cf8', NIGHT: '#1e293b', SPLIT: '#22d3ee',
};
const PIE_PALETTE = ['#f59e0b','#818cf8','#22d3ee','#4ade80','#fb923c'];

// ── Custom tooltip ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-white/10 rounded-xl p-3 text-xs space-y-1">
      <p className="text-slate-300 font-medium">{label}</p>
      {payload.map((p: { color: string; name: string; value: number }) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value.toLocaleString()}</p>
      ))}
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-1">
      <p className="text-xs text-slate-500 flex items-center gap-1.5">{icon} {label}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
    </div>
  );
}

// ── Metric bar ────────────────────────────────────────────────────────────────
function MetricBar({ label, value, color, max = 100 }: { label: string; value: number; color: string; max?: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={`font-semibold ${color}`}>{value}{max === 100 ? '%' : ''}</span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${
          pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
        }`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BusOpsAnalyticsPage() {
  const [data,    setData]    = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bus-ops/analytics', { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-72 bg-slate-800 rounded-xl" />
        <div className="grid grid-cols-5 gap-4">{[...Array(5)].map((_,i) => <div key={i} className="h-24 bg-slate-800 rounded-2xl" />)}</div>
        <div className="grid grid-cols-2 gap-4">{[...Array(4)].map((_,i) => <div key={i} className="h-56 bg-slate-800 rounded-2xl" />)}</div>
      </div>
    );
  }

  if (!data) return <div className="text-slate-400 text-center py-20">No analytics data available.</div>;

  const { kpis, charts } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Staff Transport Analytics</h1>
          <p className="text-slate-400 text-sm mt-0.5">Last 30 days performance overview</p>
        </div>
        <button onClick={load} className="text-xs text-slate-400 border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/20 hover:text-white transition-colors">
          ↺ Refresh
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard icon="🚌" label="Total Trips"     value={kpis.totalTrips}      color="text-white" />
        <KpiCard icon="✅" label="Completed"        value={kpis.completedTrips}  color="text-emerald-400" sub={`${kpis.completionRate}%`} />
        <KpiCard icon="👥" label="Passengers"       value={kpis.totalPassengers.toLocaleString()} color="text-purple-400" />
        <KpiCard icon="📍" label="Avg Occupancy"    value={`${kpis.avgOccupancy}%`} color={kpis.avgOccupancy >= 70 ? 'text-emerald-400' : 'text-amber-400'} />
        <KpiCard icon="🗺️" label="Active Routes"    value={kpis.totalRoutes}     color="text-sky-400" sub={`${kpis.totalStaff} staff`} />
      </div>

      {/* Performance bars */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricBar label="Completion Rate"    value={kpis.completionRate}   color="text-emerald-400" />
        <MetricBar label="Seat Utilisation"   value={kpis.avgOccupancy}     color="text-purple-400" />
        <MetricBar label="On-time Departure"  value={kpis.onTimeDeparturePct ?? 0} color="text-amber-400" />
      </div>

      {/* SLA + Cost section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">On-time SLA (last 30 days)</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-3xl font-bold text-emerald-400">{kpis.onTimeDeparturePct ?? 0}%</p>
              <p className="text-xs text-slate-500 mt-0.5">Departure ≤ +5 min</p>
              <p className="text-[10px] text-slate-600 mt-1">avg delay {kpis.avgDepartureDelayMin ?? 0} min</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-cyan-400">{kpis.onTimeArrivalPct ?? 0}%</p>
              <p className="text-xs text-slate-500 mt-0.5">Arrival ≤ +10 min</p>
              <p className="text-[10px] text-slate-600 mt-1">avg delay {kpis.avgArrivalDelayMin ?? 0} min</p>
            </div>
          </div>
          {(charts.slaByRoute ?? []).length > 0 && (
            <div className="border-t border-white/5 pt-3 space-y-1.5">
              <p className="text-[10px] text-slate-500 uppercase">Worst on-time routes</p>
              {charts.slaByRoute!.map(r => (
                <div key={r.name} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 truncate">{r.name}</span>
                  <span className={r.ontimePct >= 80 ? 'text-emerald-400' : r.ontimePct >= 60 ? 'text-amber-400' : 'text-rose-400'}>
                    {r.ontimePct}% on-time · {r.avgDelayMin} min avg
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Cost (last 30 days)</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-bold text-white">AED {(kpis.costPerTrip ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
              <p className="text-xs text-slate-500 mt-0.5">per trip</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">AED {(kpis.costPerPassenger ?? 0).toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-0.5">per passenger</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">AED {(kpis.costPerKm ?? 0).toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-0.5">per km</p>
            </div>
          </div>
          {kpis.costBreakdown && (
            <div className="border-t border-white/5 pt-3 space-y-1.5 text-xs">
              <p className="text-[10px] text-slate-500 uppercase">Breakdown · total AED {(kpis.totalCost ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
              <div className="flex items-center justify-between"><span className="text-slate-400">⛽ Fuel</span><span className="text-amber-300">AED {kpis.costBreakdown.fuel.toLocaleString()}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-400">🧑‍✈️ Driver</span><span className="text-cyan-300">AED {kpis.costBreakdown.driver.toLocaleString()}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-400">🚌 Vehicle</span><span className="text-violet-300">AED {kpis.costBreakdown.vehicle.toLocaleString()}</span></div>
            </div>
          )}
          <p className="text-[10px] text-slate-600 italic">
            Defaults: AED 2.95/L fuel · AED 30/hr driver · AED 0.50/km vehicle. Override via env BUS_FUEL_AED_PER_L / BUS_DRIVER_AED_PER_HR / BUS_VEHICLE_AED_PER_KM.
          </p>
        </div>
      </div>

      {/* Boarding-method mix */}
      {(charts.boardingMethods ?? []).length > 0 && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-3">Boarding method adoption (last 30 days)</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(charts.boardingMethods ?? []).map(m => {
              const total = charts.boardingMethods!.reduce((s, x) => s + x.count, 0);
              const pct = total > 0 ? Math.round((m.count / total) * 100) : 0;
              return (
                <div key={m.method} className="rounded-xl bg-slate-800/60 border border-white/10 p-3 text-center">
                  <p className="text-2xl font-bold text-white">{m.count}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{m.method.replace('_', ' ')}</p>
                  <p className="text-[10px] text-slate-600 mt-1">{pct}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Charts row 1: Daily trend + Hour heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-4">Daily Trips & Passengers (14 days)</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={charts.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Line dataKey="trips"      name="Trips"      stroke="#a78bfa" strokeWidth={2} dot={false} />
              <Line dataKey="passengers" name="Passengers" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-4">Peak Hours Distribution</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={charts.byHour} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="hour" tick={{ fill: '#475569', fontSize: 8 }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="trips" name="Trips" fill="#a78bfa" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2: By route + Shift distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 lg:col-span-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-4">Top Routes by Trips & Passengers</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={charts.byRoute} layout="vertical" barGap={2} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} width={90} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="trips"      name="Trips"      fill="#a78bfa" radius={[0, 4, 4, 0]} />
              <Bar dataKey="passengers" name="Passengers" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-4">Trips by Shift</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={charts.byShift} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={35}>
                {charts.byShift.map((entry, idx) => (
                  <Cell key={entry.name} fill={SHIFT_COLORS[entry.name] ?? PIE_PALETTE[idx % PIE_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number, n: string) => [v, n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 justify-center mt-2">
            {charts.byShift.map((s, i) => (
              <div key={s.name} className="flex items-center gap-1 text-xs text-slate-400">
                <div className="w-2 h-2 rounded-full" style={{ background: SHIFT_COLORS[s.name] ?? PIE_PALETTE[i % PIE_PALETTE.length] }} />
                {s.name}: {s.value}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* In-transit now */}
      {kpis.inTransitTrips > 0 && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-5 py-3 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <span className="text-emerald-300 font-medium text-sm">{kpis.inTransitTrips} trip{kpis.inTransitTrips > 1 ? 's' : ''} currently in transit</span>
        </div>
      )}
    </div>
  );
}
