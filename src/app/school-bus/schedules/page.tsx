'use client';
import { useState, useEffect, useCallback } from 'react';

/* ──────────────────────── types ──────────────────────────── */
interface Schedule {
  id: string;
  schedule_name: string;
  route_id: string | null;
  route_name: string | null;
  route_code: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  attendant_name: string | null;
  week_type: string;
  active_days: string[];
  session: string;
  direction: string;
  departure_time: string;
  arrival_time: string | null;
  effective_from: string;
  effective_to: string | null;
  exception_dates: string[];
  override_dates: { date: string; departure_time: string; arrival_time?: string }[];
  status: string;
  notes: string | null;
  created_at: string;
}

const TENANTID = 'default';

const WEEK_TYPES = ['MON_THU', 'FRI', 'DAILY', 'CUSTOM'];
const SESSIONS   = ['MORNING', 'AFTERNOON', 'BOTH'];
const DIRECTIONS = ['PICKUP', 'DROPOFF', 'BOTH'];
const STATUS_OPTS= ['ACTIVE', 'SUSPENDED', 'DRAFT'];
const DAY_LABELS: Record<string, string> = { SUN:'Sun', MON:'Mon', TUE:'Tue', WED:'Wed', THU:'Thu', FRI:'Fri', SAT:'Sat' };

const UAE_DAYS_ORDER = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

const WEEK_BADGE: Record<string, string> = {
  MON_THU: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  FRI:     'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  DAILY:   'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  CUSTOM:  'bg-purple-500/15 text-purple-300 border-purple-500/30',
};

const SESSION_BADGE: Record<string, string> = {
  MORNING:   'bg-amber-500/15 text-amber-300',
  AFTERNOON: 'bg-orange-500/15 text-orange-300',
  BOTH:      'bg-sky-500/15 text-sky-300',
};

function fmtTime(t: string | null): string {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h % 12) || 12).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ──────────────────────── Modal ────────────────────────────── */
interface ModalProps {
  initial?: Partial<Schedule>;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}
