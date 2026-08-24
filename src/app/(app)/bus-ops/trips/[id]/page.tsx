'use client';
/**
 * /bus-ops/trips/[id] — ops trip detail + attendance
 *
 * Shows one specific TripSchedule with its passengers and lets ops
 * mark BOARDED / ABSENT / ALIGHTED per row without leaving the page.
 * All status writes go through PATCH /api/bus-ops/passengers/[id],
 * which enforces the passenger state-machine (illegal transitions
 * return 409 with the allowed next states).
 *
 * Reached from the Trip Monitor board or a link on the Schedules page.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';

type PassengerStatus = 'CONFIRMED' | 'BOARDED' | 'ALIGHTED' | 'ABSENT' | 'NO_SHOW' | 'CANCELLED' | 'WAITLISTED';
type TripStatus = 'SCHEDULED' | 'DEPARTED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

interface Passenger {
  id: string;
  employeeId: string | null;
  employeeName: string | null;
  boardingStopName: string | null;
  alightingStopName: string | null;
  boardedAt: string | null;
  status: PassengerStatus | null;
}
interface Trip {
  id: string;
  tripNumber: string | null;
  status: TripStatus | null;
  departureTime: string;
  arrivalTime: string | null;
  confirmedCount: number | null;
  capacity: number | null;
  shiftType: string | null;
  direction: string | null;
  route: { id: string; name: string; origin: string; destination: string } | null;
  passengers: Passenger[];
}

// Palettes come from src/lib/bus-ops/status-meta.ts so every bus-ops UI
// renders the same status with the same colour.
import { TRIP_STATUS_META, PASSENGER_STATUS_META, pillClass } from '@/lib/bus-ops/status-meta';
import { allowedPassengerTransitions } from '@/lib/bus-ops/state-machines';
const PAX_PILL  = Object.fromEntries(Object.entries(PASSENGER_STATUS_META).map(([k, v]) => [k, pillClass(v)])) as Record<PassengerStatus, string>;
const TRIP_PILL = Object.fromEntries(Object.entries(TRIP_STATUS_META).map(([k, v]) => [k, pillClass(v)])) as Record<TripStatus, string>;

// Allowed passenger status advances the ops UI surfaces per current status.
//
// Derived from the state machine rather than hand-maintained. This used
// to be a second copy of the transition table, which meant a rules change
// in state-machines.ts left this screen silently enforcing the old ones —
// it still listed ABSENT as terminal after ABSENT → BOARDED was allowed,
// so the button to re-board a rider who caught the bus at a later stop
// simply never rendered.
//
// NO_SHOW is filtered out because it isn't an ops-floor action here: it's
// set by schedules/[id]/depart when the trip leaves without the rider.
const nextActionsFor = (s: PassengerStatus): PassengerStatus[] =>
  allowedPassengerTransitions(s).filter(t => t !== 'NO_SHOW') as PassengerStatus[];

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const tripId = params?.id;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!tripId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/bus-ops/schedules/${tripId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTrip(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trip');
    } finally { setLoading(false); }
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  const markPassenger = async (passengerId: string, nextStatus: PassengerStatus) => {
    setRowBusy(passengerId); setError('');
    try {
      const res = await fetch(`/api/bus-ops/passengers/${passengerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // 409 → state-machine rejection with a helpful message
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mark failed');
    } finally { setRowBusy(null); }
  };

  const counts = useMemo(() => {
    const c = { CONFIRMED: 0, BOARDED: 0, ALIGHTED: 0, ABSENT: 0, NO_SHOW: 0, WAITLISTED: 0, CANCELLED: 0 } as Record<PassengerStatus, number>;
    trip?.passengers.forEach(p => { if (p.status) c[p.status]++; });
    return c;
  }, [trip]);

  const passengerColumns: DataGridColumn<Passenger>[] = [
    { key: 'employeeId', header: 'Emp ID', accessor: p => p.employeeId,
      render: p => <span className="font-mono text-white">{p.employeeId ?? '—'}</span> },
    { key: 'employeeName', header: 'Employee', accessor: p => p.employeeName,
      render: p => <span className="text-white">{p.employeeName ?? '—'}</span> },
    { key: 'boardingStopName', header: 'Pickup', accessor: p => p.boardingStopName },
    { key: 'alightingStopName', header: 'Drop-off', accessor: p => p.alightingStopName },
    { key: 'status', header: 'Status', accessor: p => p.status ?? 'CONFIRMED', filter: 'select',
      render: p => {
        const status = (p.status ?? 'CONFIRMED') as PassengerStatus;
        return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${PAX_PILL[status]}`}>{status}</span>;
      } },
    { key: 'boardedAt', header: 'Boarded at', accessor: p => p.boardedAt,
      render: p => (
        <span className="text-xs text-slate-400 whitespace-nowrap">
          {p.boardedAt ? new Date(p.boardedAt).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
      ) },
    { key: 'rowActions', header: 'Actions', align: 'right', filter: false, sortable: false,
      render: p => {
        const status = (p.status ?? 'CONFIRMED') as PassengerStatus;
        const actions = nextActionsFor(status);
        return actions.length === 0 ? (
          <span className="text-[10px] text-slate-500 italic">terminal</span>
        ) : (
          <div className="flex gap-1 justify-end">
            {actions.map(nxt => (
              <button key={nxt} onClick={() => markPassenger(p.id, nxt)} disabled={rowBusy === p.id}
                className={`text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                  nxt === 'BOARDED'  ? 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20'  :
                  nxt === 'ABSENT'   ? 'border-rose-500/40    text-rose-200    bg-rose-500/10    hover:bg-rose-500/20'    :
                  nxt === 'ALIGHTED' ? 'border-cyan-500/40    text-cyan-200    bg-cyan-500/10    hover:bg-cyan-500/20'    :
                  'border-slate-500/40 text-slate-200 bg-slate-500/10 hover:bg-slate-500/20'
                }`}>
                {rowBusy === p.id ? '…' : nxt}
              </button>
            ))}
          </div>
        );
      } },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={trip?.tripNumber ? `Trip ${trip.tripNumber}` : 'Trip Detail'}
        subtitle={
          trip
            ? `${trip.route?.name ?? '—'} · ${new Date(trip.departureTime).toLocaleString('en-AE')}${trip.shiftType ? ` · ${trip.shiftType}` : ''}${trip.direction ? ` · ${trip.direction}` : ''}`
            : 'Loading…'
        }
        icon={Users}
        accent="violet"
        actions={
          <>
            <Link href="/bus-ops/dispatch"
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-violet-500/40">
              <ArrowLeft className="w-4 h-4" /> Trip Monitor
            </Link>
            <button onClick={load}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-violet-500/40">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm">{error}</div>}

      {loading && !trip ? (
        <div className="text-slate-400 text-sm animate-pulse py-10 text-center">Loading trip…</div>
      ) : !trip ? (
        <div className="text-slate-400 text-sm py-10 text-center">Trip not found.</div>
      ) : (
        <>
          {/* Status + KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="col-span-2 md:col-span-1 bg-slate-800/60 border border-white/5 rounded-xl p-3">
              <p className="text-xs text-slate-500 mb-1">Trip status</p>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${TRIP_PILL[(trip.status ?? 'SCHEDULED') as TripStatus]}`}>
                {trip.status ?? 'SCHEDULED'}
              </span>
            </div>
            {(['CONFIRMED','BOARDED','ALIGHTED','ABSENT','WAITLISTED'] as PassengerStatus[]).map(s => (
              <div key={s} className="bg-slate-800/60 border border-white/5 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-white">{counts[s]}</p>
                <p className="text-[10px] text-slate-500 uppercase mt-0.5">{s}</p>
              </div>
            ))}
          </div>

          {/* Passenger manifest */}
          <div>
            <div className="px-1 pb-2 text-sm text-slate-300">
              Passenger manifest ({trip.passengers.length})
              {trip.capacity != null && <span className="text-slate-500"> of {trip.capacity}</span>}
            </div>
            <FleetDataGrid
              gridName="PassengerManifest"
              rows={trip.passengers}
              getRowId={p => p.id}
              loading={false}
              emptyMessage="No passengers on this trip yet. Roster expansion runs on trip create — check the Passengers page for the route roster."
              columns={passengerColumns}
              numbered
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              toolbar={{
                exportName: 'passenger-manifest',
                title: 'Passenger Manifest',
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
        </>
      )}
    </div>
  );
}
