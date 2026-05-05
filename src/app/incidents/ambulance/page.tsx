'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
type CallStatus = 'CALL_RECEIVED' | 'DISPATCHED' | 'ON_SCENE' | 'TRANSPORTING' | 'AT_HOSPITAL' | 'CLEARED';
type Priority   = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface AmbCall {
  id: string; callNo: string; status: CallStatus; priority: Priority;
  callerName: string | null; callerPhone: string | null;
  patientName: string | null; patientAge: number | null; patientGender: string | null;
  chiefComplaint: string | null; pickupLocation: string; destination: string | null;
  vehicleId: string | null; vehiclePlate: string | null; vehicleModel: string | null;
  driverId: string | null; driverName: string | null; paramedicName: string | null;
  callReceivedAt: string; dispatchedAt: string | null; onSceneAt: string | null;
  transportStartAt: string | null; atHospitalAt: string | null; clearedAt: string | null;
  responseTimeMin: number | null; sceneTimeMin: number | null; transportTimeMin: number | null;
  notes: string | null;
}
interface AmbStats { callReceived: number; dispatched: number; onScene: number; transporting: number; atHospital: number; cleared: number; avgResponseMin: number }
interface Vehicle  { id: string; plate_number: string; model: string; status: string }
interface Driver   { id: string; first_name: string; last_name: string }

// ── Config ────────────────────────────────────────────────────────────────────
const STAGE_CFG: Record<CallStatus, { label: string; icon: string; color: string; bg: string; border: string; next: string }> = {
  CALL_RECEIVED: { label: 'Call Received', icon: '📞', color: 'text-sky-300',     bg: 'bg-sky-500/10',     border: 'border-sky-500/30',     next: 'Dispatch'     },
  DISPATCHED:    { label: 'Dispatched',    icon: '🚑', color: 'text-amber-300',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   next: 'On Scene'     },
  ON_SCENE:      { label: 'On Scene',      icon: '🏥', color: 'text-orange-300',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  next: 'Transporting' },
  TRANSPORTING:  { label: 'Transporting',  icon: '🏎️', color: 'text-purple-300',  bg: 'bg-purple-500/10',  border: 'border-purple-500/30',  next: 'At Hospital'  },
  AT_HOSPITAL:   { label: 'At Hospital',   icon: '🏨', color: 'text-blue-300',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    next: 'Clear'        },
  CLEARED:       { label: 'Cleared',       icon: '✅', color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', next: ''             },
};

const PRIORITY_CFG: Record<Priority, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: 'CRITICAL', color: 'text-red-300',    bg: 'bg-red-500/20',    border: 'border-red-500/40'    },
  HIGH:     { label: 'HIGH',     color: 'text-orange-300', bg: 'bg-orange-500/20', border: 'border-orange-500/40' },
  MEDIUM:   { label: 'MEDIUM',   color: 'text-amber-300',  bg: 'bg-amber-500/20',  border: 'border-amber-500/40'  },
  LOW:      { label: 'LOW',      color: 'text-slate-300',  bg: 'bg-slate-500/20',  border: 'border-slate-500/30'  },
};

