'use client';
/**
 * Incidents › Ambulance › Dispatch Board
 *
 * Emergency ambulance dispatch control pulled from the Auto-Dispatch Engine.
 * Lives inside the Incident & Ambulance Management module because ambulance
 * operations are incident-driven, not demand-driven — every call creates a
 * patient record, hospital handover, and compliance trail that must be
 * co-located with incident data.
 *
 * Features:
 *  • 15-second auto-refresh (emergency SLA demands)
 *  • Live SLA response timer per call (P1 ≤ 8 min, P2 ≤ 15 min, P3 ≤ 45 min)
 *  • P1/EMERGENCY calls sorted to top with pulsing alert banner
 *  • Fleet availability panel (AVAILABLE / BUSY / OFF_DUTY)
 *  • One-click dispatch trigger → POST /api/dispatch/trigger
 *  • Direct link to the clinical call log (/incidents/ambulance)
 */
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import PlatformHomeBar from '@/components/PlatformHomeBar';

interface AmbCall {
  id: string;
  service_type: string;
  priority: string;
  status: string;
  origin_address?: string;
  destination_address?: string;
  origin_lat?: number;
  origin_lng?: number;
  passenger_count?: number;
  scheduled_pickup?: string;
  attempt_count: number;
  created_at: string;
  meta?: Record<string, unknown>;
}

interface AmbUnit {
  id: string;
  status: string;
  driver?: { name?: string; license_number?: string };
  vehicle?: { plate_number?: string; make?: string; model?: string; vehicle_type?: string };
  zone_id?: string;
}

/* ─────────────────────────────────────────────────────────────
   Priority configuration
───────────────────────────────────────────────────────────── */
const PRIORITY_CONFIG: Record<string, {
  label: string; color: string; bgColor: string;
  border: string; icon: string; desc: string; slaMin: number;
}> = {
  P1:        { label:'P1 — CRITICAL',  color:'text-red-300',    bgColor:'bg-red-600/20',    border:'border-red-500/40',    icon:'🚨', desc:'Life-threatening · immediate response', slaMin: 8  },
  P2:        { label:'P2 — URGENT',    color:'text-orange-300', bgColor:'bg-orange-500/15', border:'border-orange-500/30', icon:'⚡', desc:'Serious condition · rapid response',    slaMin: 15 },
  P3:        { label:'P3 — ROUTINE',   color:'text-yellow-300', bgColor:'bg-yellow-500/10', border:'border-yellow-500/20', icon:'📋', desc:'Non-emergency medical transport',       slaMin: 45 },
  EMERGENCY: { label:'EMERGENCY',      color:'text-red-200',    bgColor:'bg-red-700/25',    border:'border-red-600/50',    icon:'🆘', desc:'Multi-agency emergency response',      slaMin: 5  },
};