function ScheduleModal({ initial, onSave, onClose }: ModalProps) {
  const [form, setForm] = useState({
    scheduleName:  initial?.schedule_name  ?? '',
    routeName:     initial?.route_name     ?? '',
    routeCode:     initial?.route_code     ?? '',
    vehiclePlate:  initial?.vehicle_plate  ?? '',
    driverName:    initial?.driver_name    ?? '',
    attendantName: initial?.attendant_name ?? '',
    weekType:      initial?.week_type      ?? 'MON_THU',
    activeDays:    initial?.active_days    ?? ['SUN','MON','TUE','WED','THU'],
    session:       initial?.session        ?? 'MORNING',
    direction:     initial?.direction      ?? 'PICKUP',
    departureTime: initial?.departure_time ?? '07:00',
    arrivalTime:   initial?.arrival_time   ?? '',
    effectiveFrom: initial?.effective_from?.slice(0,10) ?? new Date().toISOString().slice(0,10),
    effectiveTo:   initial?.effective_to?.slice(0,10)   ?? '',
    exceptionDatesStr: (initial?.exception_dates ?? []).join(', '),
    status:        initial?.status         ?? 'ACTIVE',
    notes:         initial?.notes          ?? '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const toggleDay = (day: string) => {
    const days = form.activeDays.includes(day)
      ? form.activeDays.filter(d => d !== day)
      : [...form.activeDays, day];
    set('activeDays', days);
  };

  // Auto-set active days when week type changes
  const handleWeekType = (wt: string) => {
    const defaults: Record<string, string[]> = {
      MON_THU: ['SUN','MON','TUE','WED','THU'],
      FRI:     ['FRI'],
      DAILY:   ['SUN','MON','TUE','WED','THU','FRI','SAT'],
    };
    setForm(f => ({ ...f, weekType: wt, activeDays: wt !== 'CUSTOM' ? (defaults[wt] ?? f.activeDays) : f.activeDays }));
  };

  const handleSubmit = async () => {
    if (!form.scheduleName.trim() || !form.departureTime) return;
    setSaving(true);
    const exceptionDates = form.exceptionDatesStr.split(',').map(s => s.trim()).filter(Boolean);
    onSave({ ...form, exceptionDates });
    setSaving(false);
  };

  const labelClass = 'text-xs text-slate-400 mb-1 block';
  const inputClass = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50';
  const selectClass = `${inputClass} cursor-pointer`;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">
            {initial?.id ? '✏️ Edit Schedule' : '➕ New Schedule'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Schedule Name *</label>
              <input value={form.scheduleName} onChange={e => set('scheduleName', e.target.value)}
                placeholder="e.g. Marina MORNING MON-THU Pickup" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Route Name</label>
              <input value={form.routeName} onChange={e => set('routeName', e.target.value)}
                placeholder="e.g. Marina Morning Route" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Route Code</label>
              <input value={form.routeCode} onChange={e => set('routeCode', e.target.value)}
                placeholder="e.g. RT-001" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Vehicle Plate</label>
              <input value={form.vehiclePlate} onChange={e => set('vehiclePlate', e.target.value)}
                placeholder="e.g. Dubai A 12345" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Driver Name</label>
              <input value={form.driverName} onChange={e => set('driverName', e.target.value)}
                placeholder="Driver full name" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Attendant Name</label>
              <input value={form.attendantName} onChange={e => set('attendantName', e.target.value)}
                placeholder="Nanny full name" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={selectClass}>
                {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Week cycle */}
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">UAE Week Cycle</p>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <label className={labelClass}>Week Type</label>
                <select value={form.weekType} onChange={e => handleWeekType(e.target.value)} className={selectClass}>
                  {WEEK_TYPES.map(w => (
                    <option key={w} value={w}>{w === 'MON_THU' ? 'Sun–Thu (Standard UAE)' : w === 'FRI' ? 'Friday only' : w}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Session</label>
                <select value={form.session} onChange={e => set('session', e.target.value)} className={selectClass}>
                  {SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {/* Day picker */}
            <label className={labelClass}>Active Days</label>
            <div className="flex gap-1.5 flex-wrap">
              {UAE_DAYS_ORDER.map(day => (
                <button key={day} type="button" onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    form.activeDays.includes(day)
                      ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                      : 'bg-slate-800 text-slate-500 border-white/5 hover:border-white/20'
                  }`}>
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>

          {/* Timing */}
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Timing & Direction</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Departure Time *</label>
                <input type="time" value={form.departureTime} onChange={e => set('departureTime', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Arrival Time</label>
                <input type="time" value={form.arrivalTime} onChange={e => set('arrivalTime', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Direction</label>
                <select value={form.direction} onChange={e => set('direction', e.target.value)} className={selectClass}>
                  {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Validity */}
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Validity Period</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Effective From *</label>
                <input type="date" value={form.effectiveFrom} onChange={e => set('effectiveFrom', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Effective To (leave blank = open-ended)</label>
                <input type="date" value={form.effectiveTo} onChange={e => set('effectiveTo', e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>

          {/* Exceptions */}
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Exception Dates</p>
            <label className={labelClass}>Dates when schedule does NOT run (comma-separated: YYYY-MM-DD)</label>
            <input value={form.exceptionDatesStr}
              onChange={e => set('exceptionDatesStr', e.target.value)}
              placeholder="e.g. 2025-12-02, 2026-01-01, 2026-04-02"
              className={inputClass} />
            <p className="text-xs text-slate-600 mt-1">UAE public holidays: National Day (Dec 2–3), Eid Al Fitr, Eid Al Adha, Islamic New Year, Prophet's Birthday</p>
          </div>

          {/* Notes */}
          <div>
            <label className={labelClass}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="Ramadan adjusted timing, exam period changes, etc."
              className={`${inputClass} resize-none`} />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-white/10">
          <button onClick={handleSubmit} disabled={saving || !form.scheduleName.trim() || !form.departureTime}
            className="flex-1 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-900 font-bold py-2.5 rounded-xl text-sm transition-colors">
            {saving ? 'Saving…' : initial?.id ? 'Update Schedule' : 'Create Schedule'}
          </button>
          <button onClick={onClose} className="px-6 bg-slate-800 hover:bg-slate-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────── ScheduleCard ─────────────────────── */
function ScheduleCard({ s, onEdit, onDelete }: { s: Schedule; onEdit: () => void; onDelete: () => void }) {
  const weekBadge    = WEEK_BADGE[s.week_type]    ?? 'bg-slate-700 text-slate-300 border-slate-600';
  const sessionBadge = SESSION_BADGE[s.session]   ?? 'bg-slate-700 text-slate-300';
  const isActive = s.status === 'ACTIVE';

  return (
    <div className={`bg-slate-900 border rounded-xl p-4 transition-all ${
      s.status === 'SUSPENDED' ? 'border-amber-500/20 opacity-75' :
      s.status === 'DRAFT'     ? 'border-slate-700/50 opacity-60' :
      'border-white/10 hover:border-white/20'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{s.schedule_name}</h3>
          {s.route_name && <p className="text-xs text-slate-400 mt-0.5">🗺️ {s.route_name}{s.route_code ? ` · ${s.route_code}` : ''}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full border ${weekBadge}`}>{s.week_type}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${sessionBadge}`}>{s.session}</span>
          {s.status !== 'ACTIVE' && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              s.status === 'SUSPENDED' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700 text-slate-400'
            }`}>{s.status}</span>
          )}
        </div>
      </div>

      {/* Days row */}
      <div className="flex gap-1 mb-3">
        {UAE_DAYS_ORDER.map(day => (
          <span key={day} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            s.active_days.includes(day)
              ? 'bg-yellow-500/20 text-yellow-300'
              : 'bg-slate-800 text-slate-600'
          }`}>{DAY_LABELS[day]}</span>
        ))}
      </div>

      <div className="flex gap-4 text-sm mb-3">
        <div>
          <span className="text-slate-500 text-xs">Departure</span>
          <p className="text-white font-mono font-semibold">{fmtTime(s.departure_time)}</p>
        </div>
        {s.arrival_time && (
          <div>
            <span className="text-slate-500 text-xs">Arrival</span>
            <p className="text-white font-mono font-semibold">{fmtTime(s.arrival_time)}</p>
          </div>
        )}
        <div>
          <span className="text-slate-500 text-xs">Direction</span>
          <p className="text-white font-semibold">{s.direction}</p>
        </div>
        <div>
          <span className="text-slate-500 text-xs">Validity</span>
          <p className="text-slate-300 text-xs">{fmtDate(s.effective_from)} → {s.effective_to ? fmtDate(s.effective_to) : 'Open-ended'}</p>
        </div>
      </div>

      {/* Crew */}
      <div className="flex gap-3 text-xs text-slate-400 mb-3">
        {s.vehicle_plate && <span>🚌 {s.vehicle_plate}</span>}
        {s.driver_name   && <span>👨‍✈️ {s.driver_name}</span>}
        {s.attendant_name && <span>👩 {s.attendant_name}</span>}
      </div>

      {/* Exceptions */}
      {s.exception_dates.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-amber-400 font-medium mb-1">🚫 Exception dates ({s.exception_dates.length})</p>
          <p className="text-xs text-amber-300/70">{s.exception_dates.slice(0, 5).join(', ')}{s.exception_dates.length > 5 ? '…' : ''}</p>
        </div>
      )}

      {s.notes && <p className="text-xs text-slate-500 italic mb-3">📝 {s.notes}</p>}

      <div className="flex gap-2 pt-2 border-t border-white/5">
        <button onClick={onEdit} className="flex-1 text-xs bg-slate-800 hover:bg-slate-700 text-white py-1.5 rounded-lg transition-colors">
          ✏️ Edit
        </button>
        <button onClick={onDelete} className="px-4 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 py-1.5 rounded-lg transition-colors">
          Delete
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────── Page ─────────────────────────────── */
export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState<Schedule | null>(null);
  const [filterWeek, setFilterWeek]       = useState('');
  const [filterSession, setFilterSession] = useState('');
  const [filterStatus, setFilterStatus]   = useState('ACTIVE');
  const [search, setSearch]               = useState('');

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: TENANTID });
      if (filterWeek)    params.set('weekType', filterWeek);
      if (filterSession) params.set('session', filterSession);
      if (filterStatus)  params.set('status', filterStatus);
      if (search)        params.set('search', search);
      const r = await fetch(`/api/school-bus/schedules?${params}`);
      if (r.ok) {
        const d = await r.json();
        setSchedules(d.data ?? []);
      }
    } catch {} finally { setLoading(false); }
  }, [filterWeek, filterSession, filterStatus, search]);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  const handleSave = async (data: Record<string, unknown>) => {
    const method = editing ? 'PATCH' : 'POST';
    const url    = editing ? `/api/school-bus/schedules/${editing.id}` : '/api/school-bus/schedules';
    const body   = editing ? data : { ...data, tenantId: TENANTID };
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setShowModal(false);
    setEditing(null);
    fetchSchedules();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    await fetch(`/api/school-bus/schedules/${id}`, { method: 'DELETE' });
    fetchSchedules();
  };

  const counts = {
    total:     schedules.length,
    active:    schedules.filter(s => s.status === 'ACTIVE').length,
    monThu:    schedules.filter(s => s.week_type === 'MON_THU').length,
    friday:    schedules.filter(s => s.week_type === 'FRI').length,
    suspended: schedules.filter(s => s.status === 'SUSPENDED').length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">📅 Master Schedules</h1>
          <p className="text-slate-400 text-sm mt-0.5">UAE school week cycles · Sun–Thu standard · Friday optional · Ramadan overrides</p>
        </div>
        <button onClick={() => { setEditing(null); setShowModal(true); }}
          className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold px-4 py-2.5 rounded-xl text-sm transition-colors">
          + New Schedule
        </button>
      </div>

      {/* UAE Week notice */}
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3 flex items-start gap-3">
        <span className="text-xl">🇦🇪</span>
        <div className="text-xs text-slate-400">
          <span className="font-semibold text-indigo-300">UAE school week:</span> Sunday to Thursday (5 days). Friday is a rest day unless special routes are configured. Ramadan schedules typically use a 2-hour delayed start. UAE public holidays are managed via exception dates.
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Total', val: counts.total, color: 'text-white', bg: 'bg-slate-800' },
          { label: 'Active', val: counts.active, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: 'Sun–Thu', val: counts.monThu, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
          { label: 'Friday', val: counts.friday, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Suspended', val: counts.suspended, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map(k => (
          <div key={k.label} className={`${k.bg} border border-white/5 rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-bold ${k.color}`}>{k.val}</p>
            <p className="text-xs text-slate-500">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search schedules, routes, drivers…"
          className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 w-60" />
        {/* Week filter */}
        <div className="flex gap-1">
          {['', 'MON_THU', 'FRI', 'DAILY'].map(w => (
            <button key={w} onClick={() => setFilterWeek(w)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterWeek === w ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-slate-900 text-slate-400 border-white/10 hover:border-white/20'
              }`}>{w === '' ? 'All Weeks' : w === 'MON_THU' ? 'Sun–Thu' : w}</button>
          ))}
        </div>
        {/* Session filter */}
        <div className="flex gap-1">
          {['', ...SESSIONS].map(s => (
            <button key={s} onClick={() => setFilterSession(s)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterSession === s ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-slate-900 text-slate-400 border-white/10 hover:border-white/20'
              }`}>{s === '' ? 'All Sessions' : s}</button>
          ))}
        </div>
        {/* Status */}
        <div className="flex gap-1">
          {['', 'ACTIVE', 'SUSPENDED', 'DRAFT'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterStatus === s ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-slate-900 text-slate-400 border-white/10 hover:border-white/20'
              }`}>{s === '' ? 'All Status' : s}</button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 bg-slate-900 rounded-xl animate-pulse border border-white/5" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-16 text-center">
          <p className="text-4xl mb-4">📅</p>
          <p className="text-slate-300 font-semibold mb-1">No schedules found</p>
          <p className="text-slate-500 text-sm mb-4">Create your first master schedule to define when routes operate.</p>
          <button onClick={() => setShowModal(true)}
            className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold px-6 py-2 rounded-xl text-sm transition-colors">
            Create Schedule
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {schedules.map(s => (
            <ScheduleCard key={s.id} s={s}
              onEdit={() => { setEditing(s); setShowModal(true); }}
              onDelete={() => handleDelete(s.id)} />
          ))}
        </div>
      )}

      {showModal && (
        <ScheduleModal
          initial={editing ?? undefined}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
