'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RouteStop { id: string; stopName: string; sequence: number; estimatedArrivalMins: number | null; }
interface Route { id: string; name: string; origin: string; destination: string; totalDistanceKm: number | null; estimatedDurationMins: number | null; stops?: RouteStop[]; }
interface Passenger { id: string; employeeName: string | null; boardingStopName: string | null; alightingStopName: string | null; status: string | null; }
interface TripLog { id: string; actualDepartureTime: string | null; actualArrivalTime: string | null; passengersBoarded: number | null; }

interface Schedule {
  id: string;
  tripNumber: string | null;
  routeId: string;
  route: Route | null;
  vehicleId: string | null;
  vehicle?: { id: string; plateNumber?: string; registrationNo?: string; make?: string; model?: string } | null;
  driverId: string | null;
  driver?: { id: string; firstName: string; lastName: string; phone?: string } | null;
  departureTime: string;
  arrivalTime: string | null;
  shiftType: string | null;
  direction: string | null;
  capacity: number | null;
  confirmedCount: number | null;
  status: string | null;
  notes: string | null;
  passengers: Passenger[];
  tripLogs: TripLog[];
}

// ── Stage config ──────────────────────────────────────────────────────────────

const STAGES = [
  { status: 'SCHEDULED',  label: 'Scheduled',   icon: '📅', color: 'text-blue-400',    bg: 'bg-blue-500/5',   headerBg: 'bg-blue-500/10 border-blue-500/20',   nextStatus: 'DEPARTED',   nextLabel: 'Depart' },
  { status: 'DEPARTED',   label: 'Departed',    icon: '🚌', color: 'text-amber-400',   bg: 'bg-amber-500/5',  headerBg: 'bg-amber-500/10 border-amber-500/20',  nextStatus: 'IN_TRANSIT', nextLabel: 'In Transit' },
  { status: 'IN_TRANSIT', label: 'In Transit',  icon: '🛣️', color: 'text-orange-400',  bg: 'bg-orange-500/5', headerBg: 'bg-orange-500/10 border-orange-500/20', nextStatus: 'COMPLETED',  nextLabel: 'Complete' },
  { status: 'COMPLETED',  label: 'Completed',   icon: '✅', color: 'text-emerald-400', bg: 'bg-emerald-500/5',headerBg: 'bg-emerald-500/10 border-emerald-500/20',nextStatus: undefined,    nextLabel: undefined },
  { status: 'CANCELLED',  label: 'Cancelled',   icon: '❌', color: 'text-red-400',     bg: 'bg-red-500/5',    headerBg: 'bg-red-500/10 border-red-500/20',      nextStatus: undefined,    nextLabel: undefined },
];

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.status, s]));

// ── Notification helper ───────────────────────────────────────────────────────

async function notifyPassengers(schedule: Schedule, newStatus: string) {
  const messages: Record<string, string> = {
    DEPARTED:   `🚌 Your bus (Trip ${schedule.tripNumber ?? schedule.id.slice(0, 6)}) has departed from ${schedule.route?.origin ?? 'the origin'}. Expected arrival: ${schedule.arrivalTime ? new Date(schedule.arrivalTime).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' }) : 'TBD'}.`,
    IN_TRANSIT: `🛣️ Bus ${schedule.tripNumber ?? ''} is now in transit on route ${schedule.route?.name ?? ''}.`,
    COMPLETED:  `✅ Your transport trip ${schedule.tripNumber ?? ''} has been completed. Have a great day!`,
    CANCELLED:  `❌ Trip ${schedule.tripNumber ?? ''} has been cancelled. Please arrange alternative transport.`,
  };
  const msg = messages[newStatus];
  if (!msg) return;

  // Fire WhatsApp to all passengers with phones
  // (Best-effort — no blocking)
  for (const p of schedule.passengers ?? []) {
    if (p.status === 'CONFIRMED' || p.status === 'BOARDED') {
      // In production, look up staff member phone. Here we just log.
      console.log(`[Dispatch] Would notify ${p.employeeName}: ${msg}`);
    }
  }
}

