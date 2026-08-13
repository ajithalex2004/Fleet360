'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Analytics {
  totalTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  pendingTrips: number;
  activeTrips: number;
  completionRate: number;
  cancellationRate: number;
  onTimeRate: number | null;
  totalVehicles: number;
  availableVehicles: number;
  maintenanceVehicles: number;
  fleetUtilization: number;
  dailyCompleted: { day: string; trips: number }[];
  statusDistribution: { status: string; count: number }[];
  tripsByDow: { dow: number; label: string; trips: number }[];
  shipmentTypes: { type: string; count: number }[];
}

// ── Colour palette ────────────────────────────────────────────────────────────

const CHART_COLORS = ['#f59e0b','#22d3ee','#10b981','#8b5cf6','#f97316','#ec4899','#6366f1','#14b8a6'];

const STATUS_COLORS: Record<string, string> = {
  PENDING:          '#f59e0b',
  APPROVED:         '#38bdf8',
  CONFIRMED:        '#38bdf8',
  ASSIGNED:         '#a78bfa',
  DISPATCHED:       '#fb923c',
  ENROUTE_PICKUP:   '#22d3ee',
  LOADED:           '#facc15',
  ENROUTE_DELIVERY: '#4ade80',
  ACTIVE:           '#4ade80',
  DELIVERED:        '#2dd4bf',
  POD_SUBMITTED:    '#34d399',
  CLOSED:           '#94a3b8',
  COMPLETED:        '#94a3b8',
  CANCELLED:        '#f87171',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Created', APPROVED: 'Approved', CONFIRMED: 'Approved',
  ASSIGNED: 'Assigned', DISPATCHED: 'Dispatched',
  ENROUTE_PICKUP: 'En-route Pickup', LOADED: 'Loaded',
  ENROUTE_DELIVERY: 'En-route Delivery', ACTIVE: 'En-route',
  DELIVERED: 'Delivered', POD_SUBMITTED: 'POD Submitted',
  CLOSED: 'Closed', COMPLETED: 'Closed', CANCELLED: 'Cancelled',
};

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, color = 'text-white', ring,
}: {
  icon: string; label: string; value: string | number; sub?: string;
  color?: string; ring?: number;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 border border-white/10 space-y-2">
      <div className="flex items-start justify-between">
        <span className="text-2xl">{icon}</span>
        {ring != null && (
          <div className="relative w-10 h-10">
            <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="#1e293b" strokeWidth="3" />
              <circle cx="18" cy="18" r="15" fill="none" stroke="#f59e0b" strokeWidth="3"
                strokeDasharray={`${(ring / 100) * 94.2} 94.2`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-amber-400">
              {ring}%
            </span>
          </div>
        )}
      </div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-sm font-medium text-white">{label}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-white/20 rounded-xl px-3 py-2 text-xs shadow-xl">
      {label && <p className="text-slate-400 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-bold text-white">{p.value}</span></p>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LogisticsAnalyticsPage() {
  const [data,        setData]        = useState<Analytics | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/analytics', { cache: 'no-store' });
      if (res.ok) { setData(await res.json()); setLastUpdated(new Date()); }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-slate-800/60 rounded-xl w-64 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-28 bg-slate-800/60 rounded-2xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">📊</div>
        <p className="text-slate-400">No analytics data available</p>
      </div>
    );
  }

  // Normalise status distribution labels
  const statusData = data.statusDistribution.map(s => ({
    ...s,
    label: STATUS_LABEL[s.status] ?? s.status,
    color: STATUS_COLORS[s.status] ?? '#94a3b8',
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Logistics Analytics</h1>
          <p className="text-slate-400 mt-1">KPI dashboard &amp; fleet performance metrics</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Updated {lastUpdated.toLocaleTimeString()}
        </div>
      </div>

      {/* ── KPI Grid ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon="📋" label="Total Trips" value={data.totalTrips} sub="All-time logistics bookings" />
        <KpiCard icon="✅" label="Completed" value={data.completedTrips}
          color="text-emerald-400" sub="Delivered + closed" ring={data.completionRate} />
        <KpiCard icon="🚛" label="Active Now" value={data.activeTrips}
          color="text-blue-400" sub="En-route & in-transit" />
        <KpiCard icon="📋" label="Pending" value={data.pendingTrips}
          color="text-amber-400" sub="Awaiting approval" />
        <KpiCard icon="❌" label="Cancelled" value={data.cancelledTrips}
          color="text-red-400" sub={`${data.cancellationRate}% cancellation rate`} />
        <KpiCard icon="⏱️" label="On-Time Rate"
          value={data.onTimeRate != null ? `${data.onTimeRate}%` : 'N/A'}
          color={data.onTimeRate != null ? (data.onTimeRate >= 80 ? 'text-emerald-400' : data.onTimeRate >= 60 ? 'text-amber-400' : 'text-red-400') : 'text-slate-400'}
          sub="Trips delivered by deadline" />
        <KpiCard icon="🚛" label="Fleet Size" value={data.totalVehicles}
          sub={`${data.availableVehicles} available · ${data.maintenanceVehicles} in maintenance`} />
        <div className="glass-card rounded-2xl p-5 border border-white/10">
          <div className="flex items-start justify-between mb-3">
            <span className="text-2xl">📈</span>
            <span className={`text-sm font-bold ${
              data.fleetUtilization >= 70 ? 'text-emerald-400'
              : data.fleetUtilization >= 40 ? 'text-amber-400'
              : 'text-red-400'
            }`}>{data.fleetUtilization}%</span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all"
              style={{ width: `${data.fleetUtilization}%` }} />
          </div>
          <div className="text-sm font-medium text-white">Fleet Utilization</div>
          <div className="text-xs text-slate-500 mt-0.5">Active vs total vehicles</div>
        </div>
      </div>

      {/* ── Charts Row 1 ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Daily completed trips (14-day line chart) */}
        <div className="glass-card rounded-2xl p-5 border border-white/10">
          <h2 className="text-sm font-semibold text-white mb-4">Completed Trips — Last 14 Days</h2>
          {data.dailyCompleted.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No completion data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.dailyCompleted} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }}
                  tickFormatter={d => { const dt = new Date(d); return `${dt.getDate()}/${dt.getMonth()+1}`; }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="trips" name="Trips" stroke="#f59e0b"
                  strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status distribution (pie) */}
        <div className="glass-card rounded-2xl p-5 border border-white/10">
          <h2 className="text-sm font-semibold text-white mb-4">Trip Status Distribution</h2>
          {statusData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No data</div>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="60%" height={200}>
                <PieChart>
                  <Pie data={statusData} dataKey="count" nameKey="label"
                    cx="50%" cy="50%" outerRadius={75} paddingAngle={2}>
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 overflow-hidden">
                {statusData.slice(0, 8).map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                      <span className="text-slate-400 truncate">{s.label}</span>
                    </div>
                    <span className="text-white font-medium flex-shrink-0">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Charts Row 2 ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Trips by day of week (bar chart) */}
        <div className="glass-card rounded-2xl p-5 border border-white/10">
          <h2 className="text-sm font-semibold text-white mb-4">Trips by Day of Week</h2>
          {data.tripsByDow.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.tripsByDow} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="trips" name="Trips" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Shipment type breakdown (horizontal bar) */}
        <div className="glass-card rounded-2xl p-5 border border-white/10">
          <h2 className="text-sm font-semibold text-white mb-4">Shipment Type Breakdown</h2>
          {data.shipmentTypes.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-600 text-sm">
              No shipment type data — set shipmentType when creating bookings
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.shipmentTypes} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="type" tick={{ fill: '#64748b', fontSize: 10 }} width={60} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Trips" radius={[0, 4, 4, 0]}>
                  {data.shipmentTypes.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Fleet utilization progress bars ─────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-5 border border-white/10">
        <h2 className="text-sm font-semibold text-white mb-5">Fleet Status Breakdown</h2>
        <div className="space-y-4">
          {[
            { label: 'Available',    value: data.availableVehicles,     total: data.totalVehicles, color: 'bg-emerald-500' },
            { label: 'In Use',       value: data.totalVehicles - data.availableVehicles - data.maintenanceVehicles, total: data.totalVehicles, color: 'bg-blue-500' },
            { label: 'Maintenance',  value: data.maintenanceVehicles,   total: data.totalVehicles, color: 'bg-amber-500' },
          ].map(row => (
            <div key={row.label} className="flex items-center gap-4">
              <span className="text-xs text-slate-400 w-24 flex-shrink-0">{row.label}</span>
              <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full ${row.color} rounded-full transition-all`}
                  style={{ width: row.total > 0 ? `${Math.max(0, (row.value / row.total) * 100)}%` : '0%' }}
                />
              </div>
              <span className="text-xs text-white font-medium w-16 text-right flex-shrink-0">
                {Math.max(0, row.value)} / {row.total}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
