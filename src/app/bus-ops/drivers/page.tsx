'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Trophy, RotateCw } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

interface PerfRow {
  driverId: string;
  name: string | null;
  licenseNumber: string | null;
  licenseType: string | null;
  status: string | null;
  score: number | null;
  grade: string;
  onTimePct: number | null;
  incidentCount: number | null;
  fuelEfficiency: number | null;
  totalTrips: number | null;
  totalKm: number | null;
}

interface PerfResponse {
  period: { year: number; month: number };
  drivers: PerfRow[];
}

const GRADE_BG: Record<string, string> = {
  A: 'bg-emerald-500/30 text-emerald-200 border-emerald-500/60',
  B: 'bg-cyan-500/30 text-cyan-200 border-cyan-500/60',
  C: 'bg-amber-500/30 text-amber-200 border-amber-500/60',
  D: 'bg-orange-500/30 text-orange-200 border-orange-500/60',
  E: 'bg-rose-500/30 text-rose-200 border-rose-500/60',
  '—': 'bg-slate-500/20 text-slate-400 border-slate-500/40',
};

function currentMonthArg(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function DriverPerformancePage() {
  const [month, setMonth] = useState(() => currentMonthArg());
  const [data, setData] = useState<PerfResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/bus-ops/driver-performance?month=${month}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Load failed');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const recompute = async () => {
    setRecomputing(true); setError(null);
    try {
      const res = await fetch(`/api/bus-ops/driver-performance/recompute?month=${month}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Recompute failed');
      alert(`Recomputed for ${month}: ${json.driversAssessed} drivers, ${json.upserted} written, ${json.errors} errors.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recompute failed');
    } finally {
      setRecomputing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Performance"
        subtitle="Score = 50% on-time + 30% incident-free + 20% completion. Min 5 trips for a score."
        icon={Trophy}
        accent="amber"
        actions={
          <>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-800 border border-white/10 text-white text-sm" />
            <button onClick={recompute} disabled={recomputing}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              <RotateCw className={`w-3.5 h-3.5 ${recomputing ? 'animate-spin' : ''}`} />
              {recomputing ? 'Recomputing…' : 'Recompute'}
            </button>
          </>
        }
      />

      {error && <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-sm">{error}</div>}

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : !data || data.drivers.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No performance data for {month}. Tap <strong>Recompute</strong> to run the scoring engine.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Licence</th>
                <th className="px-4 py-3 text-right">Trips</th>
                <th className="px-4 py-3 text-right">KM</th>
                <th className="px-4 py-3 text-right">On-time %</th>
                <th className="px-4 py-3 text-right">Incidents</th>
                <th className="px-4 py-3 text-right">Fuel km/L</th>
                <th className="px-4 py-3 text-right">Score</th>
                <th className="px-4 py-3">Grade</th>
              </tr>
            </thead>
            <tbody>
              {data.drivers.map(d => (
                <tr key={d.driverId} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{d.name ?? '—'}</div>
                    <div className="text-[11px] text-slate-500">{d.status ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-mono text-slate-300">{d.licenseNumber ?? '—'}</div>
                    <div className="text-slate-500">{d.licenseType ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-200">{d.totalTrips ?? 0}</td>
                  <td className="px-4 py-3 text-right text-slate-200">{Math.round(d.totalKm ?? 0).toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right ${(d.onTimePct ?? 0) >= 90 ? 'text-emerald-300' : (d.onTimePct ?? 0) >= 75 ? 'text-amber-300' : 'text-rose-300'}`}>
                    {(d.onTimePct ?? 0).toFixed(1)}%
                  </td>
                  <td className={`px-4 py-3 text-right ${(d.incidentCount ?? 0) === 0 ? 'text-emerald-300' : (d.incidentCount ?? 0) <= 2 ? 'text-amber-300' : 'text-rose-300'}`}>
                    {d.incidentCount ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">{(d.fuelEfficiency ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">
                    {d.score != null
                      ? <span className="text-white font-bold text-lg">{d.score.toFixed(1)}</span>
                      : <span className="text-slate-500 text-xs italic">insufficient</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-3 py-1 rounded-lg text-sm font-bold border ${GRADE_BG[d.grade]}`}>
                      {d.grade}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-slate-800/30 border border-white/5 rounded-xl p-5 text-xs text-slate-400 space-y-2">
        <p className="text-white font-semibold mb-1">Scoring formula</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>On-time %</strong> — fraction of trips that departed within +5 min of scheduled (50% weight)</li>
          <li><strong>Incident-free rate</strong> — clamped from incidents per 1000 km. 1/1000 km lands at 50, 2/1000 at 0 (30% weight)</li>
          <li><strong>Completion rate</strong> — fraction of assigned trips that reached COMPLETED (20% weight)</li>
          <li>Drivers with &lt;5 trips in the period show "insufficient signal" rather than a noisy score — never punished or rewarded for too-thin data</li>
          <li>Recompute is idempotent — safe to re-run any time. Run nightly via cron once stable</li>
        </ul>
      </div>
    </div>
  );
}
