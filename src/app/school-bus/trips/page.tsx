'use client';
import { useState, useEffect, useCallback } from 'react';

/* ──────────────────────── types ───────────────────────────── */
interface Trip {
  id: string;
  trip_code: string | null;
  route_name: string | null;
  route_code: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  attendant_name: string | null;
  direction: string;
  session: string;
  scheduled_date: string;
  scheduled_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: string;
  students_total: number;
  students_boarded: number;
  students_dropped: number;
  stops_total: number;
  stops_completed: number;
  distance_km: number | null;
  duration_min: number | null;
  avg_speed_kmh: number | null;
  max_speed_kmh: number | null;
  speeding_events: number;
  harsh_braking: number;
  geofence_exits: number;
  notes: string | null;
  event_count: number;
}

interface TripEvent {
  id: string;
  event_type: string;
  event_time: string;
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  stop_name: string | null;
  student_name: string | null;
  students_count: number | null;
  description: string | null;
}

interface TripSummary {
  total: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  breakdown: number;
}

interface ActiveRoute {
  id: string;
  route_name: string;
  route_code: string;
  direction: string;
  session: string;
  departure_time: string | null;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

const TENANTID = 'default';

const STATUS_CFG: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  SCHEDULED:   { color: 'text-slate-400',  bg: 'bg-slate-700/50',  border: 'border-slate-600',     dot: 'bg-slate-500'  },
  IN_PROGRESS: { color: 'text-green-400',  bg: 'bg-green-500/15',  border: 'border-green-500/30',  dot: 'bg-green-400'  },
  COMPLETED:   { color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   dot: 'bg-blue-400'   },
  CANCELLED:   { color: 'text-slate-500',  bg: 'bg-slate-800/60',  border: 'border-slate-700',     dot: 'bg-slate-600'  },
  BREAKDOWN:   { color: 'text-red-400',    bg: 'bg-red-500/15',    border: 'border-red-500/30',    dot: 'bg-red-400'    },
};

const EVENT_CFG: Record<string, { icon: string; color: string }> = {
  DEPARTURE:      { icon: '🚌', color: 'text-green-400'  },
  STOP_ARRIVAL:   { icon: '📍', color: 'text-blue-400'   },
  STOP_DEPARTURE: { icon: '➡️', color: 'text-slate-400'  },
  BOARDING:       { icon: '👧', color: 'text-yellow-400' },
  ALIGHTING:      { icon: '👋', color: 'text-orange-400' },
  GEOFENCE_EXIT:  { icon: '⚠️', color: 'text-amber-400'  },
  SPEEDING:       { icon: '🚨', color: 'text-red-400'    },
  HARSH_BRAKING:  { icon: '🛑', color: 'text-red-400'    },
  INCIDENT:       { icon: '🚑', color: 'text-red-500'    },
  ARRIVAL:        { icon: '🏫', color: 'text-green-400'  },
  BREAKDOWN:      { icon: '🔧', color: 'text-red-400'    },
  CANCELLED:      { icon: '✕',  color: 'text-slate-400'  },
};

const SAFETY_EVENTS = new Set(['SPEEDING','HARSH_BRAKING','GEOFENCE_EXIT','INCIDENT','BREAKDOWN']);

