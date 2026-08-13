'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface DriverStat {
  driverId: string;
  totalTrips: number;
  completedTrips: number;
  onTimeRate: number;
  cancellationRate: number;
  score: number;
}

interface Driver {
  id: string;
  employee_id: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  license_number: string | null;
  license_expiry: string | null;
  status: string | null;
  assignment_type: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:     'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  INACTIVE:   'bg-slate-500/20 text-slate-400 border-slate-500/30',
  SUSPENDED:  'bg-red-500/20 text-red-400 border-red-500/30',
  ON_LEAVE:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

function scoreColor(score: number) {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 70) return 'text-amber-400';
  if (score >= 50) return 'text-orange-400';
  return 'text-red-400';
}

export default function LogisticsDriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [stats,   setStats]   = useState<Record<string, DriverStat>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [driversRes, statsRes] = await Promise.all([
        fetch('/api/drivers?assignmentType=LOGISTICS', { cache: 'no-store' }),
        fetch('/api/logistics/driver-stats?days=90',   { cache: 'no-store' }),
      ]);
      if (driversRes.ok) {
        const data = await driversRes.json();
        setDrivers(Array.isArray(data) ? data : data.data ?? []);
      }
      if (statsRes.ok) {
        const raw = await statsRes.json();
        // API may return an array directly or { drivers: [...] }
        const statsList: DriverStat[] = Array.isArray(raw) ? raw : (raw.drivers ?? raw.data ?? []);
        const map: Record<string, DriverStat> = {};
        for (const s of statsList) if (s?.driverId) map[s.driverId] = s;
        setStats(map);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = drivers.filter(d => {
    const fullName = `${d.first_name ?? ''} ${d.last_name ?? ''}`.toLowerCase();
    return !search || fullName.includes(search.toLowerCase()) ||
      d.employee_id?.toLowerCase().includes(search.toLowerCase()) ||
      d.phone?.toLowerCase().includes(search.toLowerCase());
  });

  const isExpiringSoon = (date: string | null) => {
    if (!date) return false;
    const diff = (new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff <= 30 && diff >= 0;
  };

  const isExpired = (date: string | null) => {
    if (!date) return false;
    return new Date(date).getTime() < Date.now();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Logistics Drivers</h1>
          <p className="text-slate-400 text-sm mt-0.5">Drivers assigned to logistics fleet</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800 border border-white/10 px-3 py-1.5 rounded-lg">
          {drivers.filter(d => d.status === 'ACTIVE').length} active of {drivers.length}
        </div>
      </div>

      <input
        type="text"
        placeholder="Search by name, employee ID, phone…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/40"
      />

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-slate-800/60 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-16 text-center">
          <div className="text-5xl mb-3">👤</div>
          <p className="text-slate-400">No logistics drivers found</p>
          <p className="text-slate-600 text-xs mt-1">Drivers with assignment_type = LOGISTICS appear here</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Driver</th>
                <th className="text-left px-5 py-3">Employee ID</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">License</th>
                <th className="text-left px-5 py-3">Expiry</th>
                <th className="text-left px-5 py-3">Score</th>
                <th className="text-left px-5 py-3">Trips</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const expired   = isExpired(d.license_expiry);
                const expiring  = isExpiringSoon(d.license_expiry);
                const dStat     = stats[d.id];
                return (
                  <tr key={d.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-xs font-bold text-white">
                          {(d.first_name ?? '?')[0]}{(d.last_name ?? '')[0]}
                        </div>
                        <div>
                          <p className="text-white font-medium">{d.first_name ?? ''} {d.last_name ?? ''}</p>
                          {d.phone && <p className="text-slate-500 text-xs">{d.phone}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-400">{d.employee_id ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[d.status ?? ''] ?? STATUS_BADGE.INACTIVE}`}>
                        {d.status ?? 'UNKNOWN'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-300 text-xs">{d.license_number ?? '—'}</td>
                    <td className="px-5 py-3 text-xs">
                      {d.license_expiry ? (
                        <span className={expired ? 'text-red-400 font-medium' : expiring ? 'text-amber-400 font-medium' : 'text-slate-400'}>
                          {expired ? '⚠️ ' : expiring ? '⏰ ' : ''}
                          {new Date(d.license_expiry).toLocaleDateString('en-AE')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {dStat ? (
                        <span className={`text-sm font-bold ${scoreColor(dStat.score)}`}>{dStat.score}</span>
                      ) : <span className="text-slate-700 text-xs">N/A</span>}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">
                      {dStat ? (
                        <span>{dStat.completedTrips}/{dStat.totalTrips}
                          <span className="text-slate-600 ml-1">({dStat.onTimeRate}% on-time)</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/logistics/drivers/${d.id}/performance`}
                        className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                        📊 Scorecard
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
