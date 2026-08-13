'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverStats {
  driverId:        string;
  firstName:       string;
  lastName:        string;
  phone:           string | null;
  licenseNumber:   string | null;
  totalTrips:      number;
  completedTrips:  number;
  cancelledTrips:  number;
  onTimeTrips:     number;
  completionRate:  number;
  onTimeRate:      number;
  cancellationRate: number;
  avgTripHours:    number | null;
  lastTripDate:    string | null;
  score:           number;
  weekly:          Array<{ week: string; trips: number; onTime: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 85) return { text: 'text-emerald-400', ring: '#10b981', label: 'Excellent' };
  if (score >= 70) return { text: 'text-amber-400',   ring: '#f59e0b', label: 'Good' };
  if (score >= 50) return { text: 'text-orange-400',  ring: '#f97316', label: 'Average' };
  return             { text: 'text-red-400',           ring: '#ef4444', label: 'Needs Improvement' };
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Radial score gauge ────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const { ring, label } = scoreColor(score);
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
          <circle cx="60" cy="60" r={r} fill="none" stroke={ring} strokeWidth="10"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-white">{score}</span>
          <span className="text-xs text-slate-500">/ 100</span>
        </div>
      </div>
      <span className={`text-sm font-semibold ${scoreColor(score).text}`}>{label}</span>
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 space-y-1">
      <p className="text-xs text-slate-500 flex items-center gap-1.5">{icon} {label}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-white/10 rounded-xl p-3 text-xs space-y-1">
      <p className="text-slate-300 font-medium">{label}</p>
      {payload.map((p: { color: string; name: string; value: number }) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

// ── Metric bar ────────────────────────────────────────────────────────────────

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={`font-semibold ${color}`}>{value}%</span>
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${
          value >= 85 ? 'bg-emerald-500' : value >= 70 ? 'bg-amber-500' : value >= 50 ? 'bg-orange-500' : 'bg-red-500'
        }`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DriverPerformancePage() {
  const params   = useParams<{ id: string }>();
  const driverId = params?.id;

  const [stats,   setStats]   = useState<DriverStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days,    setDays]    = useState(90);

  const load = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logistics/driver-stats?driverId=${driverId}&days=${days}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [driverId, days]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-64 bg-slate-800 rounded-xl" />
        <div className="h-40 bg-slate-800 rounded-2xl" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-800 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-20 space-y-3">
        <div className="text-5xl">👤</div>
        <p className="text-slate-400">Driver not found or no data available.</p>
        <Link href="/logistics/drivers" className="text-amber-400 text-sm hover:text-amber-300">← Back to Drivers</Link>
      </div>
    );
  }

  const sc = scoreColor(stats.score);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-2xl font-bold text-white flex-shrink-0">
            {stats.firstName[0]}{stats.lastName[0]}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{stats.firstName} {stats.lastName}</h1>
            <p className="text-slate-400 text-sm mt-0.5 space-x-3">
              {stats.phone && <span>📞 {stats.phone}</span>}
              {stats.licenseNumber && <span>🪪 {stats.licenseNumber}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Day selector */}
          {([30, 60, 90, 180] as const).map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                days === d
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'text-slate-500 border-white/10 hover:border-white/20 hover:text-white'
              }`}>
              {d}d
            </button>
          ))}
          <Link href="/logistics/drivers"
            className="text-xs text-slate-500 hover:text-slate-300 border border-white/10 px-3 py-1.5 rounded-lg transition-colors">
            ← Drivers
          </Link>
        </div>
      </div>

      {/* Score + overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Score gauge */}
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-4">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Performance Score</p>
          <ScoreGauge score={stats.score} />
          <div className="text-center">
            <p className="text-xs text-slate-600">Last {days} days · {stats.totalTrips} trips</p>
            {stats.lastTripDate && (
              <p className="text-xs text-slate-700 mt-0.5">Last trip: {fmt(stats.lastTripDate)}</p>
            )}
          </div>
        </div>

        {/* Metric bars */}
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 space-y-4 md:col-span-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Performance Metrics</p>
          <MetricBar label="Completion Rate"    value={stats.completionRate}   color={sc.text} />
          <MetricBar label="On-Time Delivery"   value={stats.onTimeRate}       color={sc.text} />
          <MetricBar label="No-Cancellation"    value={100 - stats.cancellationRate} color={sc.text} />
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon="📦" label="Total Trips"   value={stats.totalTrips}    color="text-white" />
        <KpiCard icon="✅" label="Completed"     value={stats.completedTrips}
          sub={`${stats.completionRate}% of total`}      color="text-emerald-400" />
        <KpiCard icon="⏰" label="On Time"       value={stats.onTimeTrips}
          sub={`${stats.onTimeRate}% of completed`}      color="text-amber-400" />
        <KpiCard icon="❌" label="Cancelled"     value={stats.cancelledTrips}
          sub={`${stats.cancellationRate}% of total`}    color={stats.cancellationRate > 10 ? 'text-red-400' : 'text-slate-400'} />
      </div>

      {stats.avgTripHours !== null && (
        <div className="bg-slate-900/40 border border-white/5 rounded-xl px-5 py-3 flex items-center gap-3 text-sm">
          <span className="text-slate-500">⏱ Average trip duration:</span>
          <span className="text-white font-semibold">
            {stats.avgTripHours >= 24
              ? `${Math.round(stats.avgTripHours / 24)} days`
              : `${stats.avgTripHours} hours`}
          </span>
        </div>
      )}

      {/* Weekly activity chart */}
      {stats.weekly && stats.weekly.length > 0 && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-4">Weekly Trip Activity (12 weeks)</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.weekly} barGap={2} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="trips"  name="Total Trips" fill="#334155" radius={[4, 4, 0, 0]} />
              <Bar dataKey="onTime" name="On Time"     fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Score breakdown explanation */}
      <div className="bg-slate-900/40 border border-white/5 rounded-2xl p-5">
        <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-3">Score Calculation</p>
        <div className="grid grid-cols-3 gap-4 text-xs text-slate-400">
          <div className="space-y-1">
            <p className="text-slate-300 font-medium">Completion Rate</p>
            <p>50% of score</p>
            <p className="text-amber-400 font-semibold">{stats.completionRate}% × 0.5 = {Math.round(stats.completionRate * 0.5)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-slate-300 font-medium">On-Time Delivery</p>
            <p>30% of score</p>
            <p className="text-amber-400 font-semibold">{stats.onTimeRate}% × 0.3 = {Math.round(stats.onTimeRate * 0.3)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-slate-300 font-medium">No Cancellations</p>
            <p>20% of score</p>
            <p className="text-amber-400 font-semibold">{100 - stats.cancellationRate}% × 0.2 = {Math.round((100 - stats.cancellationRate) * 0.2)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
