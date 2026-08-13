'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
type AttStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

interface AttRecord {
  attendanceId:   string | null;
  studentId:      string;
  studentCode:    string;
  firstName:      string;
  lastName:       string;
  fullName:       string;
  grade:          string | null;
  section:        string | null;
  routeId:        string | null;
  routeName:      string | null;
  pickupStop:     string | null;
  guardian1Name:  string | null;
  guardian1Phone: string | null;
  rfidCard:       string | null;
  medicalNotes:   string | null;
  status:         AttStatus;
  scannedAt:      string | null;
  boardedAt:      string | null;
  droppedAt:      string | null;
  notifiedAt:     string | null;
  notes:          string | null;
}

interface Summary { total: number; present: number; absent: number; late: number; excused: number; notified: number }
interface Route { id: string; name: string }

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<AttStatus, { label: string; color: string; bg: string; border: string; icon: string }> = {
  PRESENT: { label: 'Present',  icon: '✅', color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30' },
  ABSENT:  { label: 'Absent',   icon: '❌', color: 'text-red-400',     bg: 'bg-red-500/20',     border: 'border-red-500/30' },
  LATE:    { label: 'Late',     icon: '⏰', color: 'text-amber-400',   bg: 'bg-amber-500/20',   border: 'border-amber-500/30' },
  EXCUSED: { label: 'Excused',  icon: '📋', color: 'text-blue-400',   bg: 'bg-blue-500/20',    border: 'border-blue-500/30' },
};

// ── StatusButton ──────────────────────────────────────────────────────────────
function StatusBtn({ status, current, onSelect }: { status: AttStatus; current: AttStatus; onSelect: (s: AttStatus) => void }) {
  const c = STATUS_CFG[status];
  const active = status === current;
  return (
    <button onClick={() => onSelect(status)}
      className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-all ${
        active ? `${c.bg} ${c.color} ${c.border}` : 'bg-slate-800 text-slate-500 border-white/10 hover:text-slate-300'
      }`}>
      {c.icon} {c.label}
    </button>
  );
}

// ── Notify Modal ──────────────────────────────────────────────────────────────
function NotifyModal({ absentStudents, onClose, onNotified }: {
  absentStudents: AttRecord[];
  onClose: () => void;
  onNotified: (count: number) => void;
}) {
  const [sending, setSending] = useState(false);
  const [done,    setDone]    = useState(false);
  const [count,   setCount]   = useState(0);

  async function send(date: string, sessionType: string, routeId: string) {
    setSending(true);
    try {
      const res = await fetch('/api/school-bus/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'notify_absent', date, sessionType, routeId }),
      });
      if (res.ok) {
        const d = await res.json();
        setCount(d.notified ?? 0);
        setDone(true);
        onNotified(d.notified ?? 0);
      }
    } catch { /* silent */ }
    finally { setSending(false); }
  }

  const unnotified = absentStudents.filter(s => !s.notifiedAt);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-white/10">
          <h2 className="text-white font-semibold">Notify Absent Students' Guardians</h2>
          <p className="text-slate-400 text-xs mt-1">{unnotified.length} guardian(s) will be notified via WhatsApp/SMS</p>
        </div>

        {done ? (
          <div className="px-6 py-8 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-emerald-300 font-semibold">{count} guardian{count !== 1 ? 's' : ''} notified</p>
            <p className="text-slate-400 text-xs mt-1">Notifications sent successfully</p>
          </div>
        ) : (
          <div className="px-6 py-4 max-h-60 overflow-y-auto space-y-2">
            {unnotified.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-4">All absent students have already been notified.</p>
            ) : unnotified.map(s => (
              <div key={s.studentId} className="flex items-center justify-between bg-slate-800/60 rounded-xl px-3 py-2">
                <div>
                  <p className="text-sm text-white">{s.fullName}</p>
                  <p className="text-xs text-slate-500">{s.guardian1Phone ?? 'No phone on file'}</p>
                </div>
                <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">Absent</span>
              </div>
            ))}
          </div>
        )}

        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-lg border border-white/10 transition-colors">
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && unnotified.length > 0 && (
            <button onClick={() => send(
              new Date().toISOString().slice(0,10),
              'MORNING',
              unnotified[0]?.routeId ?? ''
            )} disabled={sending}
              className="text-sm font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 px-5 py-2 rounded-lg transition-colors">
              {sending ? 'Sending…' : `📱 Send ${unnotified.length} Alert${unnotified.length > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SchoolBusAttendancePage() {
  const [records,     setRecords]     = useState<AttRecord[]>([]);
  const [summary,     setSummary]     = useState<Summary>({ total: 0, present: 0, absent: 0, late: 0, excused: 0, notified: 0 });
  const [routes,      setRoutes]      = useState<Route[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [date,        setDate]        = useState(today);
  const [sessionType, setSessionType] = useState<'MORNING' | 'AFTERNOON'>('MORNING');
  const [filterRoute, setFilterRoute] = useState('');
  const [search,      setSearch]      = useState('');
  const [filterStatus, setFilterStatus] = useState<AttStatus | 'ALL'>('ALL');
  const [showNotify,  setShowNotify]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date, sessionType, routeId: filterRoute, q: search });
      const res = await fetch(`/api/school-bus/attendance?${params}`);
      if (res.ok) {
        const d = await res.json();
        setRecords(d.records ?? []);
        setSummary(d.summary ?? { total: 0, present: 0, absent: 0, late: 0, excused: 0, notified: 0 });
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [date, sessionType, filterRoute, search]);

  useEffect(() => {
    fetch('/api/bus-ops/routes?limit=100').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.routes) setRoutes(d.routes.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })));
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markStatus(record: AttRecord, status: AttStatus) {
    setSaving(record.studentId);
    try {
      await fetch('/api/school-bus/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark', studentId: record.studentId,
          date, sessionType, status,
          boardedAt: status === 'PRESENT' ? new Date().toISOString() : null,
        }),
      });
      setRecords(r => r.map(r => r.studentId === record.studentId ? { ...r, status, scannedAt: new Date().toISOString() } : r));
      setSummary(prev => {
        const next = { ...prev };
        if (record.status !== status) {
          if (record.status in next) (next as Record<string, number>)[record.status.toLowerCase()]--;
          if (status in STATUS_CFG)  (next as Record<string, number>)[status.toLowerCase()]++;
        }
        return next;
      });
    } catch { /* silent */ }
    finally { setSaving(null); }
  }

  async function markAll(status: AttStatus) {
    if (!confirm(`Mark ALL ${records.length} students as ${status}?`)) return;
    const ids = records.map(r => r.studentId);
    setSaving('bulk');
    try {
      await fetch('/api/school-bus/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_mark', studentIds: ids, date, sessionType, status }),
      });
      setRecords(r => r.map(s => ({ ...s, status })));
    } catch { /* silent */ }
    finally { setSaving(null); load(); }
  }

  const filtered = records.filter(r => filterStatus === 'ALL' || r.status === filterStatus);
  const absent   = records.filter(r => r.status === 'ABSENT');
  const attendanceRate = summary.total > 0 ? Math.round((summary.present + summary.late) / summary.total * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Student Attendance</h1>
          <p className="text-slate-400 text-sm mt-0.5">Mark boarding & drop-off, notify parents of absences</p>
        </div>
        <div className="flex gap-2">
          {absent.filter(s => !s.notifiedAt).length > 0 && (
            <button onClick={() => setShowNotify(true)}
              className="text-sm bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 px-4 py-2 rounded-xl transition-colors font-medium">
              📱 Notify {absent.filter(s => !s.notifiedAt).length} Absent
            </button>
          )}
          <button onClick={load} className="text-xs text-slate-400 border border-white/10 px-3 py-2 rounded-xl hover:border-white/20 hover:text-white transition-colors">↺ Refresh</button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-slate-400">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-yellow-500/40" />
        </div>
        <div className="flex bg-slate-800/60 border border-white/10 rounded-xl overflow-hidden">
          {(['MORNING', 'AFTERNOON'] as const).map(s => (
            <button key={s} onClick={() => setSessionType(s)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                sessionType === s ? 'bg-yellow-500/20 text-yellow-300' : 'text-slate-400 hover:text-white'
              }`}>
              {s === 'MORNING' ? '🌅 Morning' : '🌆 Afternoon'}
            </button>
          ))}
        </div>
        <select value={filterRoute} onChange={e => setFilterRoute(e.target.value)}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
          <option value="">All Routes</option>
          {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input type="text" placeholder="Search student…" value={search} onChange={e => setSearch(e.target.value)}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/40" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: 'Total',       value: summary.total,    color: 'text-white',        icon: '👥' },
          { label: 'Present',     value: summary.present,  color: 'text-emerald-400',  icon: '✅' },
          { label: 'Absent',      value: summary.absent,   color: 'text-red-400',      icon: '❌' },
          { label: 'Late',        value: summary.late,     color: 'text-amber-400',    icon: '⏰' },
          { label: 'Excused',     value: summary.excused,  color: 'text-blue-400',     icon: '📋' },
          { label: 'Attendance %',value: `${attendanceRate}%`, color: attendanceRate >= 80 ? 'text-emerald-400' : attendanceRate >= 60 ? 'text-amber-400' : 'text-red-400', icon: '📊' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-3 text-center">
            <p className="text-xs text-slate-500">{s.icon} {s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Bulk actions + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-500 font-medium">Bulk mark all:</span>
        {(['PRESENT', 'ABSENT', 'EXCUSED'] as AttStatus[]).map(s => (
          <button key={s} disabled={saving === 'bulk'} onClick={() => markAll(s)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${STATUS_CFG[s].bg} ${STATUS_CFG[s].color} ${STATUS_CFG[s].border}`}>
            {STATUS_CFG[s].icon} All {s}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-xs text-slate-500">Filter:</span>
        {(['ALL', 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              filterStatus === s
                ? s === 'ALL' ? 'bg-slate-700 text-white border-white/20' : `${STATUS_CFG[s as AttStatus].bg} ${STATUS_CFG[s as AttStatus].color} ${STATUS_CFG[s as AttStatus].border}`
                : 'bg-slate-800 text-slate-500 border-white/10 hover:text-slate-300'
            }`}>
            {s === 'ALL' ? '👁 All' : `${STATUS_CFG[s as AttStatus].icon} ${STATUS_CFG[s as AttStatus].label}`}
          </button>
        ))}
      </div>

      {/* Attendance list */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 text-xs text-slate-500 uppercase tracking-wider">
          {filtered.length} student{filtered.length !== 1 ? 's' : ''} — {date} · {sessionType}
        </div>

        {loading ? (
          <div className="animate-pulse p-4 space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-slate-800 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-slate-400 text-sm">No students to display</p>
            <p className="text-slate-600 text-xs mt-1">Make sure students are enrolled with active status</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map(r => {
              const cfg = STATUS_CFG[r.status];
              return (
                <div key={r.studentId} className={`px-5 py-3 flex items-center gap-4 hover:bg-white/5 transition-colors ${saving === r.studentId ? 'opacity-50' : ''}`}>
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center text-xs font-bold text-slate-900 flex-shrink-0">
                    {r.firstName[0]}{r.lastName[0]}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white font-medium truncate">{r.fullName}</p>
                      {r.medicalNotes && <span className="text-xs text-red-400">⚕</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                      {r.grade && <span>{r.grade}{r.section ? ` ${r.section}` : ''}</span>}
                      {r.routeName && <span>🗺️ {r.routeName}</span>}
                      {r.pickupStop && <span>📍 {r.pickupStop}</span>}
                      {r.rfidCard && <span className="font-mono text-purple-400">📡 {r.rfidCard}</span>}
                    </div>
                    {r.scannedAt && (
                      <p className="text-xs text-slate-600 mt-0.5">
                        Scanned {new Date(r.scannedAt).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>

                  {/* Status buttons */}
                  <div className="flex gap-1.5 flex-shrink-0">
                    {(Object.keys(STATUS_CFG) as AttStatus[]).map(s => (
                      <StatusBtn key={s} status={s} current={r.status} onSelect={st => markStatus(r, st)} />
                    ))}
                  </div>

                  {/* Current badge */}
                  <div className="flex-shrink-0 w-24 text-right">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                      {cfg.icon} {cfg.label}
                    </span>
                    {r.status === 'ABSENT' && r.notifiedAt && (
                      <p className="text-xs text-slate-600 mt-0.5">Notified ✓</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Absent escalation notice */}
      {summary.absent > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4 flex items-center gap-4">
          <span className="text-2xl flex-shrink-0">🔔</span>
          <div className="flex-1">
            <p className="text-red-300 font-medium text-sm">{summary.absent} student{summary.absent > 1 ? 's are' : ' is'} absent today</p>
            <p className="text-red-400/60 text-xs mt-0.5">
              {summary.notified > 0 ? `${summary.notified} guardian${summary.notified > 1 ? 's' : ''} already notified.` : 'Guardians have not been notified yet.'}
              {absent.filter(s => !s.notifiedAt).length > 0 && ` ${absent.filter(s => !s.notifiedAt).length} still pending.`}
            </p>
          </div>
          {absent.filter(s => !s.notifiedAt).length > 0 && (
            <button onClick={() => setShowNotify(true)}
              className="text-sm font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 px-4 py-2 rounded-xl transition-colors flex-shrink-0">
              Notify Now
            </button>
          )}
        </div>
      )}

      {/* Notify modal */}
      {showNotify && (
        <NotifyModal
          absentStudents={absent}
          onClose={() => setShowNotify(false)}
          onNotified={() => { setShowNotify(false); load(); }}
        />
      )}
    </div>
  );
}