// ── AssignModal ───────────────────────────────────────────────────────────────

function AssignModal({ schedule, onClose, onDone }: {
  schedule: Schedule;
  onClose: () => void;
  onDone: () => void;
}) {
  const [vehicles, setVehicles] = useState<Array<{ id: string; plateNumber?: string; registrationNo?: string; make?: string; model?: string }>>([]);
  const [drivers,  setDrivers]  = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const [vehicleId, setVehicleId] = useState(schedule.vehicleId ?? '');
  const [driverId,  setDriverId]  = useState(schedule.driverId  ?? '');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/vehicles?usage=STAFF&status=AVAILABLE').then(r => r.ok ? r.json() : []),
      fetch('/api/drivers?assignmentType=STAFF').then(r => r.ok ? r.json() : []),
    ]).then(([v, d]) => {
      setVehicles(Array.isArray(v) ? v : v.data ?? []);
      setDrivers(Array.isArray(d)  ? d : d.data ?? []);
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/bus-ops/schedules/${schedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: vehicleId || null,
          driverId:  driverId  || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  const vehicleName = (v: typeof vehicles[0]) =>
    [v.plateNumber ?? v.registrationNo, v.make, v.model].filter(Boolean).join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-sm">
        <div className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-white">Assign Vehicle & Driver</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-400">{schedule.route?.name ?? '—'} · {new Date(schedule.departureTime).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Vehicle</label>
              <select value={vehicleId} onChange={e => setVehicleId(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/40">
                <option value="">-- Select vehicle --</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{vehicleName(v)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1.5">Driver</label>
              <select value={driverId} onChange={e => setDriverId(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/40">
                <option value="">-- Select driver --</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button onClick={save} disabled={saving}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
            {saving ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Trip card ─────────────────────────────────────────────────────────────────

function TripCard({ schedule, onTransition, onAssign, isMoving }: {
  schedule: Schedule;
  onTransition: (id: string, status: string) => void;
  onAssign: (s: Schedule) => void;
  isMoving: boolean;
}) {
  const stage     = STAGE_MAP[schedule.status ?? 'SCHEDULED'];
  const occupied  = schedule.confirmedCount ?? schedule.passengers.filter(p => p.status !== 'ABSENT').length;
  const cap       = schedule.capacity ?? 30;
  const fillPct   = cap > 0 ? Math.round((occupied / cap) * 100) : 0;

  const depTime   = new Date(schedule.departureTime);
  const isLate    = schedule.status === 'SCHEDULED' && depTime < new Date();

  return (
    <div className={`rounded-xl border p-3 space-y-2.5 ${stage.bg} border-white/5`}>
      {/* Trip number + shift */}
      <div className="flex items-start justify-between gap-1.5">
        <div>
          <p className="font-mono text-xs font-bold text-white">{schedule.tripNumber ?? schedule.id.slice(0, 8)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{schedule.route?.name ?? '—'}</p>
        </div>
        <div className="text-right flex-shrink-0">
          {schedule.shiftType && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              schedule.shiftType === 'MORNING' ? 'bg-amber-500/20 text-amber-400'
              : schedule.shiftType === 'EVENING' ? 'bg-indigo-500/20 text-indigo-400'
              : 'bg-slate-500/20 text-slate-400'
            }`}>{schedule.shiftType}</span>
          )}
          {isLate && schedule.status === 'SCHEDULED' && (
            <p className="text-xs text-red-400 mt-0.5">⚠️ Overdue</p>
          )}
        </div>
      </div>

      {/* Route */}
      <div className="text-xs text-slate-500 leading-relaxed">
        <p className="text-emerald-400 truncate">↑ {schedule.route?.origin ?? '—'}</p>
        <p className="text-red-400 truncate">↓ {schedule.route?.destination ?? '—'}</p>
      </div>

      {/* Vehicle + driver */}
      {(schedule.vehicle || schedule.driver) && (
        <div className="text-xs space-y-0.5">
          {schedule.vehicle && <p className="text-amber-400">🚌 {schedule.vehicle.plateNumber ?? schedule.vehicle.registrationNo}</p>}
          {schedule.driver  && <p className="text-blue-400">👤 {schedule.driver.firstName} {schedule.driver.lastName}</p>}
        </div>
      )}

      {/* Departure time */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {depTime.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
          {schedule.arrivalTime && (
            <span className="text-slate-700"> → {new Date(schedule.arrivalTime).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </span>
        <span className={`${fillPct >= 90 ? 'text-red-400' : fillPct >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>
          👥 {occupied}/{cap}
        </span>
      </div>

      {/* Passenger fill bar */}
      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${fillPct >= 90 ? 'bg-red-500' : fillPct >= 70 ? 'bg-amber-500' : 'bg-purple-500'}`}
          style={{ width: `${fillPct}%` }} />
      </div>

      {/* Actions */}
      <div className="flex gap-1.5">
        {!schedule.vehicleId && schedule.status === 'SCHEDULED' && (
          <button onClick={() => onAssign(schedule)}
            className="flex-1 text-xs border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 py-1.5 rounded-lg font-medium transition-colors">
            🔑 Assign
          </button>
        )}
        {stage.nextStatus && (
          <button disabled={isMoving}
            onClick={() => onTransition(schedule.id, stage.nextStatus!)}
            className={`flex-1 text-xs border rounded-lg py-1.5 font-medium transition-colors disabled:opacity-40 ${stage.headerBg} ${stage.color} hover:brightness-125`}>
            {stage.icon} {stage.nextLabel}
          </button>
        )}
        {schedule.status !== 'CANCELLED' && schedule.status !== 'COMPLETED' && (
          <button disabled={isMoving}
            onClick={() => onTransition(schedule.id, 'CANCELLED')}
            className="text-xs text-slate-600 hover:text-red-400 px-1.5 transition-colors">✕</button>
        )}
        <Link href={`/bus-ops/schedules`}
          className="text-xs text-slate-600 hover:text-slate-400 px-1.5 transition-colors" title="View details">⏱</Link>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BusOpsDispatchPage() {
  const [schedules,   setSchedules]   = useState<Schedule[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<Schedule | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [dateFilter,  setDateFilter]  = useState(() => new Date().toISOString().split('T')[0]);
  const [shiftFilter, setShiftFilter] = useState('ALL');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ date: dateFilter, limit: '200' });
      const res = await fetch(`/api/bus-ops/schedules?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setSchedules(Array.isArray(data) ? data : data.data ?? []);
        setLastRefresh(new Date());
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [dateFilter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const handleTransition = async (id: string, status: string) => {
    setTransitioning(id);
    try {
      const res = await fetch(`/api/bus-ops/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const schedule = schedules.find(s => s.id === id);
        if (schedule) await notifyPassengers(schedule, status);
      }
      await load();
    } catch { /* silent */ }
    finally { setTransitioning(null); }
  };

  // Filter by shift
  const displayed = schedules.filter(s => {
    if (shiftFilter === 'ALL') return true;
    return s.shiftType === shiftFilter;
  });

  // Build stage columns
  const visibleStages = STAGES.filter(s => s.status !== 'CANCELLED');
  const cols = visibleStages.map(stage => ({
    ...stage,
    items: displayed.filter(s => (s.status ?? 'SCHEDULED') === stage.status),
  }));
  const cancelledCount = displayed.filter(s => s.status === 'CANCELLED').length;

  // KPIs
  const inTransit    = schedules.filter(s => ['DEPARTED','IN_TRANSIT'].includes(s.status ?? '')).length;
  const completed    = schedules.filter(s => s.status === 'COMPLETED').length;
  const totalPax     = schedules.reduce((s, t) => s + (t.confirmedCount ?? 0), 0);
  const unassigned   = schedules.filter(s => s.status === 'SCHEDULED' && !s.vehicleId).length;

  return (
    <>
      {assignTarget && (
        <AssignModal schedule={assignTarget} onClose={() => setAssignTarget(null)} onDone={() => { setAssignTarget(null); load(); }} />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Staff Transport Dispatch</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {schedules.length} trips · {totalPax} passengers · Refreshed {lastRefresh.toLocaleTimeString()}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {inTransit > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full animate-pulse">
                🚌 {inTransit} In Transit
              </div>
            )}
            {unassigned > 0 && (
              <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-full">
                ⚠️ {unassigned} Unassigned
              </div>
            )}
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500/40" />
            <button onClick={load}
              className="text-xs text-slate-400 border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/20 hover:text-white transition-colors">
              ↺ Refresh
            </button>
            <Link href="/bus-ops/schedules"
              className="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
              ➕ New Trip
            </Link>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Scheduled',  value: schedules.filter(s => s.status === 'SCHEDULED').length, color: 'text-blue-400' },
            { label: 'In Transit', value: inTransit,  color: 'text-amber-400' },
            { label: 'Completed',  value: completed,   color: 'text-emerald-400' },
            { label: 'Passengers', value: totalPax,    color: 'text-purple-400' },
          ].map(k => (
            <div key={k.label} className="bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-center">
              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Shift filter */}
        <div className="flex gap-2 flex-wrap">
          {['ALL','MORNING','EVENING','NIGHT','SPLIT'].map(s => (
            <button key={s} onClick={() => setShiftFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                shiftFilter === s
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                  : 'text-slate-400 border-white/10 hover:border-white/20 hover:text-white'
              }`}>
              {s === 'ALL' ? 'All Shifts' : s}
              {s !== 'ALL' && <span className="ml-1.5 opacity-60">{displayed.filter(d => d.shiftType === s).length}</span>}
            </button>
          ))}
          {cancelledCount > 0 && (
            <span className="ml-auto text-xs text-red-400 opacity-60">{cancelledCount} cancelled</span>
          )}
        </div>

        {/* Kanban */}
        {loading ? (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex-shrink-0 w-52 space-y-3">
                <div className="h-8 bg-slate-800/60 rounded-xl animate-pulse" />
                {[...Array(2)].map((__, j) => <div key={j} className="h-32 bg-slate-800/60 rounded-xl animate-pulse" />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4" style={{ minWidth: `${visibleStages.length * 220}px` }}>
            {cols.map(col => (
              <div key={col.status} className="flex-shrink-0 w-52 space-y-3">
                {/* Column header */}
                <div className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${col.headerBg}`}>
                  <span className={`text-xs font-semibold ${col.color}`}>{col.icon} {col.label}</span>
                  <span className={`text-xs font-bold ${col.color} opacity-80`}>{col.items.length}</span>
                </div>
                {/* Cards */}
                <div className="space-y-2.5">
                  {col.items.length === 0 ? (
                    <div className="h-16 border border-dashed border-white/10 rounded-xl flex items-center justify-center">
                      <span className="text-xs text-slate-700">No trips</span>
                    </div>
                  ) : (
                    col.items.map(s => (
                      <TripCard key={s.id} schedule={s}
                        onTransition={handleTransition}
                        onAssign={setAssignTarget}
                        isMoving={transitioning === s.id}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-slate-600 border-t border-white/5 pt-3 flex-wrap">
          <span className="font-medium text-slate-500">Tip:</span>
          <span>Click stage buttons to advance trip status</span>
          <span>·</span>
          <span>🔑 Assign vehicle and driver before departure</span>
          <span>·</span>
          <span>Auto-refreshes every 30s</span>
        </div>
      </div>
    </>
  );
}
