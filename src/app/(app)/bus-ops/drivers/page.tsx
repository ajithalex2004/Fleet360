'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Trophy, RotateCw } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';

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

const perfColumns: DataGridColumn<PerfRow>[] = [
  {
    key: 'driver', header: 'Driver', accessor: d => d.name,
    render: d => (
      <div>
        <div className="font-medium text-white">{d.name ?? '—'}</div>
        <div className="text-xs text-slate-300">{d.status ?? '—'}</div>
      </div>
    ),
  },
  {
    key: 'licence', header: 'Licence', accessor: d => d.licenseNumber,
    render: d => (
      <div>
        <div className="font-mono text-white">{d.licenseNumber ?? '—'}</div>
        <div className="text-xs text-slate-300">{d.licenseType ?? ''}</div>
      </div>
    ),
  },
  { key: 'totalTrips', header: 'Trips', accessor: d => d.totalTrips, align: 'right',
    render: d => <span className="text-white">{d.totalTrips ?? 0}</span> },
  { key: 'totalKm', header: 'KM', accessor: d => d.totalKm, align: 'right',
    render: d => <span className="text-white">{Math.round(d.totalKm ?? 0).toLocaleString()}</span> },
  { key: 'onTimePct', header: 'On-time %', accessor: d => d.onTimePct, align: 'right',
    render: d => (
      <span className={`font-medium ${(d.onTimePct ?? 0) >= 90 ? 'text-emerald-400' : (d.onTimePct ?? 0) >= 75 ? 'text-amber-400' : 'text-rose-400'}`}>
        {(d.onTimePct ?? 0).toFixed(1)}%
      </span>
    ) },
  { key: 'incidentCount', header: 'Incidents', accessor: d => d.incidentCount, align: 'right',
    render: d => (
      <span className={`font-medium ${(d.incidentCount ?? 0) === 0 ? 'text-emerald-400' : (d.incidentCount ?? 0) <= 2 ? 'text-amber-400' : 'text-rose-400'}`}>
        {d.incidentCount ?? 0}
      </span>
    ) },
  { key: 'fuelEfficiency', header: 'Fuel km/L', accessor: d => d.fuelEfficiency, align: 'right',
    render: d => <span className="text-white">{(d.fuelEfficiency ?? 0).toFixed(2)}</span> },
  { key: 'score', header: 'Score', accessor: d => d.score, align: 'right',
    render: d => d.score != null
      ? <span className="text-white font-bold text-base">{d.score.toFixed(1)}</span>
      : <span className="text-slate-400 text-xs italic">insufficient</span> },
  { key: 'grade', header: 'Grade', accessor: d => d.grade, filter: 'select',
    render: d => (
      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${GRADE_BG[d.grade]}`}>
        {d.grade}
      </span>
    ) },
];

export default function DriverPerformancePage() {
  const [month, setMonth] = useState(() => currentMonthArg());
  const [data, setData] = useState<PerfResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

      <FleetDataGrid
        gridName="DriverPerformance"
        rows={drivers}
        getRowId={d => d.driverId}
        loading={false}
        emptyMessage={`No performance data for ${month}. Tap Recompute to run the scoring engine.`}
        columns={perfColumns}
        numbered
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        toolbar={{
          exportName: 'driver-performance',
          title: 'Driver Performance',
          actions: selectedIds.size > 0 ? (
            <span className="inline-flex items-center gap-2 text-xs text-violet-300">
              {selectedIds.size} selected
              <button type="button" onClick={() => setSelectedIds(new Set())}
                className="text-slate-400 hover:text-white underline underline-offset-2">
                Clear
              </button>
            </span>
          ) : undefined,
        }}
      />
    </div>
  );
}