const CANCEL_REASONS = [
  'Vehicle breakdown',
  'Driver not available',
  'Bad weather / flooding',
  'Public holiday / school closure',
  'Low student count',
  'Route safety concern',
  'Mechanical inspection',
  'Other',
];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(min: number | null): string {
  if (!min) return '—';
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

/* ──────────────────────── Toast ────────────────────────────── */
function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-xl transition-all ${
            t.type === 'success' ? 'bg-emerald-950 border-emerald-500/40 text-emerald-300' :
            t.type === 'error'   ? 'bg-red-950 border-red-500/40 text-red-300' :
                                   'bg-slate-800 border-white/10 text-slate-200'
          }`}>
          <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
          <span>{t.message}</span>
          <button onClick={() => onRemove(t.id)} className="ml-2 opacity-60 hover:opacity-100 text-xs">✕</button>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────── Event Timeline ──────────────────── */
function EventTimeline({ tripId }: { tripId: string }) {
  const [events, setEvents] = useState<TripEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/school-bus/trips/${tripId}/events`)
      .then(r => r.json())
      .then(d => setEvents(d.events ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tripId]);

  if (loading) return <div className="py-4 text-center text-slate-500 text-sm">Loading events…</div>;
  if (events.length === 0) return (
    <div className="py-4 text-center text-slate-600 text-sm">No telemetry events recorded yet</div>
  );

  return (
    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
      {events.map((e) => {
        const cfg = EVENT_CFG[e.event_type] ?? { icon: '•', color: 'text-slate-400' };
        const isSafety = SAFETY_EVENTS.has(e.event_type);
        return (
          <div key={e.id} className={`flex items-start gap-3 px-3 py-2 rounded-lg text-xs ${
            isSafety ? 'bg-red-500/5 border border-red-500/10' : 'bg-slate-800/40'
          }`}>
            <span className="text-base leading-none flex-shrink-0 mt-0.5">{cfg.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${cfg.color}`}>{e.event_type.replace(/_/g,' ')}</span>
                {e.stop_name && <span className="text-slate-400">· {e.stop_name}</span>}
                {e.student_name && <span className="text-slate-400">· {e.student_name}</span>}
                {e.speed_kmh !== null && <span className="text-slate-500">{Math.round(e.speed_kmh)} km/h</span>}
              </div>
              {e.description && <p className="text-slate-500 mt-0.5">{e.description}</p>}
            </div>
            <span className="text-slate-600 flex-shrink-0">{fmtTime(e.event_time)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────── TripCard ─────────────────────────── */
function TripCard({
  trip,
  onRefresh,
  onToast,
}: {
  trip: Trip;
  onRefresh: () => void;
  onToast: (msg: string, type: 'success' | 'error') => void;
}) {
  const [expanded, setExpanded]           = useState(false);
  const [acting, setActing]               = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason]   = useState(CANCEL_REASONS[0]);
  const [cancelNotes, setCancelNotes]     = useState('');

  const cfg = STATUS_CFG[trip.status] ?? STATUS_CFG['SCHEDULED'];
  const hasSafetyIssues = trip.speeding_events > 0 || trip.harsh_braking > 0 || trip.geofence_exits > 0;

  const boardingPct = trip.students_total > 0
    ? Math.round((trip.students_boarded / trip.students_total) * 100) : 0;
  const stopsPct = trip.stops_total > 0
    ? Math.round((trip.stops_completed / trip.stops_total) * 100) : 0;

  /* ── action handler ── */
  async function doAction(action: string, extras: Record<string, string> = {}) {
    setActing(true);
    try {
      const res = await fetch(`/api/school-bus/trips/${trip.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, operatorId: 'dispatcher', ...extras }),
      });
      const data = await res.json();
      if (data.ok) {
        onToast(data.message ?? `Trip ${action}ed`, 'success');
        onRefresh();
      } else {
        onToast(data.error ?? 'Action failed', 'error');
      }
    } catch {
      onToast('Network error', 'error');
    } finally {
      setActing(false);
    }
  }

  async function handleCancel() {
    setShowCancelModal(false);
    await doAction('cancel', { reason: cancelReason, notes: cancelNotes });
    setCancelNotes('');
    setCancelReason(CANCEL_REASONS[0]);
  }

  /* ── action buttons based on status ── */
  const actionButtons = (
    <div className="flex gap-2 flex-wrap mt-3 border-t border-white/5 pt-3">
      {trip.status === 'SCHEDULED' && (
        <>
          <button
            onClick={() => doAction('start')}
            disabled={acting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-50 font-medium">
            {acting ? '⏳' : '▶'} Start Trip
          </button>
          <button
            onClick={() => setShowCancelModal(true)}
            disabled={acting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors disabled:opacity-50">
            ✕ Cancel
          </button>
        </>
      )}

      {trip.status === 'IN_PROGRESS' && (
        <>
          <button
            onClick={() => doAction('complete')}
            disabled={acting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-50 font-medium">
            {acting ? '⏳' : '■'} Complete Trip
          </button>
          <button
            onClick={() => doAction('breakdown', { reason: 'Vehicle breakdown reported' })}
            disabled={acting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50">
            🔧 Breakdown
          </button>
          <button
            onClick={() => setShowCancelModal(true)}
            disabled={acting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors disabled:opacity-50">
            ✕ Cancel
          </button>
        </>
      )}

      {(trip.status === 'COMPLETED' || trip.status === 'CANCELLED' || trip.status === 'BREAKDOWN') && (
        <span className="text-xs text-slate-600 italic self-center">
          {trip.status === 'COMPLETED' ? '✓ Trip closed' : trip.status === 'BREAKDOWN' ? '🔧 Breakdown reported' : '✕ Trip cancelled'}
        </span>
      )}
    </div>
  );

  return (
    <>
      {/* Cancel reason modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCancelModal(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-1">Cancel Trip</h3>
            <p className="text-sm text-slate-400 mb-4">
              <span className="font-mono text-xs">{trip.trip_code}</span> · {trip.route_name}
            </p>
            <label className="block text-xs text-slate-400 mb-1">Reason *</label>
            <select
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mb-3 focus:outline-none focus:border-yellow-500/50">
              {CANCEL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <label className="block text-xs text-slate-400 mb-1">Additional notes</label>
            <textarea
              value={cancelNotes}
              onChange={e => setCancelNotes(e.target.value)}
              placeholder="Optional details…"
              rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 mb-4 focus:outline-none focus:border-yellow-500/50 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setShowCancelModal(false)}
                className="flex-1 bg-slate-800 border border-white/10 text-slate-300 text-sm py-2 rounded-lg hover:bg-slate-700 transition-colors">
                Keep Trip
              </button>
              <button onClick={handleCancel}
                className="flex-1 bg-red-500/20 border border-red-500/30 text-red-300 text-sm py-2 rounded-lg hover:bg-red-500/30 transition-colors font-semibold">
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`bg-slate-900 border rounded-xl p-4 transition-all ${cfg.border}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-slate-500">{trip.trip_code}</span>
              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {trip.status.replace('_',' ')}
              </span>
              {hasSafetyIssues && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  ⚠️ Safety flags
                </span>
              )}
            </div>
            {trip.route_name && <p className="text-sm font-semibold text-white mt-1">{trip.route_name}</p>}
            <div className="flex gap-3 text-xs text-slate-400 mt-1 flex-wrap">
              {trip.vehicle_plate  && <span>🚌 {trip.vehicle_plate}</span>}
              {trip.driver_name    && <span>👨‍✈️ {trip.driver_name}</span>}
              {trip.attendant_name && <span>👩 {trip.attendant_name}</span>}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-slate-500">{trip.session} · {trip.direction}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {fmtTime(trip.actual_start || trip.scheduled_start)} → {fmtTime(trip.actual_end)}
            </p>
            {trip.duration_min && <p className="text-xs text-slate-500 mt-0.5">⏱ {fmtDuration(trip.duration_min)}</p>}
          </div>
        </div>

        {/* Progress bars */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">Students boarded</span>
              <span className="text-white">{trip.students_boarded}/{trip.students_total}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-500 rounded-full transition-all" style={{ width: `${boardingPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">Stops completed</span>
              <span className="text-white">{trip.stops_completed}/{trip.stops_total}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${stopsPct}%` }} />
            </div>
          </div>
        </div>

        {/* Metrics row */}
        <div className="flex gap-4 text-xs text-slate-400 border-t border-white/5 pt-3 mb-0">
          {trip.distance_km !== null && <span>📏 {trip.distance_km.toFixed(1)} km</span>}
          {trip.avg_speed_kmh !== null && <span>⚡ avg {Math.round(trip.avg_speed_kmh)} km/h</span>}
          {trip.max_speed_kmh !== null && (
            <span className={trip.max_speed_kmh > 80 ? 'text-red-400' : ''}>
              🏎 max {Math.round(trip.max_speed_kmh)} km/h
            </span>
          )}
          <span className="ml-auto text-slate-600">{trip.event_count} events</span>
        </div>

        {/* Safety flags */}
        {hasSafetyIssues && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {trip.speeding_events > 0 && (
              <span className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                🚨 {trip.speeding_events} speeding
              </span>
            )}
            {trip.harsh_braking > 0 && (
              <span className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                🛑 {trip.harsh_braking} harsh braking
              </span>
            )}
            {trip.geofence_exits > 0 && (
              <span className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                ⚠️ {trip.geofence_exits} geofence exits
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        {actionButtons}

        {/* Expand toggle */}
        <button onClick={() => setExpanded(p => !p)}
          className="w-full text-xs text-slate-500 hover:text-slate-300 flex items-center justify-center gap-1 py-1 mt-2 transition-colors">
          {expanded ? '▲ Hide events' : `▼ Show event log (${trip.event_count})`}
        </button>

        {expanded && (
          <div className="mt-3 border-t border-white/5 pt-3">
            <EventTimeline tripId={trip.id} />
          </div>
        )}
      </div>
    </>
  );
}

/* ──────────────────────── Generate Trips Modal ─────────────── */
function GenerateModal({
  onClose,
  onDone,
  onToast,
}: {
  onClose: () => void;
  onDone: () => void;
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}) {
  const [genDate, setGenDate]         = useState(new Date().toISOString().slice(0, 10));
  const [routes, setRoutes]           = useState<ActiveRoute[]>([]);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [generating, setGenerating]   = useState(false);

  /* Load active routes for selection */
  useEffect(() => {
    fetch(`/api/school-bus/routes?tenantId=${TENANTID}&status=ACTIVE`)
      .then(r => r.json())
      .then(d => {
        const list: ActiveRoute[] = (d.routes ?? []).filter((r: ActiveRoute & { is_active?: boolean }) => r.is_active !== false);
        setRoutes(list);
        // Select all by default
        setSelected(new Set(list.map((r: ActiveRoute) => r.id)));
      })
      .catch(() => {})
      .finally(() => setLoadingRoutes(false));
  }, []);

  function toggleRoute(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === routes.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(routes.map(r => r.id)));
    }
  }

  async function handleGenerate() {
    if (selected.size === 0) {
      onToast('Select at least one route', 'info');
      return;
    }
    setGenerating(true);
    try {
      const body: Record<string, unknown> = {
        date: genDate,
        tenantId: TENANTID,
      };
      // Only pass routeIds if not all routes selected
      if (selected.size < routes.length) {
        body.routeIds = Array.from(selected);
      }
      const res = await fetch('/api/school-bus/trips/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        onToast(`${data.message}`, 'success');
        onDone();
        onClose();
      } else {
        onToast(data.error ?? 'Generation failed', 'error');
      }
    } catch {
      onToast('Network error', 'error');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Modal header */}
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <div>
            <h2 className="text-base font-bold text-white">⚡ Generate Trips</h2>
            <p className="text-xs text-slate-400 mt-0.5">Create trip records from active routes for a specific date</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Date picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Trip Date</label>
            <input
              type="date"
              value={genDate}
              onChange={e => setGenDate(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/50" />
          </div>

          {/* Route selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Routes</label>
              {routes.length > 0 && (
                <button onClick={toggleAll} className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
                  {selected.size === routes.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>

            {loadingRoutes ? (
              <div className="text-sm text-slate-500 py-4 text-center">Loading routes…</div>
            ) : routes.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center bg-slate-800/50 rounded-lg border border-white/5">
                No active routes found. Create and activate routes first.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {routes.map(r => (
                  <label key={r.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      selected.has(r.id) ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-slate-800/50 border border-white/5 hover:border-white/10'
                    }`}>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleRoute(r.id)}
                      className="accent-yellow-400 w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{r.route_name}</p>
                      <p className="text-xs text-slate-500">{r.route_code} · {r.session} · {r.direction}{r.departure_time ? ` · ${r.departure_time}` : ''}</p>
                    </div>
                    {selected.has(r.id) && <span className="text-yellow-400 text-xs">✓</span>}
                  </label>
                ))}
              </div>
            )}

            {routes.length > 0 && (
              <p className="text-xs text-slate-500 mt-2">{selected.size} of {routes.length} routes selected · Existing trips will be skipped (idempotent)</p>
            )}
          </div>
        </div>

        {/* Modal footer */}
        <div className="flex gap-3 p-5 border-t border-white/8">
          <button onClick={onClose} disabled={generating}
            className="flex-1 bg-slate-800 border border-white/10 text-slate-300 text-sm py-2.5 rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleGenerate} disabled={generating || selected.size === 0 || routes.length === 0}
            className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50">
            {generating ? '⏳ Generating…' : `⚡ Generate ${selected.size > 0 ? selected.size : ''} Trip${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────── Page ─────────────────────────────── */
export default function TripsPage() {
  const [trips, setTrips]         = useState<Trip[]>([]);
  const [summary, setSummary]     = useState<TripSummary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [date, setDate]           = useState(new Date().toISOString().slice(0, 10));
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch]       = useState('');
  const [toasts, setToasts]       = useState<Toast[]>([]);
  const [showGenModal, setShowGenModal] = useState(false);

  function addToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }

  function removeToast(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: TENANTID, date });
      if (filterStatus) params.set('status', filterStatus);
      if (search)       params.set('search', search);
      const r = await fetch(`/api/school-bus/trips?${params}`);
      if (r.ok) {
        const d = await r.json();
        setTrips(d.trips ?? []);
        setSummary(d.summary ?? null);
      }
    } catch {} finally { setLoading(false); }
  }, [date, filterStatus, search]);

  useEffect(() => { fetchTrips(); }, [fetchTrips]);

  const counts = summary;

  /* Status colours for filter pills */
  const filterOptions = [
    { val: '',           label: 'All' },
    { val: 'SCHEDULED',  label: 'Scheduled' },
    { val: 'IN_PROGRESS',label: 'In Progress' },
    { val: 'COMPLETED',  label: 'Completed' },
    { val: 'CANCELLED',  label: 'Cancelled' },
    { val: 'BREAKDOWN',  label: 'Breakdown' },
  ];

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {showGenModal && (
        <GenerateModal
          onClose={() => setShowGenModal(false)}
          onDone={fetchTrips}
          onToast={addToast}
        />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">🛤️ Trip Telemetry Logs</h1>
            <p className="text-slate-400 text-sm mt-0.5">Daily trip records · telemetry events · safety incidents · boarding logs</p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/50" />

            <button
              onClick={() => setShowGenModal(true)}
              className="flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold text-sm px-4 py-2 rounded-lg transition-colors">
              ⚡ Generate Trips
            </button>
          </div>
        </div>

        {/* KPIs */}
        {counts && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: 'Total',       val: counts.total,      color: 'text-white',      bg: 'bg-slate-800' },
              { label: 'Scheduled',   val: counts.scheduled,  color: 'text-slate-400',  bg: 'bg-slate-800/60' },
              { label: 'In Progress', val: counts.inProgress, color: 'text-green-400',  bg: 'bg-green-500/10' },
              { label: 'Completed',   val: counts.completed,  color: 'text-blue-400',   bg: 'bg-blue-500/10' },
              { label: 'Cancelled',   val: counts.cancelled,  color: 'text-slate-500',  bg: 'bg-slate-800/40' },
              { label: 'Breakdown',   val: counts.breakdown,  color: 'text-red-400',    bg: 'bg-red-500/10' },
            ].map(k => (
              <div key={k.label} className={`${k.bg} border border-white/5 rounded-xl p-3 text-center cursor-pointer hover:border-white/10 transition-colors`}
                onClick={() => setFilterStatus(k.label === 'Total' ? '' : k.label === 'In Progress' ? 'IN_PROGRESS' : k.label.toUpperCase())}>
                <p className={`text-2xl font-bold ${k.color}`}>{k.val}</p>
                <p className="text-xs text-slate-500">{k.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Alerts */}
        {counts && counts.breakdown > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-3">
            <span className="text-2xl">🔧</span>
            <p className="text-red-400 font-semibold">{counts.breakdown} vehicle breakdown{counts.breakdown > 1 ? 's' : ''} today — check trip logs below</p>
          </div>
        )}
        {counts && counts.inProgress > 0 && (
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3 flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5 ml-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <p className="text-green-400 text-sm">{counts.inProgress} trip{counts.inProgress > 1 ? 's' : ''} currently in progress</p>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search route, driver, vehicle…"
            className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 w-56" />
          <div className="flex gap-1 flex-wrap">
            {filterOptions.map(o => (
              <button key={o.val} onClick={() => setFilterStatus(o.val)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  filterStatus === o.val ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-slate-900 text-slate-400 border-white/10 hover:border-white/20'
                }`}>{o.label}</button>
            ))}
          </div>
          <button onClick={fetchTrips} className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition-colors">↻ Refresh</button>
        </div>

        {/* Telemetry event legend */}
        <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Telemetry Event Types</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(EVENT_CFG).map(([k, v]) => (
              <span key={k} className={`text-xs ${v.color} flex items-center gap-1`}>
                <span>{v.icon}</span>{k.replace(/_/g,' ')}
              </span>
            ))}
          </div>
        </div>

        {/* Trip list */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 bg-slate-900 rounded-xl animate-pulse border border-white/5" />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-16 text-center">
            <p className="text-4xl mb-4">🛤️</p>
            <p className="text-slate-300 font-semibold mb-1">No trips for {date}</p>
            <p className="text-slate-500 text-sm mb-6">
              Generate trips from your active routes, or seed demo data to explore the module.
            </p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setShowGenModal(true)}
                className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold px-6 py-2 rounded-xl text-sm transition-colors">
                ⚡ Generate Trips
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {trips.map(t => (
              <TripCard
                key={t.id}
                trip={t}
                onRefresh={fetchTrips}
                onToast={addToast}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
