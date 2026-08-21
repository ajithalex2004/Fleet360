'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Trophy, RotateCw } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';
import { usePollingRefresh } from '@/hooks/usePollingRefresh';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';

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

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
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

  usePollingRefresh(load, {
    intervalMs: 60_000,
  });
  // Push updates (SSE default; WebSocket if NEXT_PUBLIC_REALTIME_WS_URL is set)
  useRealtimeChannel(
    ['bus-ops:drivers'],
    () => { void load({ silent: true }); },
    { enabled: true },
  );


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


  const driverColumns: DataGridColumn<PerfRow>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Driver',
      accessor: (d) => d.name ?? '',
      render: (d) => (
        <div>
          <div className="font-medium text-white">{d.name ?? '—'}</div>
          <div className="text-xs text-slate-400">{d.status ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'license',
      header: 'License',
      accessor: (d) => d.licenseNumber ?? '',
      render: (d) => (
        <div>
          <div className="font-mono text-white">{d.licenseNumber ?? '—'}</div>
          <div className="text-xs text-slate-400">{d.licenseType ?? ''}</div>
        </div>
      ),
    },
    { key: 'trips', header: 'Trips', accessor: (d) => d.totalTrips ?? 0, align: 'right' },
    {
      key: 'km',
      header: 'KM',
      accessor: (d) => d.totalKm ?? 0,
      align: 'right',
      render: (d) => Math.round(d.totalKm ?? 0).toLocaleString(),
    },
    {
      key: 'ontime',
      header: 'On-time %',
      accessor: (d) => d.onTimePct ?? 0,
      align: 'right',
      render: (d) => (
        <span className={(d.onTimePct ?? 0) >= 90 ? 'text-emerald-400' : (d.onTimePct ?? 0) >= 75 ? 'text-amber-400' : 'text-rose-400'}>
          {(d.onTimePct ?? 0).toFixed(1)}%
        </span>
      ),
    },
    { key: 'incidents', header: 'Incidents', accessor: (d) => d.incidentCount ?? 0, align: 'right' },
    {
      key: 'fuel',
      header: 'Fuel km/L',
      accessor: (d) => d.fuelEfficiency ?? 0,
      align: 'right',
      render: (d) => (d.fuelEfficiency ?? 0).toFixed(2),
    },
    {
      key: 'score',
      header: 'Score',
      accessor: (d) => d.score ?? -1,
      align: 'right',
      render: (d) =>
        d.score != null ? (
          <span className="font-bold text-white">{d.score.toFixed(1)}</span>
        ) : (
          <span className="text-xs italic text-slate-500">insufficient</span>
        ),
    },
    {
      key: 'grade',
      header: 'Grade',
      accessor: (d) => d.grade,
      filter: 'select',
      render: (d) => (
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border ${GRADE_BG[d.grade] ?? ''}`}>
          {d.grade}
        </span>
      ),
    },
  ], []);


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
          
      <FleetDataGrid
        gridName="BusOpsDriversGrid"
        rows={drivers}
        getRowId={(r) => r.driverId}
        loading={loading}
        emptyMessage="No driver performance data for this period"
        columns={driverColumns}
        toolbar={{ exportName: 'bus-ops-drivers', title: 'BusOpsDriversGrid' }}
        initialSort={{ key: 'score', dir: 'desc' }}
      />

        )}
      </div>

    </div>
  );
}
