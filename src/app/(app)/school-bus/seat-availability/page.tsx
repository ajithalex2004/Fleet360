'use client';
/**
 * School Bus — Seat Availability Dashboard
 *
 * Dedicated view showing live seat availability across all routes.
 * Data sourced from /api/school-bus/capacity-check which cross-references
 * school_bus_routes ↔ school_bus_students (enrolled & active).
 *
 * Features:
 *  - Summary KPI cards (total seats, enrolled, available, overloaded routes)
 *  - Filter by Session, Direction, and Capacity Status
 *  - Colour-coded per-route table with utilisation bars
 *  - Compliance column (UAE: attendant required on every bus)
 *  - Auto-refresh every 60 seconds
 *  - One-click link to Routes Management for quick editing
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface RouteCapacity {
  routeId:           string;
  routeName:         string;
  routeCode:         string | null;
  session:           string;
  direction:         string;
  assignedVehicleId: string | null;
  hasAttendant:      boolean;
  seatCapacity:      number;
  enrolledStudents:  number;
  availableSeats:    number;
  utilisationPct:    number;
  capacityStatus:    'OK' | 'WARNING' | 'OVERLOAD';
  complianceStatus:  'OK' | 'NO_ATTENDANT';
}

interface Summary {
  total:       number;
  ok:          number;
  warning:     number;
  overload:    number;
  noAttendant: number;
}

/* ── colour helpers ── */
const CAP_COLOR: Record<string, { text: string; bg: string; border: string; bar: string; badge: string }> = {
  OK:       { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', bar: 'bg-emerald-500',  badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  WARNING:  { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   bar: 'bg-amber-400',   badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  OVERLOAD: { text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     bar: 'bg-red-500',     badge: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

const SESSION_COLOR: Record<string, string> = {
  MORNING:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  AFTERNOON: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  BOTH:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const DIR_LABEL: Record<string, string> = {
  PICKUP:  '↑ Pickup',
  DROPOFF: '↓ Drop-off',
  BOTH:    '↕ Both',
};

/* ── Utilisation bar ── */
function UtilBar({ pct, status }: { pct: number; status: string }) {
  const cfg = CAP_COLOR[status] ?? CAP_COLOR.OK;
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
        <div className={`h-2 rounded-full transition-all ${cfg.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={`text-xs font-semibold w-10 text-right ${cfg.text}`}>{pct}%</span>
    </div>
  );
}

/* ── Available Seats cell ── */
function AvailBadge({ available, status }: { available: number; status: string }) {
  const cfg = CAP_COLOR[status] ?? CAP_COLOR.OK;
  if (status === 'OVERLOAD') {
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${cfg.badge}`}>
        🚨 Overloaded
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-bold border ${cfg.badge}`}>
      {available}
      <span className="text-[10px] font-normal opacity-70">seats free</span>
    </span>
  );
}

/* ══════════════════════════════════════════════
   Main Page
══════════════════════════════════════════════ */
export default function SeatAvailabilityPage() {
  const [routes,   setRoutes]   = useState<RouteCapacity[]>([]);
  const [summary,  setSummary]  = useState<Summary>({ total: 0, ok: 0, warning: 0, overload: 0, noAttendant: 0 });
  const [loading,  setLoading]  = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  /* Filters */
  const [session,  setSession]  = useState('');
  const [dir,      setDir]      = useState('');
  const [capFil,   setCapFil]   = useState('');
  const [search,   setSearch]   = useState('');

  /* Sort */
  const [sortKey, setSortKey]   = useState<'routeName' | 'availableSeats' | 'utilisationPct' | 'enrolledStudents'>('utilisationPct');
  const [sortAsc, setSortAsc]   = useState(false);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/school-bus/capacity-check', { cache: 'no-store' });
      const data = await res.json();
      setRoutes(data.routes  ?? []);
      setSummary(data.summary ?? { total: 0, ok: 0, warning: 0, overload: 0, noAttendant: 0 });
      setLastSync(new Date());
    } catch {
      /* silent — keep stale data */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Auto-refresh every 60 s */
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  /* Derived: filtered + sorted */
  const filtered = routes
    .filter(r =>
      (!session || r.session   === session) &&
      (!dir     || r.direction === dir) &&
      (!capFil  || r.capacityStatus === capFil) &&
      (!search  || r.routeName.toLowerCase().includes(search.toLowerCase()) ||
                   (r.routeCode ?? '').toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      const mult = sortAsc ? 1 : -1;
      return (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * mult;
    });

  /* Derived totals for filtered set */
  const totalSeats    = filtered.reduce((s, r) => s + r.seatCapacity,     0);
  const totalEnrolled = filtered.reduce((s, r) => s + r.enrolledStudents, 0);
  const totalFree     = filtered.reduce((s, r) => s + r.availableSeats,   0);
  const overallPct    = totalSeats > 0 ? Math.round((totalEnrolled / totalSeats) * 100) : 0;

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  }
  function SortIcon({ k }: { k: typeof sortKey }) {
    if (sortKey !== k) return <span className="text-slate-700 ml-1">⇅</span>;
    return <span className="text-yellow-400 ml-1">{sortAsc ? '↑' : '↓'}</span>;
  }

  return (
    <div className="space-y-6 max-w-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">💺 Seat Availability</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            Live capacity across all school bus routes
            {lastSync && (
              <span className="ml-2 text-[var(--text-faint)]">
                · Last updated {lastSync.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} disabled={loading}
            className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] text-xs hover:text-[var(--text-main)] transition-all disabled:opacity-40">
            {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
          <Link href="/school-bus/routes"
            className="px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm font-semibold hover:bg-yellow-500/20 transition-all">
            🗺️ Manage Routes
          </Link>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          {
            icon: '🗺️', label: 'Total Routes',
            value: summary.total, sub: 'active routes', color: 'text-[var(--text-main)]',
          },
          {
            icon: '🪑', label: 'Total Seats',
            value: totalSeats, sub: `${totalEnrolled} enrolled`, color: 'text-[var(--text-main)]',
          },
          {
            icon: '✅', label: 'Seats Available',
            value: totalFree, sub: `${100 - overallPct}% fleet free`, color: 'text-emerald-400',
          },
          {
            icon: '⚡', label: 'Near Full',
            value: summary.warning, sub: '≥ 90% full', color: 'text-amber-400',
          },
          {
            icon: '🚨', label: 'Overloaded',
            value: summary.overload, sub: 'exceed capacity', color: summary.overload > 0 ? 'text-red-400' : 'text-[var(--text-faint)]',
          },
        ].map(k => (
          <div key={k.label} className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
            <div className="flex items-center justify-between">
              <span className="text-xl">{k.icon}</span>
              <span className={`text-2xl font-bold ${k.color}`}>{loading ? '…' : k.value}</span>
            </div>
            <p className="text-[var(--text-main)] text-sm font-semibold mt-1">{k.label}</p>
            <p className="text-[var(--text-faint)] text-xs">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Fleet utilisation bar ── */}
      <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-[var(--text-main)]">Overall Fleet Utilisation</p>
          <span className={`text-lg font-bold ${
            overallPct >= 100 ? 'text-red-400' : overallPct >= 90 ? 'text-amber-400' : 'text-emerald-400'
          }`}>{overallPct}%</span>
        </div>
        <div className="h-3 rounded-full bg-[var(--bg-surface)] overflow-hidden">
          <div className={`h-3 rounded-full transition-all ${
            overallPct >= 100 ? 'bg-red-500' : overallPct >= 90 ? 'bg-amber-400' : 'bg-emerald-500'
          }`} style={{ width: `${Math.min(100, overallPct)}%` }} />
        </div>
        <div className="flex justify-between text-xs text-[var(--text-faint)] mt-2">
          <span>{totalEnrolled} enrolled</span>
          <span>{totalFree} seats free</span>
          <span>{totalSeats} total capacity</span>
        </div>
      </div>

      {/* ── UAE Compliance Alert ── */}
      {summary.noAttendant > 0 && (
        <div className="flex items-start gap-3 px-5 py-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <span className="text-xl flex-shrink-0">⚠️</span>
          <div>
            <p className="text-red-300 text-sm font-semibold">
              UAE Regulatory Violation — {summary.noAttendant} route{summary.noAttendant > 1 ? 's' : ''} without a female attendant
            </p>
            <p className="text-red-400/70 text-xs mt-0.5">
              UAE Ministry of Education mandates a qualified female attendant on every school bus.
              Assign attendants via Routes Management.
            </p>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search route name or code…"
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus:outline-none focus:border-yellow-500/50 w-56"
        />

        {/* Session filter */}
        <div className="flex gap-1">
          {[['', 'All Sessions'], ['MORNING', '🌅 Morning'], ['AFTERNOON', '🌇 Afternoon'], ['BOTH', '↕ Both']].map(([v, lbl]) => (
            <button key={v} onClick={() => setSession(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                session === v ? 'bg-yellow-500 text-white' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Direction filter */}
        <div className="flex gap-1">
          {[['', 'All Directions'], ['PICKUP', '↑ Pickup'], ['DROPOFF', '↓ Drop-off']].map(([v, lbl]) => (
            <button key={v} onClick={() => setDir(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                dir === v ? 'bg-yellow-500 text-white' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-1 ml-auto">
          {[['', 'All Status'], ['OK', '🟢 OK'], ['WARNING', '🟡 Near Full'], ['OVERLOAD', '🔴 Overloaded']].map(([v, lbl]) => (
            <button key={v} onClick={() => setCapFil(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                capFil === v ? 'bg-yellow-500 text-white' : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-14 bg-[var(--bg-surface)]/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-14 text-center space-y-3">
          <span className="text-5xl">💺</span>
          <p className="text-[var(--text-muted)] font-medium">No routes match the selected filters</p>
          <button onClick={() => { setSession(''); setDir(''); setCapFil(''); setSearch(''); }}
            className="text-xs text-[var(--text-faint)] hover:text-[var(--text-main)] underline">Clear all filters</button>
        </div>
      ) : (
        <div className="rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Route
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Session
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Direction
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-main)] select-none"
                  onClick={() => toggleSort('seatCapacity' as typeof sortKey)}>
                  Capacity
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-main)] select-none"
                  onClick={() => toggleSort('enrolledStudents')}>
                  Enrolled <SortIcon k="enrolledStudents" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-main)] select-none"
                  onClick={() => toggleSort('availableSeats')}>
                  Available <SortIcon k="availableSeats" />
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-main)] select-none"
                  onClick={() => toggleSort('utilisationPct')}>
                  Utilisation <SortIcon k="utilisationPct" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Status
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Attendant
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map(r => {
                const cfg     = CAP_COLOR[r.capacityStatus] ?? CAP_COLOR.OK;
                const isOver  = r.capacityStatus === 'OVERLOAD';
                const noAtt   = r.complianceStatus === 'NO_ATTENDANT';
                const rowCls  = isOver
                  ? 'bg-red-500/5 hover:bg-red-500/10'
                  : noAtt
                  ? 'bg-amber-500/5 hover:bg-amber-500/8'
                  : 'hover:bg-[var(--bg-surface)]/40';

                return (
                  <tr key={r.routeId} className={`transition-colors ${rowCls}`}>

                    {/* Route name + code */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-[var(--text-main)] font-medium leading-tight">{r.routeName}</p>
                          {r.routeCode && (
                            <span className="font-mono text-[10px] text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                              {r.routeCode}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Session */}
                    <td className="px-4 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${SESSION_COLOR[r.session] ?? ''}`}>
                        {r.session}
                      </span>
                    </td>

                    {/* Direction */}
                    <td className="px-4 py-4 text-xs text-[var(--text-muted)]">
                      {DIR_LABEL[r.direction] ?? r.direction}
                    </td>

                    {/* Capacity */}
                    <td className="px-4 py-4 text-center">
                      <span className="text-[var(--text-main)] font-semibold">{r.seatCapacity}</span>
                      <span className="text-[var(--text-faint)] text-xs ml-1">seats</span>
                    </td>

                    {/* Enrolled */}
                    <td className="px-4 py-4 text-center">
                      <span className={`font-semibold ${isOver ? 'text-red-400' : 'text-[var(--text-main)]'}`}>
                        {r.enrolledStudents}
                      </span>
                    </td>

                    {/* Available */}
                    <td className="px-4 py-4 text-center">
                      <AvailBadge available={r.availableSeats} status={r.capacityStatus} />
                    </td>

                    {/* Utilisation bar */}
                    <td className="px-4 py-4">
                      <UtilBar pct={r.utilisationPct} status={r.capacityStatus} />
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-4 text-center">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${cfg.badge}`}>
                        {r.capacityStatus === 'WARNING' ? 'NEAR FULL' : r.capacityStatus}
                      </span>
                    </td>

                    {/* Attendant compliance */}
                    <td className="px-4 py-4 text-center">
                      {r.hasAttendant ? (
                        <span className="text-emerald-400 text-sm">✅</span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-red-500/20 text-red-300 border-red-500/30">
                          MISSING
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-4">
                      <Link href="/school-bus/routes"
                        className="text-xs text-[var(--text-faint)] hover:text-yellow-400 transition-colors">
                        Edit →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Summary footer */}
            <tfoot>
              <tr className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/30">
                <td colSpan={3} className="px-5 py-3 text-xs text-[var(--text-faint)] font-semibold">
                  Showing {filtered.length} of {routes.length} routes
                </td>
                <td className="px-4 py-3 text-center text-sm font-bold text-[var(--text-main)]">{totalSeats}</td>
                <td className="px-4 py-3 text-center text-sm font-bold text-[var(--text-main)]">{totalEnrolled}</td>
                <td className="px-4 py-3 text-center">
                  <span className="text-sm font-bold text-emerald-400">{totalFree}</span>
                  <span className="text-xs text-[var(--text-faint)] ml-1">free</span>
                </td>
                <td colSpan={4} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden max-w-[120px]">
                      <div className={`h-1.5 rounded-full ${
                        overallPct >= 100 ? 'bg-red-500' : overallPct >= 90 ? 'bg-amber-400' : 'bg-emerald-500'
                      }`} style={{ width: `${Math.min(100, overallPct)}%` }} />
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{overallPct}% overall</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-6 text-xs text-[var(--text-faint)] pt-2">
        <span className="font-semibold text-[var(--text-muted)]">Legend:</span>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          <span>OK — under 90% full</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-amber-400" />
          <span>Near Full — 90–100% utilisation</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>Overloaded — enrolled exceeds capacity</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-red-400 font-bold">MISSING</span>
          <span>— No female attendant (UAE violation)</span>
        </div>
        <span className="ml-auto text-[var(--text-faint)]">Auto-refreshes every 60 seconds</span>
      </div>
    </div>
  );
}