// ── Timer ─────────────────────────────────────────────────────────────────────
function ElapsedTimer({ from }: { from: string }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    function update() {
      const ms = Date.now() - new Date(from).getTime();
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setElapsed(m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m ${s}s`);
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [from]);
  return <span>{elapsed}</span>;
}

// ── New Call Modal ─────────────────────────────────────────────────────────────
function NewCallModal({ vehicles, drivers, onClose, onCreated }: {
  vehicles: Vehicle[]; drivers: Driver[];
  onClose: () => void; onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const [form,   setForm]   = useState({
    priority: 'HIGH' as Priority, callerName: '', callerPhone: '',
    patientName: '', patientAge: '', patientGender: 'MALE',
    chiefComplaint: '', pickupLocation: '', destination: '',
    vehicleId: '', driverId: '', paramedicName: '', notes: '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.pickupLocation.trim()) { setErr('Pickup location is required'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/ambulance/calls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form, patientAge: form.patientAge ? Number(form.patientAge) : null,
          vehicleId: form.vehicleId || null, driverId: form.driverId || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); setErr(d.error ?? 'Failed'); return; }
      onCreated();
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  }

  const avail = vehicles.filter(v => v.status === 'AVAILABLE');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-white font-semibold">New Emergency Call</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Priority */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block">Priority</label>
            <div className="flex gap-2">
              {(['CRITICAL','HIGH','MEDIUM','LOW'] as Priority[]).map(p => {
                const c = PRIORITY_CFG[p];
                return (
                  <button key={p} onClick={() => setForm(f => ({ ...f, priority: p }))}
                    className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-all ${
                      form.priority === p ? `${c.bg} ${c.color} ${c.border}` : 'bg-slate-800 text-slate-500 border-white/10'
                    }`}>
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Caller */}
          <div>
            <p className="text-xs text-red-400 font-semibold uppercase tracking-wider mb-2">Caller Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Caller Name</label>
                <input value={form.callerName} onChange={set('callerName')} placeholder="Name"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/40" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Caller Phone</label>
                <input value={form.callerPhone} onChange={set('callerPhone')} placeholder="+971 50 000 0000"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/40" />
              </div>
            </div>
          </div>

          {/* Incident */}
          <div>
            <p className="text-xs text-red-400 font-semibold uppercase tracking-wider mb-2">Incident Details</p>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Pickup Location *</label>
                <input value={form.pickupLocation} onChange={set('pickupLocation')} placeholder="Street / building / landmark"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/40" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Chief Complaint / Incident</label>
                <input value={form.chiefComplaint} onChange={set('chiefComplaint')} placeholder="e.g. Chest pain, RTA, fall…"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/40" />
              </div>
            </div>
          </div>

          {/* Patient */}
          <div>
            <p className="text-xs text-red-400 font-semibold uppercase tracking-wider mb-2">Patient</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-slate-400">Name</label>
                <input value={form.patientName} onChange={set('patientName')} placeholder="Patient name"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Age</label>
                <input type="number" value={form.patientAge} onChange={set('patientAge')} placeholder="—" min="0" max="120"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none" />
              </div>
            </div>
          </div>

          {/* Ambulance */}
          <div>
            <p className="text-xs text-red-400 font-semibold uppercase tracking-wider mb-2">Assign Ambulance</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Ambulance ({avail.length} available)</label>
                <select value={form.vehicleId} onChange={set('vehicleId')}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                  <option value="">— Assign later —</option>
                  {avail.map(v => <option key={v.id} value={v.id}>{v.plate_number} · {v.model}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Driver</label>
                <select value={form.driverId} onChange={set('driverId')}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                  <option value="">— Assign later —</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.first_name} {d.last_name}</option>)}
                </select>
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-slate-400">Paramedic / Crew</label>
                <input value={form.paramedicName} onChange={set('paramedicName')} placeholder="Paramedic name"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none" />
              </div>
            </div>
          </div>

          {err && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="px-6 pb-5 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-lg border border-white/10 transition-colors">Cancel</button>
          <button onClick={save} disabled={saving}
            className="text-sm font-bold bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg transition-colors">
            {saving ? 'Logging…' : '🚑 Log Call'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Call Card ─────────────────────────────────────────────────────────────────
function CallCard({ call, onAdvance, onSelect }: { call: AmbCall; onAdvance: (id: string) => void; onSelect: (c: AmbCall) => void }) {
  const stage = STAGE_CFG[call.status];
  const prio  = PRIORITY_CFG[call.priority];
  const isCritical = call.priority === 'CRITICAL' || call.priority === 'HIGH';

  return (
    <div onClick={() => onSelect(call)}
      className={`rounded-2xl border p-4 cursor-pointer transition-all hover:scale-[1.01] ${stage.bg} ${stage.border} ${
        isCritical && call.status !== 'CLEARED' ? 'ring-1 ring-red-500/20' : ''
      }`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-white font-bold text-sm">{call.callNo}</p>
          <p className="text-slate-400 text-xs mt-0.5">{stage.icon} {stage.label}</p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${prio.bg} ${prio.color} ${prio.border}`}>
          {prio.label}
        </span>
      </div>

      <div className="space-y-1.5 text-xs mb-3">
        <div className="flex items-start gap-2">
          <span className="text-slate-500 flex-shrink-0">📍</span>
          <span className="text-slate-200 line-clamp-2">{call.pickupLocation}</span>
        </div>
        {call.chiefComplaint && (
          <div className="flex items-start gap-2">
            <span className="text-slate-500 flex-shrink-0">🩺</span>
            <span className="text-slate-300 line-clamp-1">{call.chiefComplaint}</span>
          </div>
        )}
        {(call.patientName || call.patientAge) && (
          <div className="flex items-center gap-2">
            <span className="text-slate-500">👤</span>
            <span className="text-slate-300">{call.patientName ?? 'Unknown'}{call.patientAge ? `, ${call.patientAge}y` : ''}</span>
          </div>
        )}
        {call.vehiclePlate && (
          <div className="flex items-center gap-2">
            <span className="text-slate-500">🚑</span>
            <span className="text-slate-300">{call.vehiclePlate} {call.driverName ? `· ${call.driverName}` : ''}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs font-mono ${isCritical && call.status !== 'CLEARED' ? 'text-red-400' : 'text-slate-500'}`}>
          ⏱ <ElapsedTimer from={call.callReceivedAt} />
        </span>
        {call.status !== 'CLEARED' && (
          <button onClick={e => { e.stopPropagation(); onAdvance(call.id); }}
            className="text-xs font-semibold bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-colors border border-white/10">
            → {stage.next}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AmbulancePage() {
  const [calls,    setCalls]    = useState<AmbCall[]>([]);
  const [stats,    setStats]    = useState<AmbStats>({ callReceived: 0, dispatched: 0, onScene: 0, transporting: 0, atHospital: 0, cleared: 0, avgResponseMin: 0 });
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers,  setDrivers]  = useState<Driver[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [showNew,  setShowNew]  = useState(false);
  const [selected, setSelected] = useState<AmbCall | null>(null);
  const [filter,   setFilter]   = useState<CallStatus | 'ALL'>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ambulance/calls', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        setCalls(d.calls ?? []);
        setStats(d.stats ?? stats);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    Promise.all([
      fetch('/api/vehicles?usage=AMBULANCE&limit=50').then(r => r.ok ? r.json() : null),
      fetch('/api/drivers?limit=100').then(r => r.ok ? r.json() : null),
    ]).then(([vd, dd]) => {
      if (vd) setVehicles(Array.isArray(vd) ? vd : vd.data ?? []);
      if (dd) setDrivers(Array.isArray(dd) ? dd : dd.data ?? dd.drivers ?? []);
    }).catch(() => {});
  }, []);

  async function advance(id: string) {
    setAdvancing(id);
    try {
      const res = await fetch(`/api/ambulance/calls/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advance' }),
      });
      if (res.ok) { const d = await res.json(); setCalls(cs => cs.map(c => c.id === id ? { ...c, status: d.newStatus } : c)); }
    } catch { /* silent */ }
    finally { setAdvancing(null); load(); }
  }

  const active  = calls.filter(c => c.status !== 'CLEARED');
  const avail   = vehicles.filter(v => v.status === 'AVAILABLE').length;
  const filtered = filter === 'ALL' ? calls : calls.filter(c => c.status === filter);
  const byStage = Object.keys(STAGE_CFG) as CallStatus[];

  // Kanban: group active calls by stage (excluding CLEARED)
  const kanbanStages: CallStatus[] = ['CALL_RECEIVED', 'DISPATCHED', 'ON_SCENE', 'TRANSPORTING', 'AT_HOSPITAL'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Ambulance Dispatch</h1>
          <p className="text-slate-400 text-sm mt-0.5">Emergency response tracking · CALL → DISPATCH → SCENE → HOSPITAL → CLEAR</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${
            avail > 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${avail > 0 ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {avail} ambulance{avail !== 1 ? 's' : ''} available
          </div>
          <button onClick={() => setShowNew(true)}
            className="text-sm font-bold bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2">
            🚨 New Call
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
        {[
          { label: 'Calls',      value: stats.callReceived,  color: 'text-sky-300',     icon: '📞' },
          { label: 'Dispatched', value: stats.dispatched,    color: 'text-amber-300',   icon: '🚑' },
          { label: 'On Scene',   value: stats.onScene,       color: 'text-orange-300',  icon: '🏥' },
          { label: 'Transport',  value: stats.transporting,  color: 'text-purple-300',  icon: '🏎️' },
          { label: 'Hospital',   value: stats.atHospital,    color: 'text-blue-300',    icon: '🏨' },
          { label: 'Cleared',    value: stats.cleared,       color: 'text-emerald-300', icon: '✅' },
          { label: 'Avg Resp',   value: `${stats.avgResponseMin}m`, color: stats.avgResponseMin <= 8 ? 'text-emerald-300' : stats.avgResponseMin <= 15 ? 'text-amber-300' : 'text-red-400', icon: '⏱' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 border border-white/10 rounded-xl p-3 text-center">
            <p className="text-xs text-slate-500">{s.icon}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Kanban board — active calls */}
      {active.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-3">Active Calls ({active.length})</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {kanbanStages.map(stage => {
              const stageCalls = calls.filter(c => c.status === stage);
              const cfg = STAGE_CFG[stage];
              return (
                <div key={stage} className="space-y-3">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                    <span>{cfg.icon}</span>
                    <span>{cfg.label}</span>
                    <span className="ml-auto opacity-60">{stageCalls.length}</span>
                  </div>
                  {stageCalls.length === 0
                    ? <div className="border border-dashed border-white/10 rounded-xl p-4 text-center text-xs text-slate-600">No calls</div>
                    : stageCalls.map(c => (
                        <CallCard key={c.id} call={c} onAdvance={id => { setAdvancing(id); advance(id); }} onSelect={setSelected} />
                      ))
                  }
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All calls table */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Call Log</p>
          <div className="flex gap-1">
            {(['ALL', ...byStage] as const).map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  filter === s
                    ? s === 'ALL' ? 'bg-slate-700 text-white border-white/20' : `${STAGE_CFG[s as CallStatus].bg} ${STAGE_CFG[s as CallStatus].color} ${STAGE_CFG[s as CallStatus].border}`
                    : 'bg-slate-800/60 text-slate-500 border-white/10 hover:text-slate-300'
                }`}>
                {s === 'ALL' ? 'All' : STAGE_CFG[s as CallStatus].icon}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="animate-pulse p-4 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded-xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-5xl mb-3">🚑</div>
              <p className="text-slate-400 text-sm">No calls logged yet</p>
              <button onClick={() => setShowNew(true)}
                className="mt-4 text-sm font-bold bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl transition-colors">
                🚨 Log First Call
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wider">
                    <th className="text-left px-5 py-3">Call No.</th>
                    <th className="text-left px-3 py-3">Priority</th>
                    <th className="text-left px-3 py-3">Location</th>
                    <th className="text-left px-3 py-3">Complaint</th>
                    <th className="text-left px-3 py-3">Ambulance</th>
                    <th className="text-left px-3 py-3">Status</th>
                    <th className="text-left px-3 py-3">Response</th>
                    <th className="text-left px-3 py-3">Elapsed</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map(c => {
                    const stg = STAGE_CFG[c.status];
                    const pri = PRIORITY_CFG[c.priority];
                    return (
                      <tr key={c.id} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => setSelected(c)}>
                        <td className="px-5 py-3 font-mono text-xs text-white">{c.callNo}</td>
                        <td className="px-3 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${pri.bg} ${pri.color} ${pri.border}`}>{pri.label}</span>
                        </td>
                        <td className="px-3 py-3 text-slate-300 max-w-[180px] truncate">{c.pickupLocation}</td>
                        <td className="px-3 py-3 text-slate-400 max-w-[160px] truncate">{c.chiefComplaint ?? '—'}</td>
                        <td className="px-3 py-3 text-xs">
                          {c.vehiclePlate
                            ? <span className="text-amber-300">{c.vehiclePlate}</span>
                            : <span className="text-slate-600">Unassigned</span>}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${stg.bg} ${stg.color} ${stg.border}`}>
                            {stg.icon} {stg.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-400">
                          {c.responseTimeMin != null ? `${c.responseTimeMin}m` : '—'}
                        </td>
                        <td className="px-3 py-3 text-xs font-mono text-slate-400">
                          {c.status !== 'CLEARED' ? <ElapsedTimer from={c.callReceivedAt} /> : '—'}
                        </td>
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          {c.status !== 'CLEARED' && (
                            <button disabled={advancing === c.id} onClick={() => advance(c.id)}
                              className="text-xs font-semibold bg-white/10 hover:bg-white/20 text-white px-2.5 py-1 rounded-lg transition-colors border border-white/10 disabled:opacity-40">
                              {advancing === c.id ? '…' : `→ ${stg.next}`}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div className="w-full max-w-sm h-full bg-slate-900 border-l border-white/10 overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-white font-bold">{selected.callNo}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STAGE_CFG[selected.status].bg} ${STAGE_CFG[selected.status].color} ${STAGE_CFG[selected.status].border}`}>
                  {STAGE_CFG[selected.status].icon} {STAGE_CFG[selected.status].label}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4 text-sm">
              {/* Timeline */}
              <div>
                <p className="text-xs text-red-400 uppercase tracking-wider font-semibold mb-2">Timeline</p>
                {[
                  { label: 'Call Received', ts: selected.callReceivedAt },
                  { label: 'Dispatched',   ts: selected.dispatchedAt },
                  { label: 'On Scene',     ts: selected.onSceneAt },
                  { label: 'Transporting', ts: selected.transportStartAt },
                  { label: 'At Hospital',  ts: selected.atHospitalAt },
                  { label: 'Cleared',      ts: selected.clearedAt },
                ].map(t => (
                  <div key={t.label} className={`flex items-center gap-3 py-1.5 ${!t.ts ? 'opacity-30' : ''}`}>
                    <span className={`w-2 h-2 rounded-full ${t.ts ? 'bg-red-400' : 'bg-slate-700'}`} />
                    <span className="text-slate-300 text-xs flex-1">{t.label}</span>
                    <span className="text-slate-500 text-xs font-mono">
                      {t.ts ? new Date(t.ts).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {/* Details */}
              {[
                ['Priority',      PRIORITY_CFG[selected.priority].label],
                ['Location',      selected.pickupLocation],
                ['Complaint',     selected.chiefComplaint],
                ['Patient',       `${selected.patientName ?? 'Unknown'}${selected.patientAge ? `, ${selected.patientAge}y` : ''}`],
                ['Destination',   selected.destination],
                ['Ambulance',     selected.vehiclePlate],
                ['Driver',        selected.driverName],
                ['Paramedic',     selected.paramedicName],
                ['Caller',        selected.callerName ? `${selected.callerName} · ${selected.callerPhone}` : selected.callerPhone],
                ['Response Time', selected.responseTimeMin != null ? `${selected.responseTimeMin} min` : null],
                ['Notes',         selected.notes],
              ].map(([label, val]) => val ? (
                <div key={label as string} className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-500 text-xs">{label}</span>
                  <span className="text-slate-200 text-xs text-right max-w-[60%]">{val}</span>
                </div>
              ) : null)}
            </div>
            {selected.status !== 'CLEARED' && (
              <div className="px-5 pb-6">
                <button onClick={() => { advance(selected.id); setSelected(null); }}
                  className="w-full font-bold bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl transition-colors">
                  → Advance to {STAGE_CFG[selected.status].next}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showNew && (
        <NewCallModal
          vehicles={vehicles} drivers={drivers}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
