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

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading driver scores...</div></div>;

  const drivers = data?.drivers ?? [];
  const scoredCount = drivers.filter(d => d.score != null).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Driver Performance"
        subtitle={`${scoredCount} scored · ${drivers.length - scoredCount} insufficient signal · ${drivers.length} total · ${month}`}
        icon={Trophy}
        accent="violet"
        actions={
          <>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white text-sm focus:border-violet-500 focus:outline-none" />
            <button onClick={recompute} disabled={recomputing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              <RotateCw className={`w-4 h-4 ${recomputing ? 'animate-spin' : ''}`} />
              {recomputing ? 'Recomputing…' : 'Recompute'}
            </button>
          </>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {drivers.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            No performance data for {month}. Tap <strong className="text-violet-300">Recompute</strong> to run the scoring engine.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Driver', 'Licence', 'Trips', 'KM', 'On-time %', 'Incidents', 'Fuel km/L', 'Score', 'Grade'].map(h => (
                  <th key={h} className={`px-4 py-3 text-xs font-semibold text-slate-400 ${['Trips','KM','On-time %','Incidents','Fuel km/L','Score'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.driverId} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-sm">
                    <div className="font-medium text-white">{d.name ?? '—'}</div>
                    <div className="text-xs text-slate-300">{d.status ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="font-mono text-white">{d.licenseNumber ?? '—'}</div>
                    <div className="text-xs text-slate-300">{d.licenseType ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-white">{d.totalTrips ?? 0}</td>
                  <td className="px-4 py-3 text-sm text-right text-white">{Math.round(d.totalKm ?? 0).toLocaleString()}</td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${(d.onTimePct ?? 0) >= 90 ? 'text-emerald-400' : (d.onTimePct ?? 0) >= 75 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {(d.onTimePct ?? 0).toFixed(1)}%
                  </td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${(d.incidentCount ?? 0) === 0 ? 'text-emerald-400' : (d.incidentCount ?? 0) <= 2 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {d.incidentCount ?? 0}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-white">{(d.fuelEfficiency ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    {d.score != null
                      ? <span className="text-white font-bold text-base">{d.score.toFixed(1)}</span>
                      : <span className="text-slate-400 text-xs italic">insufficient</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${GRADE_BG[d.grade]}`}>
                      {d.grade}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-5 text-xs text-slate-400 space-y-2">
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
