'use client';
/**
 * /bus-ops/schedule-templates — recurring schedule templates.
 *
 * A template is the RULE (recurring pattern). The Generate button
 * materialises TripSchedule instances for a chosen date window;
 * generated trips flow through the existing dispatch board and
 * automatically get their passenger roster expanded.
 *
 * Form layout mirrors the reference screenshot minus the Nanny/Attendant
 * field (staff transport doesn't have attendants). Route Name and Route
 * Code are shown read-only, sourced from the selected route (no free-text
 * drift).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, Edit, Trash2, X, Play } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

// ── Types ──────────────────────────────────────────────────────────────────

interface RouteRow {
  id: string;
  name: string;
  code?: string | null;
  origin?: string;
  destination?: string;
  estimatedDurationMins?: number | null;
}
interface VehicleRow { id: string; licensePlate?: string; make?: string; model?: string }
interface DriverRow  { id: string; name: string; licenseType?: string | null }

type WeekType  = 'SUN_THU' | 'MON_FRI' | 'SAT_WED' | 'CUSTOM';
type Session   = 'MORNING' | 'EVENING' | 'NIGHT' | 'SPLIT';
type Direction = 'PICKUP' | 'DROPOFF';
type Status    = 'ACTIVE' | 'INACTIVE';

interface Template {
  id: string;
  name: string;
  routeId: string;
  vehicleId: string | null;
  driverId: string | null;
  weekType: WeekType;
  activeDays: number[];
  session: Session;
  departureTime: string;
  arrivalTime: string | null;
  direction: Direction;
  effectiveFrom: string;
  effectiveTo: string | null;
  exceptionDates: string[];
  status: Status;
  notes: string | null;
}

interface EditState {
  id: string | null;
  name: string;
  routeId: string;
  vehicleId: string;
  driverId: string;
  weekType: WeekType;
  activeDays: number[];
  session: Session;
  departureTime: string;
  arrivalTime: string;
  direction: Direction;
  effectiveFrom: string;
  effectiveTo: string;
  exceptionDatesInput: string; // comma-separated in the UI, expanded on save
  status: Status;
  notes: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const WEEK_TYPES: { value: WeekType; label: string; days: number[] }[] = [
  { value: 'SUN_THU', label: 'Sun–Thu (Standard UAE)', days: [0, 1, 2, 3, 4] },
  { value: 'MON_FRI', label: 'Mon–Fri',                days: [1, 2, 3, 4, 5] },
  { value: 'SAT_WED', label: 'Sat–Wed',                days: [6, 0, 1, 2, 3] },
  { value: 'CUSTOM',  label: 'Custom',                 days: [] },
];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_PILL: Record<Status, string> = {
  ACTIVE:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  INACTIVE: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
};

const EMPTY_EDIT: EditState = {
  id: null, name: '', routeId: '', vehicleId: '', driverId: '',
  weekType: 'SUN_THU', activeDays: [0, 1, 2, 3, 4], session: 'MORNING',
  departureTime: '07:00', arrivalTime: '', direction: 'PICKUP',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '', exceptionDatesInput: '',
  status: 'ACTIVE', notes: '',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ScheduleTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [routes,    setRoutes]    = useState<RouteRow[]>([]);
  const [vehicles,  setVehicles]  = useState<VehicleRow[]>([]);
  const [drivers,   setDrivers]   = useState<DriverRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [edit,      setEdit]      = useState<EditState | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | Status>('ALL');
  // Generate modal state — target template + date window.
  const [genTemplateId, setGenTemplateId] = useState<string | null>(null);
  const [genFrom, setGenFrom] = useState(new Date().toISOString().slice(0, 10));
  const [genTo,   setGenTo]   = useState('');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  const loadRefData = useCallback(async () => {
    const [rRes, vRes, dRes] = await Promise.all([
      fetch('/api/bus-ops/routes?active=true', { cache: 'no-store' }),
      fetch('/api/vehicles',                    { cache: 'no-store' }),
      fetch('/api/bus-ops/drivers',             { cache: 'no-store' }),
    ]);
    if (rRes.ok) setRoutes(await rRes.json());
    if (vRes.ok) {
      const v = await vRes.json();
      setVehicles(Array.isArray(v) ? v : (v?.vehicles ?? []));
    }
    if (dRes.ok) setDrivers(await dRes.json());
  }, []);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const res = await fetch(`/api/bus-ops/schedule-templates?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTemplates(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { loadRefData(); }, [loadRefData]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Fast lookups for table + auto-fill.
  const routeById = useMemo(() => new Map(routes.map(r => [r.id, r])), [routes]);
  const vehById   = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles]);
  const drvById   = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers]);

  const selectedRoute = edit ? routeById.get(edit.routeId) : undefined;

  const openNew = () => { setError(''); setEdit({ ...EMPTY_EDIT }); };
  const openEdit = (t: Template) => {
    setError('');
    setEdit({
      id: t.id, name: t.name, routeId: t.routeId,
      vehicleId: t.vehicleId ?? '', driverId: t.driverId ?? '',
      weekType: t.weekType, activeDays: [...t.activeDays],
      session: t.session, departureTime: t.departureTime,
      arrivalTime: t.arrivalTime ?? '', direction: t.direction,
      effectiveFrom: t.effectiveFrom.slice(0, 10),
      effectiveTo: t.effectiveTo ? t.effectiveTo.slice(0, 10) : '',
      exceptionDatesInput: (t.exceptionDates ?? []).map(d => d.slice(0, 10)).join(', '),
      status: t.status, notes: t.notes ?? '',
    });
  };
  const closeEditor = () => setEdit(null);

  const toggleDay = (day: number) => {
    if (!edit) return;
    const has = edit.activeDays.includes(day);
    const next = has ? edit.activeDays.filter(d => d !== day) : [...edit.activeDays, day].sort();
    setEdit({ ...edit, activeDays: next, weekType: 'CUSTOM' });
  };

  const applyWeekType = (wt: WeekType) => {
    if (!edit) return;
    const preset = WEEK_TYPES.find(w => w.value === wt);
    setEdit({ ...edit, weekType: wt, activeDays: wt === 'CUSTOM' ? edit.activeDays : (preset?.days ?? []) });
  };

  // Arrival auto-fill — derive from selected route's estimated duration when
  // ops changes departure or route, but only if the operator hasn't manually
  // typed an arrival (empty string = "please auto-fill me").
  useEffect(() => {
    if (!edit) return;
    if (edit.arrivalTime) return;
    if (!selectedRoute?.estimatedDurationMins || !edit.departureTime) return;
    const [hh, mm] = edit.departureTime.split(':').map(n => parseInt(n, 10));
    if (isNaN(hh) || isNaN(mm)) return;
    const total = hh * 60 + mm + selectedRoute.estimatedDurationMins;
    const nh = Math.floor((total / 60) % 24);
    const nm = total % 60;
    const auto = `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
    setEdit(p => (p && !p.arrivalTime ? { ...p, arrivalTime: auto } : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.routeId, edit?.departureTime, selectedRoute?.estimatedDurationMins]);

  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim())    { setError('Schedule Name is required'); return; }
    if (!edit.routeId)        { setError('Route is required');          return; }
    if (!edit.departureTime)  { setError('Departure Time is required'); return; }
    if (!edit.activeDays.length) { setError('At least one Active Day is required'); return; }
    setSaving(true); setError('');
    try {
      const exceptionDates = edit.exceptionDatesInput
        .split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      const body = {
        name: edit.name.trim(),
        routeId: edit.routeId,
        vehicleId: edit.vehicleId || null,
        driverId:  edit.driverId  || null,
        weekType: edit.weekType,
        activeDays: edit.activeDays,
        session: edit.session,
        departureTime: edit.departureTime,
        arrivalTime: edit.arrivalTime || null,
        direction: edit.direction,
        effectiveFrom: edit.effectiveFrom || null,
        effectiveTo: edit.effectiveTo || null,
        exceptionDates,
        status: edit.status,
        notes: edit.notes || null,
      };
      const res = edit.id
        ? await fetch(`/api/bus-ops/schedule-templates/${edit.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/bus-ops/schedule-templates`,             { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      setEdit(null);
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this template? (soft delete — generated trips remain)')) return;
    try {
      const res = await fetch(`/api/bus-ops/schedule-templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadTemplates();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const openGenerate = (id: string) => {
    setGenResult(null);
    setGenFrom(new Date().toISOString().slice(0, 10));
    // Default the "to" to 7 days from today — matches the "generate next
    // week" instinct without committing to a huge horizon.
    const t = new Date(); t.setDate(t.getDate() + 6);
    setGenTo(t.toISOString().slice(0, 10));
    setGenTemplateId(id);
  };
  const runGenerate = async () => {
    if (!genTemplateId) return;
    if (!genFrom || !genTo) { setGenResult('Both dates are required'); return; }
    setGenerating(true); setGenResult(null);
    try {
      const res = await fetch(`/api/bus-ops/schedule-templates/${genTemplateId}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: genFrom, to: genTo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setGenResult(
        `Generated ${json.generated} · already existed ${json.skippedAlreadyExisted} · ` +
        `out of window ${json.skippedOutOfWindow} · inactive/exception ${json.skippedInactiveOrException}` +
        (json.errors ? ` · errors ${json.errors}` : ''),
      );
    } catch (e) {
      setGenResult(e instanceof Error ? e.message : 'Generation failed');
    } finally { setGenerating(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule Templates"
        subtitle={`${templates.length} defined · recurring rules that generate concrete trips`}
        icon={CalendarClock}
        accent="violet"
        actions={
          <button onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus className="w-4 h-4" /> New Schedule Template
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-300 text-sm">{error}</div>}

      <div className="flex gap-3 items-end">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'ALL' | Status)}
            className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 overflow-x-auto">
        {loading ? (
          <div className="text-center text-slate-400 py-10 animate-pulse">Loading…</div>
        ) : templates.length === 0 ? (
          <div className="text-center text-slate-400 py-10">
            No templates yet. Click <strong className="text-violet-300">New Schedule Template</strong> to define one.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Name', 'Route', 'Vehicle', 'Driver', 'Days', 'Session', 'Departure', 'Direction', 'From', 'To', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map(t => {
                const r = routeById.get(t.routeId);
                const v = t.vehicleId ? vehById.get(t.vehicleId) : null;
                const d = t.driverId  ? drvById.get(t.driverId)  : null;
                const daysStr = t.activeDays.map(x => DAY_LABELS[x]).join(' ');
                return (
                  <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-3 text-sm text-white font-medium">{t.name}</td>
                    <td className="px-3 py-3 text-sm text-slate-200">
                      {r?.name ?? <span className="text-slate-500 italic">(deleted)</span>}
                      {r?.code && <span className="ml-1 text-[10px] font-mono text-slate-500">[{r.code}]</span>}
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-200">{v?.licensePlate ?? '—'}</td>
                    <td className="px-3 py-3 text-sm text-slate-200">{d?.name ?? '—'}</td>
                    <td className="px-3 py-3 text-xs text-slate-300 whitespace-nowrap">{daysStr}</td>
                    <td className="px-3 py-3 text-xs text-slate-300">{t.session}</td>
                    <td className="px-3 py-3 text-xs font-mono text-slate-200">{t.departureTime}{t.arrivalTime ? `→${t.arrivalTime}` : ''}</td>
                    <td className="px-3 py-3 text-xs text-slate-300">{t.direction}</td>
                    <td className="px-3 py-3 text-xs text-slate-300 whitespace-nowrap">{fmtDate(t.effectiveFrom)}</td>
                    <td className="px-3 py-3 text-xs text-slate-300 whitespace-nowrap">{t.effectiveTo ? fmtDate(t.effectiveTo) : <span className="text-slate-500">open</span>}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_PILL[t.status]}`}>{t.status}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openGenerate(t.id)} title="Generate trips"
                          className="p-1.5 rounded border border-white/10 text-emerald-300 hover:border-emerald-500/40 hover:bg-emerald-500/10">
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => openEdit(t)} title="Edit"
                          className="p-1.5 rounded border border-white/10 text-slate-300 hover:border-violet-500/40 hover:text-white">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => remove(t.id)} title="Delete"
                          className="p-1.5 rounded border border-white/10 text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Editor modal */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-slate-800/95 border border-white/10 rounded-2xl p-6 my-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">{edit.id ? 'Edit Schedule Template' : 'New Schedule Template'}</h2>
              <button onClick={closeEditor} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Schedule Name *</label>
                <input type="text" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })}
                  placeholder="e.g. Marina MORNING SUN-THU Pickup"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Route *</label>
                <select value={edit.routeId} onChange={e => setEdit({ ...edit, routeId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                  <option value="">— Select route —</option>
                  {routes.map(r => <option key={r.id} value={r.id}>{r.name}{r.code ? ` [${r.code}]` : ''}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Route Code</label>
                <input type="text" readOnly value={selectedRoute?.code ?? ''}
                  placeholder="Auto-filled from Route"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-slate-300 placeholder-slate-600 cursor-not-allowed" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Vehicle Plate</label>
                <select value={edit.vehicleId} onChange={e => setEdit({ ...edit, vehicleId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                  <option value="">— Assign per trip —</option>
                  {vehicles.map(v => {
                    const label = [v.licensePlate, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ') || v.id.slice(0, 8);
                    return <option key={v.id} value={v.id}>{label}</option>;
                  })}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Driver</label>
                <select value={edit.driverId} onChange={e => setEdit({ ...edit, driverId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                  <option value="">— Assign per trip —</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}{d.licenseType ? ` (${d.licenseType})` : ''}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Status</label>
                <select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value as Status })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>

              <div className="md:col-span-2 pt-2 border-t border-white/5">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">UAE Week Cycle</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Week Type</label>
                <select value={edit.weekType} onChange={e => applyWeekType(e.target.value as WeekType)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                  {WEEK_TYPES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Session</label>
                <select value={edit.session} onChange={e => setEdit({ ...edit, session: e.target.value as Session })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                  {(['MORNING', 'EVENING', 'NIGHT', 'SPLIT'] as Session[]).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Active Days</label>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((lbl, dow) => {
                    const on = edit.activeDays.includes(dow);
                    return (
                      <button key={lbl} type="button" onClick={() => toggleDay(dow)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                          on
                            ? 'bg-amber-500/25 text-amber-200 border-amber-500/40'
                            : 'bg-slate-700/50 text-slate-400 border-white/10 hover:border-white/20'
                        }`}>
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="md:col-span-2 pt-2 border-t border-white/5">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Timing &amp; Direction</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Departure Time *</label>
                <input type="time" value={edit.departureTime} onChange={e => setEdit({ ...edit, departureTime: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Arrival Time
                  {selectedRoute?.estimatedDurationMins ? <span className="ml-2 text-[10px] font-normal text-violet-300">auto-filled from route duration</span> : null}
                </label>
                <input type="time" value={edit.arrivalTime} onChange={e => setEdit({ ...edit, arrivalTime: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Direction</label>
                <select value={edit.direction} onChange={e => setEdit({ ...edit, direction: e.target.value as Direction })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                  <option value="PICKUP">PICKUP</option>
                  <option value="DROPOFF">DROPOFF</option>
                </select>
              </div>

              <div className="md:col-span-2 pt-2 border-t border-white/5">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-2">Validity Period</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Effective From *</label>
                <input type="date" value={edit.effectiveFrom} onChange={e => setEdit({ ...edit, effectiveFrom: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Effective To <span className="text-slate-500 font-normal">(blank = open-ended)</span></label>
                <input type="date" value={edit.effectiveTo} onChange={e => setEdit({ ...edit, effectiveTo: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Exception Dates <span className="text-slate-500 font-normal">(comma-separated YYYY-MM-DD, e.g. holidays)</span></label>
                <input type="text" value={edit.exceptionDatesInput}
                  onChange={e => setEdit({ ...edit, exceptionDatesInput: e.target.value })}
                  placeholder="2026-09-16, 2026-12-02"
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Notes</label>
                <textarea value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-5">
              <button onClick={closeEditor}
                className="px-4 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : edit.id ? 'Save' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate modal */}
      {genTemplateId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-800/95 border border-emerald-500/30 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Generate Trips</h2>
              <button onClick={() => setGenTemplateId(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Creates TripSchedule instances from this template for the chosen window. Idempotent — safe to re-run.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">From *</label>
                <input type="date" value={genFrom} onChange={e => setGenFrom(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-emerald-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">To *</label>
                <input type="date" value={genTo} onChange={e => setGenTo(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-emerald-500 focus:outline-none" />
              </div>
            </div>
            {genResult && (
              <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-emerald-200 text-xs">
                {genResult}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => setGenTemplateId(null)}
                className="px-4 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5 text-sm">Close</button>
              <button onClick={runGenerate} disabled={generating}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90 disabled:opacity-50 text-sm inline-flex items-center gap-1.5">
                <Play className="w-4 h-4" />
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