/* ─────────────────────────────────────────────────────────────
   Live SLA timer
───────────────────────────────────────────────────────────── */
function SlaTimer({ createdAt, priority }: { createdAt: string; priority: string }) {
  const [elapsed, setElapsed] = useState(0);
  const slaMin = PRIORITY_CONFIG[priority]?.slaMin ?? 20;

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const pct  = Math.min(100, (mins / slaMin) * 100);
  const isCritical = mins >= slaMin;
  const isWarn     = mins >= Math.floor(slaMin * 0.7);

  return (
    <div className="flex flex-col items-end gap-0.5">
      <p className="text-[10px] text-slate-500">Response time · SLA {slaMin}m</p>
      <span className={`font-mono text-sm font-bold ${isCritical ? 'text-red-400 animate-pulse' : isWarn ? 'text-orange-400' : 'text-slate-300'}`}>
        {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
      </span>
      <div className="w-20 h-1 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-1 rounded-full transition-all ${isCritical ? 'bg-red-500' : isWarn ? 'bg-orange-400' : 'bg-green-500'}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Call card
───────────────────────────────────────────────────────────── */
function CallCard({ call, onDispatch }: { call: AmbCall; onDispatch: (id: string) => void }) {
  const cfg = PRIORITY_CONFIG[call.priority] ?? PRIORITY_CONFIG.P3;
  const isActive = ['PENDING','SEARCHING','OFFERED','RETRYING'].includes(call.status);

  return (
    <div className={`rounded-2xl border p-5 space-y-3 ${cfg.bgColor} ${cfg.border} transition-all hover:brightness-110`}>
      {/* Header: priority + SLA timer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{cfg.icon}</span>
          <div>
            <p className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</p>
            <p className="text-slate-500 text-[10px]">{cfg.desc}</p>
          </div>
        </div>
        {isActive && <SlaTimer createdAt={call.created_at} priority={call.priority} />}
      </div>

      {/* Status + ID */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
          call.status === 'IN_PROGRESS' ? 'bg-cyan-500/20 text-cyan-300' :
          call.status === 'COMPLETED'   ? 'bg-emerald-500/20 text-emerald-300' :
          call.status === 'FAILED'      ? 'bg-red-700/20 text-red-400' :
          isActive                      ? 'bg-blue-500/20 text-blue-300 animate-pulse' :
          'bg-slate-700 text-slate-400'
        }`}>{call.status}</span>
        <span className="text-slate-600 text-xs font-mono">{call.id.slice(0,10)}…</span>
        {call.attempt_count > 0 && (
          <span className="text-orange-400 text-xs">
            ↩ {call.attempt_count} attempt{call.attempt_count > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Locations */}
      <div className="space-y-1">
        <div className="flex items-start gap-2 text-xs">
          <span className="text-red-400 mt-0.5 flex-shrink-0">📍</span>
          <span className="text-slate-300">{call.origin_address ?? 'Location not specified'}</span>
        </div>
        {call.destination_address && (
          <div className="flex items-start gap-2 text-xs">
            <span className="text-emerald-400 mt-0.5 flex-shrink-0">🏥</span>
            <span className="text-slate-400">{call.destination_address}</span>
          </div>
        )}
      </div>

      {/* Dispatch button */}
      {isActive && (
        <button onClick={() => onDispatch(call.id)}
          className={`w-full py-2.5 rounded-xl border text-xs font-bold transition-all
            hover:brightness-125 ${cfg.bgColor} ${cfg.border} ${cfg.color}`}>
          🚑 Dispatch Nearest Unit
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Fleet unit card
───────────────────────────────────────────────────────────── */
function UnitCard({ unit }: { unit: AmbUnit }) {
  const isAvailable = unit.status === 'AVAILABLE';
  const isBusy      = unit.status === 'BUSY';
  return (
    <div className={`rounded-2xl border p-5 space-y-3 ${
      isAvailable ? 'bg-green-500/5 border-green-500/20' :
      isBusy      ? 'bg-cyan-500/5  border-cyan-500/20' :
      'bg-slate-900 border-white/10'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🚑</span>
          <div>
            <p className="text-white font-semibold text-sm">
              {unit.vehicle?.plate_number ?? 'Unassigned'}
            </p>
            <p className="text-slate-500 text-xs">
              {[unit.vehicle?.make, unit.vehicle?.model].filter(Boolean).join(' ') || 'Unknown vehicle'}
            </p>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
          isAvailable ? 'bg-green-500/20 text-green-400' :
          isBusy      ? 'bg-cyan-500/20 text-cyan-400' :
          'bg-slate-700 text-slate-400'
        }`}>{unit.status.replace('_',' ')}</span>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-16 flex-shrink-0">Paramedic</span>
          <span className="text-slate-300">{unit.driver?.name ?? '—'}</span>
        </div>
        {unit.zone_id && (
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-16 flex-shrink-0">Zone</span>
            <span className="text-slate-300 font-mono">{unit.zone_id}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */
export default function AmbulanceDispatchPage() {
  const [calls,   setCalls]   = useState<AmbCall[]>([]);
  const [units,   setUnits]   = useState<AmbUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<'active'|'all'|'fleet'>('active');
  const [toast,   setToast]   = useState<{ msg: string; ok: boolean } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  async function load() {
    try {
      const [callsRes, unitsRes] = await Promise.all([
        fetch('/api/dispatch/jobs?serviceType=AMBULANCE&limit=100').then(r => r.json()),
        fetch('/api/dispatch/availability?serviceType=AMBULANCE&limit=50').then(r => r.json()),
      ]);
      setCalls(callsRes.data ?? []);
      setUnits(unitsRes.data ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 15_000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function handleDispatch(jobId: string) {
    const r = await fetch('/api/dispatch/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, mode: 'AMBULANCE_PRIORITY' }),
    });
    const d = await r.json();
    setToast({ msg: d.ok ? '🚑 Ambulance dispatched successfully' : (d.error ?? 'Dispatch failed'), ok: !!d.ok });
    setTimeout(() => setToast(null), 4000);
    load();
  }

  const activeCalls    = calls.filter(c => ['PENDING','SEARCHING','OFFERED','RETRYING','IN_PROGRESS'].includes(c.status));
  const p1Calls        = activeCalls.filter(c => c.priority === 'P1' || c.priority === 'EMERGENCY');
  const availableUnits = units.filter(u => u.status === 'AVAILABLE');
  const busyUnits      = units.filter(u => u.status === 'BUSY');

  const sortedActive = [...activeCalls].sort((a, b) => {
    const rank: Record<string, number> = { EMERGENCY:5, P1:4, P2:3, URGENT:2, P3:1, NORMAL:0 };
    return (rank[b.priority] ?? 0) - (rank[a.priority] ?? 0);
  });

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-slate-950">
      <PlatformHomeBar
        moduleName="Ambulance Dispatch"
        moduleIcon="🚑"
        accentColor="from-red-600 to-rose-600"
      />

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {/* Toast */}
        {toast && (
          <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl border text-sm font-semibold shadow-xl ${
            toast.ok
              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/20 border-red-500/30 text-red-300'
          }`}>{toast.msg}</div>
        )}

        {/* P1 alert banner */}
        {p1Calls.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-red-600/20 border border-red-500/40 animate-pulse">
            <span className="text-2xl">🆘</span>
            <div className="flex-1">
              <p className="text-red-300 font-bold text-sm">
                {p1Calls.length} CRITICAL CALL{p1Calls.length > 1 ? 'S' : ''} REQUIRE IMMEDIATE RESPONSE
              </p>
              <p className="text-red-400/70 text-xs mt-0.5">
                P1 SLA: 8 minutes · EMERGENCY SLA: 5 minutes
              </p>
            </div>
            <span className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">🚑 Ambulance Dispatch Board</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Emergency response management · auto-refreshes every 15 seconds
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/incidents/ambulance"
              className="px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:bg-slate-700 transition-all">
              📋 Clinical Call Log
            </Link>
            <button onClick={load}
              className="px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:bg-slate-700 transition-all">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label:'Active Calls',    value: activeCalls.length,    color:'text-blue-400',   bg:'from-blue-600/15 to-blue-600/5',   icon:'📞' },
            { label:'P1 / Emergency',  value: p1Calls.length,        color:'text-red-400',    bg:'from-red-600/20 to-red-600/5',     icon:'🆘' },
            { label:'Units Available', value: availableUnits.length, color:'text-green-400',  bg:'from-green-600/15 to-green-600/5', icon:'✅' },
            { label:'On Active Calls', value: busyUnits.length,      color:'text-cyan-400',   bg:'from-cyan-600/15 to-cyan-600/5',   icon:'🚑' },
          ].map(k => (
            <div key={k.label} className={`rounded-2xl bg-gradient-to-br ${k.bg} border border-white/10 p-5`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">{k.icon}</span>
                <span className={`text-3xl font-bold ${k.color}`}>{loading ? '…' : k.value}</span>
              </div>
              <p className="text-slate-400 text-xs font-medium">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 border border-white/10 rounded-2xl p-1 w-fit">
          {([
            { id:'active', label: `Active Calls (${activeCalls.length})` },
            { id:'all',    label: 'All Calls' },
            { id:'fleet',  label: `Fleet (${units.length})` },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === t.id
                  ? 'bg-red-600/30 text-red-300 border border-red-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}>{t.label}</button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-500 text-sm">Loading…</div>
        ) : tab === 'active' ? (
          sortedActive.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <span className="text-5xl">✅</span>
              <p className="text-slate-400 font-medium">No active calls — all clear</p>
              <p className="text-slate-600 text-xs">New calls will appear here automatically</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedActive.map(c => (
                <CallCard key={c.id} call={c} onDispatch={handleDispatch} />
              ))}
            </div>
          )
        ) : tab === 'all' ? (
          <div className="rounded-2xl bg-slate-900 border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-500 text-xs">
                  <th className="px-5 py-3 text-left">Priority</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Origin</th>
                  <th className="px-4 py-3 text-left">Destination</th>
                  <th className="px-4 py-3 text-left">Attempts</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {calls.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500 text-sm">No calls found</td>
                  </tr>
                ) : calls.map(c => {
                  const cfg = PRIORITY_CONFIG[c.priority];
                  return (
                    <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold border
                          ${cfg?.bgColor ?? 'bg-slate-700'} ${cfg?.border ?? ''} ${cfg?.color ?? 'text-slate-400'}`}>
                          {cfg?.icon} {c.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{c.status}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs max-w-xs truncate">
                        {c.origin_address ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate">
                        {c.destination_address ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{c.attempt_count}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {new Date(c.created_at).toLocaleString('en-AE', {
                          month:'short', day:'numeric', hour:'2-digit', minute:'2-digit',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Fleet tab */
          units.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <span className="text-4xl">🚑</span>
              <p className="text-slate-500 text-sm">No ambulance units tracked</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {units.map(u => <UnitCard key={u.id} unit={u} />)}
            </div>
          )
        )}

        {/* Cross-link to clinical module */}
        <div className="rounded-2xl bg-rose-500/5 border border-rose-500/20 p-5 flex items-center justify-between">
          <div>
            <p className="text-rose-300 font-semibold text-sm">Clinical Call Log & Patient Records</p>
            <p className="text-slate-500 text-xs mt-0.5">
              Full CALL_RECEIVED → DISPATCHED → ON_SCENE → AT_HOSPITAL lifecycle,
              patient details, MOHAP/DHA compliance records
            </p>
          </div>
          <Link href="/incidents/ambulance"
            className="flex-shrink-0 px-4 py-2 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400 text-sm font-semibold hover:bg-rose-500/30 transition-all">
            Open Clinical Log →
          </Link>
        </div>
      </div>
    </div>
  );
}
