'use client';
/**
 * School Bus — Routes Management
 * Enhanced with:
 *  - Route Code field
 *  - Status (Active / Inactive) toggle
 *  - Dropdown selects for Vehicle, Driver, Nanny (populated from API)
 *  - Reassignment panel in edit mode (separate from initial assignment)
 *  - Capacity Guard, Stop Sequence Engine, UAE compliance checks
 */
import { useState, useEffect, useCallback } from 'react';

/* ─────────────────────── types ─────────────────────────── */
interface StopStep {
  stopId?:      string;
  stopCode?:    string;
  stopName:     string;
  sequence:     number;
  pickupTime?:  string;
  dropoffTime?: string;
}

interface BusRoute {
  id: string;
  route_name: string;
  route_code?: string;
  direction: string;
  session: string;
  route_type: string;
  departure_time: string;
  arrival_time?: string;
  assigned_vehicle_id?: string;
  assigned_driver_id?: string;
  assigned_attendant_id?: string;
  seat_capacity: number;
  student_count: number;
  stop_sequence: StopStep[];
  is_active: boolean;
  status: string;
  // joined columns
  vehicle_reg?: string;
  vehicle_type?: string;
  vehicle_capacity?: number;
  driver_name?: string;
}

interface CapRoute {
  routeId: string;
  enrolledStudents: number;
  seatCapacity: number;
  utilisationPct: number;
  capacityStatus: 'OK' | 'WARNING' | 'OVERLOAD';
  complianceStatus: 'OK' | 'NO_ATTENDANT';
  availableSeats: number;
  hasAttendant: boolean;
}

interface VehicleOption { id: string; reg: string; type: string; capacity: number; status: string; make?: string; model?: string }
interface DriverOption   { id: string; full_name: string; phone: string; licence: string; employee_id: string }
interface AttendantOption{ id: string; full_name: string; employee_id: string; phone: string; current_route: string }

interface DropdownOptions {
  vehicles:   VehicleOption[];
  drivers:    DriverOption[];
  attendants: AttendantOption[];
}

/* ─────────────────────── constants ─────────────────────── */
const SESSION_COLOR: Record<string, string> = {
  MORNING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  AFTERNOON: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  BOTH:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
};
const CAP_CFG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  OK:       { color:'text-emerald-400', bg:'bg-emerald-500/20', border:'border-emerald-500/30', label:'OK' },
  WARNING:  { color:'text-amber-400',   bg:'bg-amber-500/20',   border:'border-amber-500/40',   label:'NEAR FULL' },
  OVERLOAD: { color:'text-red-400',     bg:'bg-red-500/20',     border:'border-red-500/40',     label:'OVERLOAD' },
};

