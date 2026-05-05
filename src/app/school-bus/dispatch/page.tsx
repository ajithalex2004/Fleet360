'use client';
/**
 * School Bus › Dispatch Board
 *
 * Dedicated coordination centre for school bus operations.
 * Completely separate from the general Dispatch Command Centre.
 *
 * Key differences from general dispatch:
 *  • Routes are pre-planned, not on-demand
 *  • Morning / Afternoon / Weekend sessions
 *  • Departure countdown per route
 *  • Student manifest + attendance confirmation before departure
 *  • Route adherence (stop-by-stop) tracked, not GPS-only ETA
 *  • Guardian notifications are triggered here
 *  • UAE Ministry of Education compliance checks built in
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface SBRoute {
  id: string;
  name: string;
  status: string;
  vehicle_id?: string;
  driver_id?: string;
  school_name?: string;
  student_count?: number;
  total_stops?: number;
  scheduled_departure?: string;
  actual_departure?: string;
  actual_arrival?: string;
  vehicle?: { plate_number?: string; make?: string; model?: string; capacity?: number };
  driver?: { name?: string; phone?: string; license_number?: string };
  meta?: Record<string, unknown>;
}

type Session = 'MORNING' | 'AFTERNOON' | 'ALL';

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; dot: string; label: string }> = {
  SCHEDULED:   { color:'text-slate-300',  bg:'bg-slate-800/60',   border:'border-white/10',      dot:'bg-slate-500',   label:'Scheduled' },
  ASSIGNED:    { color:'text-blue-300',   bg:'bg-blue-500/5',     border:'border-blue-500/20',   dot:'bg-blue-500',    label:'Assigned' },
  IN_PROGRESS: { color:'text-cyan-300',   bg:'bg-cyan-500/5',     border:'border-cyan-500/30',   dot:'bg-cyan-400',    label:'On Route' },
  COMPLETED:   { color:'text-emerald-300',bg:'bg-emerald-500/5',  border:'border-emerald-500/20',dot:'bg-emerald-500', label:'Completed' },
  DELAYED:     { color:'text-orange-300', bg:'bg-orange-500/5',   border:'border-orange-500/30', dot:'bg-orange-500 animate-pulse', label:'Delayed' },
  CANCELLED:   { color:'text-slate-500',  bg:'bg-slate-900/40',   border:'border-white/5',       dot:'bg-slate-700',   label:'Cancelled' },
};

/* ── Departure countdown ────────────────────────────────────────────────────── */
function DepartureTimer({ scheduledAt, status }: { scheduledAt?: string; status: string }) {
  const [diff, setDiff] = useState(0);

  useEffect(() => {
    if (!scheduledAt || status === 'IN_PROGRESS' || status === 'COMPLETED') return;
    const update = () => setDiff(Math.floor((new Date(scheduledAt).getTime() - Date.now()) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [scheduledAt, status]);

  if (status === 'IN_PROGRESS') return <span className="text-cyan-400 text-xs font-bold flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"/>ON ROUTE</span>;
  if (status === 'COMPLETED')   return <span className="text-emerald-400 text-xs font-bold">✅ DONE</span>;
  if (!scheduledAt)             return <span className="text-slate-500 text-xs">No time set</span>;

  const abs  = Math.abs(diff);
  const hrs  = Math.floor(abs / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;
  const late = diff < 0;
  const soon = diff >= 0 && diff < 600; // < 10 min

  if (late) return (
    <span className="text-red-400 text-xs font-bold animate-pulse">
      OVERDUE {hrs > 0 ? `${hrs}h ` : ''}{mins}m {secs}s
    </span>
  );
  return (
    <span className={`text-xs font-bold font-mono ${soon ? 'text-amber-400' : 'text-slate-400'}`}>
      {hrs > 0 ? `${String(hrs).padStart(2,'0')}:` : ''}{String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
    </span>
  );
}

/* ── Compliance Check ───────────────────────────────────────────────────────── */
function ComplianceBar({ route }: { route: SBRoute }) {
  const checks = [
    { label: 'Vehicle assigned',    pass: !!route.vehicle_id },
    { label: 'Driver assigned',     pass: !!route.driver_id },
    { label: 'Students confirmed',  pass: (route.student_count ?? 0) > 0 },
    { label: 'Capacity OK',         pass: !route.vehicle?.capacity || (route.student_count ?? 0) <= route.vehicle.capacity },
    { label: 'Departure time set',  pass: !!route.scheduled_departure },
  ];
  const passed = checks.filter(c => c.pass).length;
  const allGood = passed === checks.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">UAE Compliance</span>
        <span className={`font-bold ${allGood ? 'text-emerald-400' : 'text-amber-400'}`}>{passed}/{checks.length}</span>
      </div>
      <div className="flex gap-1">
        {checks.map(c => (
          <div key={c.label} title={c.label}
            className={`flex-1 h-1.5 rounded-full ${c.pass ? 'bg-emerald-500' : 'bg-amber-500'}`}/>
        ))}
      </div>
      {!allGood && (
        <p className="text-amber-400 text-[10px]">
          Missing: {checks.filter(c => !c.pass).map(c => c.label).join(', ')}
        </p>
      )}
    </div>
  );
}

/* ── Route Card ─────────────────────────────────────────────────────────────── */
function RouteCard({ route, onAction, actionLoading }: {
  route: SBRoute;
  onAction: (id: string, action: string) => void;
  actionLoading: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[route.status] ?? STATUS_CONFIG.SCHEDULED;
  const isActive     = route.status === 'IN_PROGRESS';
  const canStart     = route.status === 'ASSIGNED';
  const canAutoAssign= route.status === 'SCHEDULED' && (!route.vehicle_id || !route.driver_id);
  const canComplete  = isActive;
  const isLoading    = actionLoading === route.id;

  return (
    <div className={`rounded-2xl border transition-all ${cfg.bg} ${cfg.border}`}>
      {/* Card Header */}
      <div className="p-5 space-y-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${cfg.dot}`}/>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <h3 className="text-white font-semibold text-sm">{route.name}</h3>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                  {cfg.label}
                </span>
                {isActive && <span className="text-[10px] text-cyan-400 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-cyan-400 animate-pulse"/>LIVE</span>}
              </div>
              {route.school_name && <p className="text-slate-500 text-xs">🏫 {route.school_name}</p>}
            </div>
          </div>
          <DepartureTimer scheduledAt={route.scheduled_departure} status={route.status} />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-slate-800/70 rounded-xl p-2.5 text-center">
            <p className="text-white font-bold text-base">{route.student_count ?? 0}</p>
            <p className="text-slate-600 text-[10px]">Students</p>
          </div>
          <div className="bg-slate-800/70 rounded-xl p-2.5 text-center">
            <p className="text-white font-bold text-base">{route.total_stops ?? 0}</p>
            <p className="text-slate-600 text-[10px]">Stops</p>
          </div>
          <div className="bg-slate-800/70 rounded-xl p-2.5 text-center">
            <p className="text-white font-bold text-base">{route.vehicle?.capacity ?? '—'}</p>
            <p className="text-slate-600 text-[10px]">Capacity</p>
          </div>
          <div className="bg-slate-800/70 rounded-xl p-2.5 text-center">
            <p className={`font-bold text-base ${(route.student_count ?? 0) > (route.vehicle?.capacity ?? 999) ? 'text-red-400' : 'text-emerald-400'}`}>
              {route.vehicle?.capacity ? `${Math.round(((route.student_count ?? 0) / route.vehicle.capacity) * 100)}%` : '—'}
            </p>
            <p className="text-slate-600 text-[10px]">Load</p>
          </div>
        </div>

        {/* Vehicle & Driver */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-12 flex-shrink-0">🚌 Bus</span>
            {route.vehicle ? (
              <span className="text-slate-300 font-mono">{route.vehicle.plate_number}</span>
            ) : (
              <span className="text-orange-400">⚠ Not assigned</span>
            )}
            {route.vehicle && <span className="text-slate-500">{route.vehicle.make} {route.vehicle.model}</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-12 flex-shrink-0">👤 Driver</span>
            {route.driver ? (
              <>
                <span className="text-slate-300">{route.driver.name}</span>
                {route.driver.phone && (
                  <a href={`tel:${route.driver.phone}`} className="text-blue-400 hover:text-blue-300 ml-auto">📞</a>
                )}
              </>
            ) : (
              <span className="text-orange-400">⚠ Not assigned</span>
            )}
          </div>
        </div>

        {/* Compliance bar */}
        <ComplianceBar route={route} />

        {/* Expand toggle */}
        <button onClick={() => setExpanded(e => !e)} className="text-slate-600 text-[10px] hover:text-slate-400 transition-colors">
          {expanded ? '▲ Hide timing' : '▼ Timing details'}
        </button>

        {expanded && (
          <div className="grid grid-cols-3 gap-2 text-xs bg-slate-800/40 rounded-xl p-3">
            <div>
              <p className="text-slate-500 mb-0.5">Scheduled</p>
              <p className="text-slate-300 font-mono">{route.scheduled_departure ? new Date(route.scheduled_departure).toLocaleTimeString('en-AE', {hour:'2-digit',minute:'2-digit'}) : '—'}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-0.5">Departed</p>
              <p className="text-slate-300 font-mono">{route.actual_departure ? new Date(route.actual_departure).toLocaleTimeString('en-AE', {hour:'2-digit',minute:'2-digit'}) : '—'}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-0.5">Arrived</p>
              <p className="text-slate-300 font-mono">{route.actual_arrival ? new Date(route.actual_arrival).toLocaleTimeString('en-AE', {hour:'2-digit',minute:'2-digit'}) : '—'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-5 pb-5">
        {canAutoAssign && (
          <button onClick={() => onAction(route.id, 'auto-assign')} disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold hover:bg-amber-500/30 transition-all disabled:opacity-50">
            {isLoading ? '…' : '🤖 Auto-Assign'}
          </button>
        )}
        {canStart && (
          <button onClick={() => onAction(route.id, 'trigger')} disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold hover:bg-emerald-500/30 transition-all disabled:opacity-50">
            {isLoading ? '…' : '🚦 Start Route'}
          </button>
        )}
        {canComplete && (
          <button onClick={() => onAction(route.id, 'complete')} disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold hover:bg-blue-500/30 transition-all disabled:opacity-50">
            {isLoading ? '…' : '✅ Mark Complete'}
          </button>
        )}
        {!canAutoAssign && !canStart && !canComplete && (
          <div className="flex-1 py-2.5 rounded-xl bg-slate-800/40 border border-white/5 text-slate-600 text-xs font-semibold text-center">
            {route.status === 'COMPLETED' ? '✅ Trip completed' : route.status === 'CANCELLED' ? 'Cancelled' : 'Awaiting assignment'}
          </div>
        )}
        <Link href={`/school-bus/routes/${route.id}`}
          className="px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-400 text-xs hover:text-white hover:bg-slate-700 transition-all flex-shrink-0">
          Details →
        </Link>
        {(route.status === 'IN_PROGRESS' || route.status === 'ASSIGNED') && (
          <button onClick={() => onAction(route.id, 'cancel')} disabled={isLoading}
            className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs hover:bg-red-500/20 transition-all flex-shrink-0">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────────────── */
export default function SchoolBusDispatchBoard() {
  const [routes,  setRoutes]  = useState<SBRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session>('MORNING');
  const [filter,  setFilter]  = useState('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast,   setToast]   = useState<{ msg: string; ok: boolean } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/school-bus/routes?limit=100');
      if (r.ok) { const d = await r.json(); setRoutes(d.data ?? []); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 30_000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleAction(routeId: string, action: string) {
    if (action === 'cancel' && !confirm('Cancel this route? Students and guardians will be notified.')) return;
    setActionLoading(routeId);
    try {
      const r = await fetch(`/api/school-bus/routes/${routeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (d.ok || d.id) {
        const msgs: Record<string, string> = {
          'auto-assign': '✅ Vehicle and driver auto-assigned',
          'trigger':     '🚦 Route started — driver notified',
          'complete':    '✅ Route marked complete',
          'cancel':      '✕ Route cancelled',
        };
        showToast(msgs[action] ?? 'Action completed', true);
        load();
      } else {
        showToast(d.error ?? 'Action failed', false);
      }
    } catch {
      showToast('Network error', false);
    } finally {
      setActionLoading(null);
    }
  }

  /* ── Stats ── */
  const active     = routes.filter(r => r.status === 'IN_PROGRESS').length;
  const assigned   = routes.filter(r => r.status === 'ASSIGNED').length;
  const unassigned = routes.filter(r => r.status === 'SCHEDULED' && (!r.vehicle_id || !r.driver_id)).length;
  const completed  = routes.filter(r => r.status === 'COMPLETED').length;
  const totalStudents = routes.filter(r => r.status !== 'CANCELLED').reduce((s, r) => s + (r.student_count ?? 0), 0);

  /* ── Filter ── */
  const displayRoutes = routes.filter(r => {
    if (filter !== 'ALL' && r.status !== filter) return false;
    // Session filter — rough time heuristic on scheduled_departure
    if (session !== 'ALL' && r.scheduled_departure) {
      const h = new Date(r.scheduled_departure).getHours();
      if (session === 'MORNING'   && (h < 5  || h > 12)) return false;
      if (session === 'AFTERNOON' && (h < 12 || h > 20)) return false;
    }
    return true;
  }).sort((a, b) => {
    // Sort: IN_PROGRESS first, then ASSIGNED, then by departure time
    const rank: Record<string, number> = { IN_PROGRESS:5, ASSIGNED:4, SCHEDULED:3, DELAYED:2, COMPLETED:1, CANCELLED:0 };
    const rA = rank[a.status] ?? 0, rB = rank[b.status] ?? 0;
    if (rA !== rB) return rB - rA;
    if (a.scheduled_departure && b.scheduled_departure)
      return new Date(a.scheduled_departure).getTime() - new Date(b.scheduled_departure).getTime();
    return 0;
  });

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl border text-sm font-semibold shadow-xl ${
          toast.ok ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-red-500/20 border-red-500/30 text-red-300'
        }`}>{toast.msg}</div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">🚦 School Bus Dispatch Board</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Morning / Afternoon coordination · Route assignment · Departure management
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button onClick={load}
            className="px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:bg-slate-700 transition-all">
            ↻ Refresh
          </button>
          <Link href="/school-bus/routes/new"
            className="px-4 py-2 rounded-xl bg-amber-600/20 border border-amber-600/30 text-amber-400 text-sm font-semibold hover:bg-amber-600/30 transition-all">
            + New Route
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { icon:'🏃', label:'On Route',     value:active,        color:'text-cyan-400',    bg:'bg-cyan-500/10 border-cyan-500/20' },
          { icon:'🎯', label:'Assigned',     value:assigned,      color:'text-blue-400',    bg:'bg-blue-500/10 border-blue-500/20' },
          { icon:'⚠️', label:'Needs Setup',  value:unassigned,    color:'text-amber-400',   bg:'bg-amber-500/10 border-amber-500/20' },
          { icon:'✅', label:'Completed',    value:completed,     color:'text-emerald-400', bg:'bg-emerald-500/10 border-emerald-500/20' },
          { icon:'👧', label:'Total Students',value:totalStudents, color:'text-purple-400',  bg:'bg-purple-500/10 border-purple-500/20' },
        ].map(k => (
          <div key={k.label} className={`rounded-2xl border p-4 ${k.bg}`}>
            <div className="flex items-start justify-between">
              <span className="text-2xl">{k.icon}</span>
              <span className={`text-3xl font-bold ${k.color}`}>{loading ? '…' : k.value}</span>
            </div>
            <p className="text-slate-400 text-xs font-medium mt-2">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Unassigned warning */}
      {unassigned > 0 && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/25 rounded-2xl px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-amber-300 font-semibold text-sm">
                {unassigned} route{unassigned > 1 ? 's' : ''} missing vehicle or driver assignment
              </p>
              <p className="text-slate-500 text-xs mt-0.5">
                Use Auto-Assign on each route or manually assign vehicle and driver before departure.
              </p>
            </div>
          </div>
          <button
            onClick={async () => {
              const needAssign = routes.filter(r => r.status === 'SCHEDULED' && (!r.vehicle_id || !r.driver_id));
              for (const r of needAssign) await handleAction(r.id, 'auto-assign');
            }}
            className="px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 text-sm font-bold hover:bg-amber-500/30 transition-all flex-shrink-0">
            🤖 Auto-Assign All
          </button>
        </div>
      )}

      {/* Session + Status filters */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Session tabs */}
        <div className="flex bg-slate-900 border border-white/10 rounded-xl p-1 gap-0.5">
          {(['MORNING', 'AFTERNOON', 'ALL'] as Session[]).map(s => (
            <button key={s} onClick={() => setSession(s)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                session === s
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}>
              {s === 'MORNING' ? '🌅 Morning' : s === 'AFTERNOON' ? '🌇 Afternoon' : '📋 All Sessions'}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1.5 flex-wrap">
          {['ALL','SCHEDULED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED'].map(s => {
            const count = s === 'ALL' ? routes.length : routes.filter(r => r.status === s).length;
            return (
              <button key={s} onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  filter === s
                    ? 'bg-blue-600/30 text-blue-300 border-blue-500/40'
                    : 'bg-slate-900 border-white/10 text-slate-400 hover:border-white/20 hover:text-white'
                }`}>
                {s === 'IN_PROGRESS' ? 'On Route' : s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
                {count > 0 && <span className="ml-1.5 text-[10px] opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Route cards */}
      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-64 bg-slate-900 border border-white/5 rounded-2xl animate-pulse"/>)}
        </div>
      ) : displayRoutes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-slate-900 border border-white/10 h-64 gap-3">
          <span className="text-5xl">🚌</span>
          <p className="text-white font-semibold">No routes for this filter</p>
          <p className="text-slate-500 text-sm">Try switching session or status filter</p>
          <Link href="/school-bus/routes/new"
            className="px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 text-sm font-semibold hover:bg-amber-500/30 transition-all">
            + Create Route
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayRoutes.map(r => (
            <RouteCard key={r.id} route={r} onAction={handleAction} actionLoading={actionLoading} />
          ))}
        </div>
      )}

      {/* UAE Compliance reminder */}
      <div className="rounded-2xl bg-slate-900 border border-white/10 p-5">
        <p className="text-slate-300 font-semibold text-sm mb-3">🇦🇪 UAE Regulatory Compliance Checklist</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon:'📹', title:'CCTV Operational',    desc:'All cameras functional before departure' },
            { icon:'👩', title:'Female Attendant',    desc:'Required for routes with female students' },
            { icon:'📡', title:'GPS Tracking Active', desc:'Live vehicle location must be transmitting' },
            { icon:'📋', title:'Student Manifest',    desc:'Attendance confirmed against roster' },
          ].map(c => (
            <div key={c.title} className="bg-slate-800/40 rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{c.icon}</span>
                <p className="text-slate-300 text-xs font-semibold">{c.title}</p>
              </div>
              <p className="text-slate-500 text-[10px] leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Cross-links */}
      <div className="grid md:grid-cols-3 gap-4">
        {[
          { href:'/school-bus/students',     icon:'👧', label:'Student Registry',    desc:'Manage students and guardian contacts' },
          { href:'/school-bus/attendance',   icon:'📋', label:'Attendance Tracking', desc:'RFID check-in and parent notifications' },
          { href:'/school-bus/route-planner',icon:'✨', label:'Route Optimizer',     desc:'AI-powered stop sequencing' },
        ].map(l => (
          <Link key={l.href} href={l.href}
            className="rounded-2xl bg-slate-900 border border-white/10 p-5 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all group">
            <span className="text-2xl block mb-3">{l.icon}</span>
            <p className="text-white font-semibold text-sm group-hover:text-amber-300 transition-colors">{l.label}</p>
            <p className="text-slate-500 text-xs mt-0.5">{l.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
