'use client';
import React, { useState, useEffect, useCallback } from 'react';

const SEVERITY_BADGE: Record<string,string> = {
  CRITICAL:'bg-red-500/20 text-red-400 border-red-500/30',
  HIGH:'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM:'bg-amber-500/20 text-amber-400 border-amber-500/30',
  LOW:'bg-slate-500/20 text-slate-400 border-slate-500/30',
};
const STATUS_BADGE: Record<string,string> = {
  OPEN:'bg-red-500/20 text-red-400 border-red-500/30',
  IN_PROGRESS:'bg-amber-500/20 text-amber-400 border-amber-500/30',
  RESOLVED:'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  CLOSED:'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

export default function IncidentReportsPage() {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/incidents', { cache: 'no-store' });
      if (res.ok) { const d = await res.json(); setIncidents(d.incidents ?? []); }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const types = ['ALL', ...Array.from(new Set(incidents.map(i => i.incident_type)))];
  const filtered = incidents.filter(i => {
    const matchType   = typeFilter === 'ALL' || i.incident_type === typeFilter;
    const matchSearch = !search || [i.incident_no, i.description, i.location]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()));
    return matchType && matchSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Incident Reports</h1>
          <p className="text-slate-400 text-sm mt-0.5">Full incident history and analytics</p>
        </div>
        <div className="text-xs text-slate-400 bg-slate-800 border border-white/10 px-3 py-1.5 rounded-lg">
          {incidents.length} total incidents
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {types.slice(0, 8).map(t => (
          <button key={t} onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              typeFilter === t ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'text-slate-400 border-white/10 hover:text-white'
            }`}>
            {t.replace(/_/g,' ')}
          </button>
        ))}
      </div>

      <input type="text" placeholder="Search incidents…" value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/40"
      />

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_,i) => <div key={i} className="h-12 bg-slate-800/60 rounded-xl animate-pulse"/>)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
          <div className="text-5xl mb-3">📋</div>
          <p className="text-slate-400">No incident reports found</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3">Ref</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3">Severity</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Location</th>
                <th className="text-left px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inc => (
                <tr key={inc.id} className="border-b border-white/5 last:border-0 hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-white">{inc.incident_no ?? inc.id.slice(0,8)}</td>
                  <td className="px-5 py-3 text-slate-300 text-xs">{inc.incident_type.replace(/_/g,' ')}</td>
                  <td className="px-5 py-3">
                    {inc.severity && <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${SEVERITY_BADGE[inc.severity] ?? SEVERITY_BADGE.LOW}`}>{inc.severity}</span>}
                  </td>
                  <td className="px-5 py-3">
                    {inc.status && <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[inc.status] ?? STATUS_BADGE.OPEN}`}>{inc.status}</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-300 text-xs max-w-xs truncate">{inc.location ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {inc.incident_date ? new Date(inc.incident_date).toLocaleDateString('en-AE') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