/* ─────────────────────── sub-components ─────────────────── */
function CapacityBar({ cap }: { cap?: CapRoute }) {
  if (!cap) return <p className="text-xs text-slate-600">No data</p>;
  const cfg = CAP_CFG[cap.capacityStatus];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className={cfg.color}>{cap.enrolledStudents}/{cap.seatCapacity} seats</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
          {cfg.label}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-1.5 rounded-full transition-all ${
          cap.capacityStatus === 'OVERLOAD' ? 'bg-red-500' :
          cap.capacityStatus === 'WARNING'  ? 'bg-amber-400' : 'bg-emerald-500'
        }`} style={{ width: `${Math.min(100, cap.utilisationPct)}%` }} />
      </div>
      {!cap.hasAttendant && (
        <p className="text-red-400 text-[10px] font-semibold">⚠️ No attendant assigned</p>
      )}
    </div>
  );
}

/* ─────────────────────── RouteModal ─────────────────────── */
function RouteModal({ route, options, onClose, onSaved }: {
  route?: BusRoute | null;
  options: DropdownOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!route;
  const [tab,     setTab]     = useState<'details' | 'reassign'>('details');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  /* ── Main form state ── */
  const [form, setForm] = useState({
    routeName:           route?.route_name            ?? '',
    routeCode:           route?.route_code            ?? '',
    direction:           route?.direction             ?? 'PICKUP',
    session:             route?.session               ?? 'MORNING',
    routeType:           route?.route_type            ?? 'STUDENT',
    departureTime:       route?.departure_time        ?? '07:00',
    arrivalTime:         route?.arrival_time          ?? '',
    assignedVehicleId:   route?.assigned_vehicle_id   ?? '',
    assignedDriverId:    route?.assigned_driver_id    ?? '',
    assignedAttendantId: route?.assigned_attendant_id ?? '',
    seatCapacity:        String(route?.seat_capacity  ?? 40),
    isActive:            route?.is_active             ?? true,
  });

  /* ── Reassignment state ── */
  const [reassign, setReassign] = useState({
    vehicleId:   route?.assigned_vehicle_id   ?? '',
    driverId:    route?.assigned_driver_id    ?? '',
    attendantId: route?.assigned_attendant_id ?? '',
    reason:      '',
    notes:       '',
  });

  /* ── Stop Sequence state ── */
  const [stops,   setStops]   = useState<StopStep[]>(route?.stop_sequence ?? []);
  const [newStop, setNewStop] = useState({ stopName: '', pickupTime: '' });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const setR = (k: keyof typeof reassign) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setReassign(r => ({ ...r, [k]: e.target.value }));

  function addStop() {
    if (!newStop.stopName.trim()) return;
    setStops(s => [...s, { stopName: newStop.stopName.trim(), sequence: s.length + 1, pickupTime: newStop.pickupTime || undefined }]);
    setNewStop({ stopName: '', pickupTime: '' });
  }
  function removeStop(i: number) {
    setStops(s => s.filter((_, j) => j !== i).map((x, j) => ({ ...x, sequence: j + 1 })));
  }
  function moveStop(i: number, dir: -1 | 1) {
    const arr = [...stops]; const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setStops(arr.map((x, idx) => ({ ...x, sequence: idx + 1 })));
  }

  /* ── Save main form ── */
  async function save() {
    if (!form.routeName.trim()) { setError('Route name is required'); return; }
    if (!form.departureTime)    { setError('Departure time is required'); return; }
    setSaving(true); setError('');
    try {
      const url    = isEdit ? `/api/school-bus/routes/${route!.id}` : '/api/school-bus/routes';
      const method = isEdit ? 'PATCH' : 'POST';
      const payload = isEdit
        ? { id: route!.id, ...form, seatCapacity: Number(form.seatCapacity), stopSequence: stops }
        : { ...form, seatCapacity: Number(form.seatCapacity), stopSequence: stops };
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed'); return; }
      onSaved();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  /* ── Save reassignment ── */
  async function saveReassign() {
    if (!reassign.reason.trim()) { setError('Reason for reassignment is required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/school-bus/routes/${route!.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:      'reassign',
          vehicleId:   reassign.vehicleId   || undefined,
          driverId:    reassign.driverId    || undefined,
          attendantId: reassign.attendantId || undefined,
          reason:      reassign.reason,
          notes:       reassign.notes       || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Reassignment failed'); return; }
      onSaved();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50';
  const lbl = 'text-xs text-slate-400 mb-1 block';

  /* ── Vehicle / Driver / Attendant dropdown helper ── */
  function VehicleSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
    return (
      <div className="space-y-1">
        <label className={lbl}>{label}</label>
        <select value={value} onChange={e => onChange(e.target.value)} className={inp}>
          <option value="">— Not assigned —</option>
          {options.vehicles.map(v => (
            <option key={v.id} value={v.id}>
              {v.reg} · {v.type} · {v.capacity} seats{v.status !== 'AVAILABLE' ? ` (${v.status})` : ''}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function DriverSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
    return (
      <div className="space-y-1">
        <label className={lbl}>{label}</label>
        <select value={value} onChange={e => onChange(e.target.value)} className={inp}>
          <option value="">— Not assigned —</option>
          {options.drivers.map(d => (
            <option key={d.id} value={d.id}>
              {d.full_name}{d.phone ? ` · ${d.phone}` : ''}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function AttendantSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
    return (
      <div className="space-y-1">
        <label className={lbl}>{label}</label>
        <select value={value} onChange={e => onChange(e.target.value)} className={inp}>
          <option value="">— Not assigned —</option>
          {options.attendants.map(a => (
            <option key={a.id} value={a.id}>
              {a.full_name} · {a.employee_id}{a.current_route ? ` (${a.current_route})` : ''}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-slate-900 z-10">
          <div>
            <h2 className="text-white font-bold">{isEdit ? 'Edit Route' : 'New Route'}</h2>
            {isEdit && route?.route_code && (
              <p className="text-xs text-yellow-400 mt-0.5 font-mono">{route.route_code}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Tabs — only shown in edit mode */}
        {isEdit && (
          <div className="flex border-b border-white/10 px-6">
            {(['details', 'reassign'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setError(''); }}
                className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
                  tab === t ? 'border-yellow-500 text-yellow-400' : 'border-transparent text-slate-500 hover:text-white'
                }`}>
                {t === 'details' ? '📋 Route Details' : '🔄 Reassign Resources'}
              </button>
            ))}
          </div>
        )}

        <div className="p-6 space-y-5">

          {/* ══════════════ DETAILS TAB ══════════════ */}
          {tab === 'details' && (
            <>
              {/* Row 1: Route Name + Route Code */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className={lbl}>Route Name *</label>
                  <input value={form.routeName} onChange={set('routeName')} placeholder="e.g. Marina Morning Pickup" className={inp} />
                </div>
                <div className="space-y-1">
                  <label className={lbl}>Route Code</label>
                  <input value={form.routeCode} onChange={set('routeCode')} placeholder="e.g. RTE-001" className={`${inp} font-mono`} />
                </div>
              </div>

              {/* Row 2: Direction + Session + Route Type */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className={lbl}>Direction</label>
                  <select value={form.direction} onChange={set('direction')} className={inp}>
                    <option value="PICKUP">Pickup (Home → School)</option>
                    <option value="DROPOFF">Drop-off (School → Home)</option>
                    <option value="BOTH">Both Ways</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={lbl}>Session</label>
                  <select value={form.session} onChange={set('session')} className={inp}>
                    <option value="MORNING">Morning</option>
                    <option value="AFTERNOON">Afternoon</option>
                    <option value="BOTH">Both</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={lbl}>Route Type</label>
                  <select value={form.routeType} onChange={set('routeType')} className={inp}>
                    <option value="STUDENT">Student Only</option>
                    <option value="STAFF">Staff Only</option>
                    <option value="MIXED">Mixed (Students + Staff)</option>
                  </select>
                </div>
              </div>

              {/* Row 3: Departure + Arrival + Seat Capacity + Status */}
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className={lbl}>Departure Time</label>
                  <input type="time" value={form.departureTime} onChange={set('departureTime')} className={inp} />
                </div>
                <div className="space-y-1">
                  <label className={lbl}>Est. Arrival</label>
                  <input type="time" value={form.arrivalTime} onChange={set('arrivalTime')} className={inp} />
                </div>
                <div className="space-y-1">
                  <label className={lbl}>Seat Capacity</label>
                  <input type="number" min={1} max={80} value={form.seatCapacity} onChange={set('seatCapacity')} className={inp} />
                </div>
                <div className="space-y-1">
                  <label className={lbl}>Status</label>
                  <select value={form.isActive ? 'ACTIVE' : 'INACTIVE'}
                    onChange={e => setForm(f => ({ ...f, isActive: e.target.value === 'ACTIVE' }))}
                    className={inp}>
                    <option value="ACTIVE">🟢 Active</option>
                    <option value="INACTIVE">⚪ Inactive</option>
                  </select>
                </div>
              </div>

              {/* Resource Assignment */}
              <div className="rounded-xl bg-slate-800/50 border border-white/5 p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Resource Assignment</p>
                <div className="grid grid-cols-3 gap-3">
                  <VehicleSelect
                    label="Vehicle / Bus"
                    value={form.assignedVehicleId}
                    onChange={v => setForm(f => ({ ...f, assignedVehicleId: v }))}
                  />
                  <DriverSelect
                    label="Driver"
                    value={form.assignedDriverId}
                    onChange={v => setForm(f => ({ ...f, assignedDriverId: v }))}
                  />
                  <AttendantSelect
                    label="Nanny / Attendant"
                    value={form.assignedAttendantId}
                    onChange={v => setForm(f => ({ ...f, assignedAttendantId: v }))}
                  />
                </div>
                {options.vehicles.length === 0 && options.drivers.length === 0 && (
                  <p className="text-xs text-amber-400">
                    ⚠️ No vehicles or drivers found. Add them in Fleet & Driver Management first.
                  </p>
                )}
              </div>

              {/* Stop Sequence Engine */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Stop Sequence Engine</p>
                {stops.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 bg-slate-800/50 rounded-xl px-3 py-2">
                    <span className="w-6 h-6 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {s.sequence}
                    </span>
                    <span className="flex-1 text-sm text-white">{s.stopName}</span>
                    {s.pickupTime && <span className="text-xs text-slate-500">{s.pickupTime}</span>}
                    <div className="flex gap-1">
                      <button onClick={() => moveStop(i, -1)} disabled={i === 0}
                        className="w-5 h-5 rounded bg-slate-700 text-slate-400 text-xs disabled:opacity-30">↑</button>
                      <button onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1}
                        className="w-5 h-5 rounded bg-slate-700 text-slate-400 text-xs disabled:opacity-30">↓</button>
                      <button onClick={() => removeStop(i)}
                        className="w-5 h-5 rounded bg-red-500/20 text-red-400 text-xs">×</button>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input value={newStop.stopName} onChange={e => setNewStop(n => ({ ...n, stopName: e.target.value }))}
                    placeholder="Stop name…" className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50"
                    onKeyDown={e => e.key === 'Enter' && addStop()} />
                  <input type="time" value={newStop.pickupTime} onChange={e => setNewStop(n => ({ ...n, pickupTime: e.target.value }))}
                    className="w-28 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/50" />
                  <button onClick={addStop}
                    className="px-3 py-2 rounded-lg bg-yellow-500/20 text-yellow-400 text-sm border border-yellow-500/30 hover:bg-yellow-500/30 transition-all">
                    + Add
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ══════════════ REASSIGN TAB ══════════════ */}
          {tab === 'reassign' && isEdit && (
            <>
              {/* Current assignment summary */}
              <div className="rounded-xl bg-slate-800/50 border border-white/10 p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Current Assignment</p>
                {route?.vehicle_reg && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 w-20">Vehicle</span>
                    <span className="text-white font-mono">{route.vehicle_reg}</span>
                    {route.vehicle_type && <span className="text-xs text-slate-500">{route.vehicle_type}</span>}
                  </div>
                )}
                {route?.driver_name && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 w-20">Driver</span>
                    <span className="text-white">{route.driver_name}</span>
                  </div>
                )}
                {route?.assigned_attendant_id && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 w-20">Attendant</span>
                    <span className="text-white">
                      {options.attendants.find(a => a.id === route.assigned_attendant_id)?.full_name ?? route.assigned_attendant_id}
                    </span>
                  </div>
                )}
                {!route?.vehicle_reg && !route?.driver_name && !route?.assigned_attendant_id && (
                  <p className="text-xs text-slate-500">No resources currently assigned to this route.</p>
                )}
              </div>

              {/* New assignment dropdowns */}
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 space-y-4">
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">New Assignment</p>
                <div className="grid grid-cols-3 gap-3">
                  <VehicleSelect
                    label="Reassign Vehicle"
                    value={reassign.vehicleId}
                    onChange={v => setReassign(r => ({ ...r, vehicleId: v }))}
                  />
                  <DriverSelect
                    label="Reassign Driver"
                    value={reassign.driverId}
                    onChange={v => setReassign(r => ({ ...r, driverId: v }))}
                  />
                  <AttendantSelect
                    label="Reassign Nanny"
                    value={reassign.attendantId}
                    onChange={v => setReassign(r => ({ ...r, attendantId: v }))}
                  />
                </div>

                <div className="space-y-1">
                  <label className={lbl}>Reason for Reassignment *</label>
                  <select value={reassign.reason} onChange={setR('reason')} className={inp}>
                    <option value="">— Select a reason —</option>
                    <option value="Driver unavailable">Driver unavailable</option>
                    <option value="Vehicle breakdown">Vehicle breakdown</option>
                    <option value="Attendant leave">Attendant on leave</option>
                    <option value="Route optimisation">Route optimisation</option>
                    <option value="Schedule change">Schedule change</option>
                    <option value="Emergency substitution">Emergency substitution</option>
                    <option value="Capacity rebalancing">Capacity rebalancing</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className={lbl}>Notes (optional)</label>
                  <textarea value={reassign.notes} onChange={setR('notes')} rows={2}
                    placeholder="Additional notes about this reassignment…"
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 resize-none" />
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
                <p className="text-xs text-blue-300">
                  ℹ️ Reassignment is logged in the route history. The previous vehicle, driver, and attendant are recorded with the timestamp and reason.
                </p>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Footer Buttons */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-all">
              Cancel
            </button>
            {tab === 'details' ? (
              <button onClick={save} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-yellow-500 text-slate-900 text-sm font-bold hover:bg-yellow-400 transition-all disabled:opacity-50">
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Route'}
              </button>
            ) : (
              <button onClick={saveReassign} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-slate-900 text-sm font-bold hover:bg-amber-400 transition-all disabled:opacity-50">
                {saving ? 'Saving…' : '🔄 Confirm Reassignment'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Main Page ─────────────────────── */
export default function SchoolBusRoutesPage() {
  const [routes,   setRoutes]   = useState<BusRoute[]>([]);
  const [capacity, setCapacity] = useState<Record<string, CapRoute>>({});
  const [options,  setOptions]  = useState<DropdownOptions>({ vehicles: [], drivers: [], attendants: [] });
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<'new' | BusRoute | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [session,  setSession]  = useState('');
  const [statusFil,setStatusFil]= useState('');   // '' | 'ACTIVE' | 'INACTIVE'
  const [toast,    setToast]    = useState<{ msg: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, cRes, oRes] = await Promise.all([
        fetch('/api/school-bus/routes').then(r => r.json()),
        fetch('/api/school-bus/capacity-check').then(r => r.json()),
        fetch('/api/school-bus/routes/options').then(r => r.json()),
      ]);
      const rawRoutes = Array.isArray(rRes.data) ? rRes.data : Array.isArray(rRes) ? rRes : [];
      const list: BusRoute[] = rawRoutes.map((r: BusRoute) => ({
        ...r,
        stop_sequence: Array.isArray(r.stop_sequence) ? r.stop_sequence : [],
        is_active: r.is_active !== false,  // default true
      }));
      setRoutes(list);
      const capMap: Record<string, CapRoute> = {};
      for (const c of (cRes.routes ?? [])) capMap[c.routeId] = c;
      setCapacity(capMap);
      if (oRes && !oRes.error) setOptions(oRes);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500);
  };

  const filtered = routes.filter(r =>
    (!session    || r.session  === session) &&
    (!statusFil  || (statusFil === 'ACTIVE' ? r.is_active : !r.is_active))
  );
  const overloadCount = Object.values(capacity).filter(c => c.capacityStatus === 'OVERLOAD').length;
  const noAttCount    = Object.values(capacity).filter(c => c.complianceStatus === 'NO_ATTENDANT').length;
  const activeCount   = routes.filter(r => r.is_active).length;

  return (
    <div className="space-y-6 max-w-full">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl border text-sm font-semibold shadow-xl ${
          toast.ok ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-red-500/20 border-red-500/30 text-red-300'
        }`}>{toast.ok ? '✅' : '❌'} {toast.msg}</div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🗺️ Routes Management</h1>
          <p className="text-slate-400 text-sm mt-0.5">Stop sequences · Capacity guard · Driver & Nanny assignment · UAE compliance</p>
        </div>
        <button onClick={() => setModal('new')}
          className="px-5 py-2.5 rounded-xl bg-yellow-500 text-slate-900 font-bold text-sm hover:bg-yellow-400 transition-all">
          + New Route
        </button>
      </div>

      {/* Alert banners */}
      {(overloadCount > 0 || noAttCount > 0) && (
        <div className="space-y-2">
          {overloadCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30">
              <span className="text-xl">🚨</span>
              <p className="text-red-300 text-sm font-semibold">{overloadCount} route{overloadCount > 1 ? 's' : ''} OVERLOADED — student count exceeds seat capacity</p>
            </div>
          )}
          {noAttCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <span className="text-xl">⚠️</span>
              <p className="text-amber-300 text-sm font-semibold">{noAttCount} route{noAttCount > 1 ? 's have' : ' has'} no female attendant — UAE regulatory violation</p>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: 'Total Routes',  value: routes.length,      color: 'text-white',         icon: '🗺️' },
          { label: 'Active',        value: activeCount,         color: 'text-emerald-400',   icon: '🟢' },
          { label: 'Inactive',      value: routes.length - activeCount, color: 'text-slate-400', icon: '⚪' },
          { label: 'Near Full',     value: Object.values(capacity).filter(c => c.capacityStatus === 'WARNING').length, color: 'text-amber-400', icon: '⚡' },
          { label: 'Overloaded',    value: overloadCount,       color: overloadCount > 0 ? 'text-red-400' : 'text-slate-400', icon: '🚨' },
        ].map(k => (
          <div key={k.label} className="rounded-2xl bg-slate-900 border border-white/10 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xl">{k.icon}</span>
              <span className={`text-2xl font-bold ${k.color}`}>{loading ? '…' : k.value}</span>
            </div>
            <p className="text-slate-500 text-xs mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-1">
          {['', 'MORNING', 'AFTERNOON', 'BOTH'].map(s => (
            <button key={s} onClick={() => setSession(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                session === s ? 'bg-yellow-500 text-slate-900' : 'bg-slate-900 border border-white/10 text-slate-400 hover:text-white'
              }`}>
              {s || 'All Sessions'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {[['', 'All Status'], ['ACTIVE', '🟢 Active'], ['INACTIVE', '⚪ Inactive']].map(([v, label]) => (
            <button key={v} onClick={() => setStatusFil(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                statusFil === v ? 'bg-yellow-500 text-slate-900' : 'bg-slate-900 border border-white/10 text-slate-400 hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Route list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-800/60 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-slate-900 border border-white/10 p-12 text-center space-y-3">
          <span className="text-5xl">🗺️</span>
          <p className="text-slate-400 font-medium">No routes found</p>
          <button onClick={() => setModal('new')}
            className="mt-2 px-5 py-2.5 rounded-xl bg-yellow-500 text-slate-900 font-bold text-sm hover:bg-yellow-400 transition-all">
            + Create First Route
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(route => {
            const cap  = capacity[route.id];
            const isEx = expanded === route.id;
            const isInactive = !route.is_active;

            return (
              <div key={route.id} className={`rounded-2xl border transition-all ${
                isInactive               ? 'bg-slate-900/40 border-white/5 opacity-70' :
                cap?.capacityStatus === 'OVERLOAD'        ? 'bg-red-500/5 border-red-500/30' :
                cap?.complianceStatus === 'NO_ATTENDANT'  ? 'bg-amber-500/5 border-amber-500/20' :
                'bg-slate-900 border-white/10 hover:border-white/20'
              }`}>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">

                    {/* Left: Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold">{route.route_name}</span>
                        {route.route_code && (
                          <span className="font-mono text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded">
                            {route.route_code}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${SESSION_COLOR[route.session] ?? ''}`}>
                          {route.session}
                        </span>
                        <span className="text-xs text-slate-500">{route.route_type}</span>
                        <span className="text-xs text-slate-500">{route.direction}</span>
                        {/* Active / Inactive badge */}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          route.is_active
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-slate-700/40 text-slate-500 border-slate-700/40'
                        }`}>
                          {route.is_active ? '🟢 ACTIVE' : '⚪ INACTIVE'}
                        </span>
                      </div>

                      {/* Times & assignment */}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
                        <span>🕐 {route.departure_time}{route.arrival_time ? ` → ${route.arrival_time}` : ''}</span>
                        {route.vehicle_reg
                          ? <span>🚌 {route.vehicle_reg} {route.vehicle_type ? `(${route.vehicle_type})` : ''}</span>
                          : route.assigned_vehicle_id
                          ? <span className="text-amber-400">🚌 Vehicle ID: {route.assigned_vehicle_id}</span>
                          : <span className="text-red-400/70">🚌 No vehicle</span>
                        }
                        {route.driver_name
                          ? <span>🤵 {route.driver_name}</span>
                          : route.assigned_driver_id
                          ? <span className="text-amber-400">🤵 Driver ID: {route.assigned_driver_id}</span>
                          : <span className="text-red-400/70">🤵 No driver</span>
                        }
                        {route.assigned_attendant_id
                          ? <span className="text-emerald-400">👩 Attendant ✓</span>
                          : <span className="text-red-400/70">👩 No attendant</span>
                        }
                        {route.stop_sequence?.length > 0 && (
                          <span>📍 {route.stop_sequence.length} stops</span>
                        )}
                      </div>
                    </div>

                    {/* Capacity bar */}
                    <div className="w-44 flex-shrink-0"><CapacityBar cap={cap} /></div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {route.stop_sequence?.length > 0 && (
                        <button onClick={() => setExpanded(isEx ? null : route.id)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 text-xs hover:bg-slate-700 transition-all">
                          {isEx ? '▲ Hide' : `▼ ${route.stop_sequence.length} stops`}
                        </button>
                      )}
                      <button onClick={() => setModal(route)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition-all">
                        Edit
                      </button>
                      <button onClick={() => { setModal(route); }}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-xs border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                        title="Reassign resources">
                        🔄
                      </button>
                    </div>
                  </div>

                  {/* Stop sequence expanded view */}
                  {isEx && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-xs text-slate-500 font-semibold uppercase mb-2">Stop Sequence</p>
                      <div className="space-y-1.5">
                        {route.stop_sequence.map((s, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                              {s.sequence}
                            </span>
                            {s.stopCode && <span className="font-mono text-yellow-400 text-[10px]">{s.stopCode}</span>}
                            <span className="flex-1 text-slate-300">{s.stopName}</span>
                            {s.pickupTime && <span className="text-slate-500">{s.pickupTime}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <RouteModal
          route={modal === 'new' ? null : modal}
          options={options}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            showToast(modal === 'new' ? 'Route created' : 'Route updated', true);
            load();
          }}
        />
      )}
    </div>
  );
}
