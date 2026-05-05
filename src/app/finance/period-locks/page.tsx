'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Period {
  id: string; fiscal_year: number; period_number: number; period_name: string;
  period_from: string; period_to: string; status: string;
  locked_at: string | null; locked_by: string | null; unlock_reason: string | null; notes: string | null;
}

interface FiscalYear {
  id: string; fiscal_year: number; year_start: string; year_end: string;
  status: string; closed_at: string | null; period_count: string; locked_periods: string;
}

const STATUS_STYLE: Record<string, string> = {
  OPEN:        'text-emerald-400 bg-emerald-900/20 border-emerald-500/30',
  SOFT_CLOSED: 'text-amber-400  bg-amber-900/20  border-amber-500/30',
  LOCKED:      'text-red-400    bg-red-900/20    border-red-500/30',
  YEAR_END:    'text-purple-400 bg-purple-900/20 border-purple-500/30',
};
const STATUS_ICON: Record<string, string> = {
  OPEN: '🟢', SOFT_CLOSED: '🟡', LOCKED: '🔒', YEAR_END: '🏁',
};

/* ── Setup Year Modal ── */
function SetupYearModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const setup = async () => {
    setSaving(true);
    const res = await fetch('/api/finance/period-locks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup_year', year }),
    });
    const d = await res.json();
    setResult(`Created FY ${d.year} with ${d.periodsCreated} periods`);
    setSaving(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Setup Fiscal Year</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-400">Create 13 accounting periods (Jan–Dec + Year-End Adjustments) for the selected fiscal year.</p>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Fiscal Year</label>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500">
              {[2023,2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {result && (
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-3">
              <p className="text-emerald-400 text-sm font-medium">✓ {result}</p>
            </div>
          )}
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Close</button>
          <button onClick={setup} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Creating…' : 'Setup Year'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Unlock Modal ── */
function UnlockModal({ period, onClose, onDone }: { period: Period; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const unlock = async () => {
    setSaving(true);
    await fetch('/api/finance/period-locks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock_period', periodId: period.id, unlockReason: reason }),
    });
    setSaving(false);
    onDone(); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Unlock Period</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-3">
            <p className="text-red-300 text-sm font-medium">⚠ Unlocking {period.period_name}</p>
            <p className="text-xs text-slate-400 mt-1">This will allow journal entries to be posted to this period. Provide an audit reason.</p>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reason for Unlocking *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="e.g. Correcting misposted Q1 depreciation entry per CFO approval..."
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-red-500" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={unlock} disabled={saving || !reason.trim()}
            className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Unlocking…' : 'Unlock Period'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PeriodLocksPage() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [unlockPeriod, setUnlockPeriod] = useState<Period | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [fyRes, pRes] = await Promise.all([
      fetch('/api/finance/period-locks?type=fiscal_years'),
      fetch(`/api/finance/period-locks?year=${selectedYear}`),
    ]);
    if (fyRes.ok) { const d = await fyRes.json(); setFiscalYears(d.data ?? []); }
    if (pRes.ok)  { const d = await pRes.json(); setPeriods(d.data ?? []); }
    setLoading(false);
  }, [selectedYear]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action: string, payload: Record<string, unknown>) => {
    await fetch('/api/finance/period-locks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    load();
  };

  const lockProgress = periods.length > 0
    ? Math.round((periods.filter(p => p.status === 'LOCKED' || p.status === 'YEAR_END').length / periods.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Period Locking</h1>
          <p className="text-slate-400 text-sm mt-0.5">Financial year & accounting period management</p>
        </div>
        <button onClick={() => setShowSetup(true)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm">
          + Setup Fiscal Year
        </button>
      </div>

      {/* Fiscal Years */}
      {fiscalYears.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {fiscalYears.map(fy => {
            const locked = parseInt(fy.locked_periods ?? '0');
            const total  = parseInt(fy.period_count ?? '0');
            const pct    = total > 0 ? Math.round((locked / total) * 100) : 0;
            return (
              <button key={fy.id} onClick={() => setSelectedYear(fy.fiscal_year)}
                className={`p-4 rounded-2xl border text-left transition-all ${selectedYear === fy.fiscal_year ? 'border-purple-500/60 bg-purple-900/20' : 'border-white/10 bg-slate-900/60 hover:border-white/20'}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-lg font-bold text-white">FY {fy.fiscal_year}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${fy.status === 'CLOSED' ? 'text-red-400 bg-red-900/20 border-red-500/30' : 'text-emerald-400 bg-emerald-900/20 border-emerald-500/30'}`}>
                    {fy.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{locked}/{total} periods locked</p>
                <div className="mt-2 bg-slate-700 rounded-full h-1.5">
                  <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Periods for selected year */}
      {periods.length === 0 && !loading && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-12 text-center">
          <p className="text-slate-400 text-base">No periods found for FY {selectedYear}</p>
          <p className="text-slate-500 text-sm mt-1">Click "Setup Fiscal Year" to create accounting periods</p>
        </div>
      )}

      {periods.length > 0 && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">FY {selectedYear} Accounting Periods</h2>
              <p className="text-xs text-slate-400 mt-0.5">{lockProgress}% periods locked</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => doAction('lock_all_periods', { year: selectedYear })}
                className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-medium">
                🔒 Lock All Open
              </button>
              <button onClick={() => doAction('close_fiscal_year', { year: selectedYear })}
                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium">
                🏁 Close FY {selectedYear}
              </button>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 w-8">#</th>
                <th className="text-left px-4 py-3">Period</th>
                <th className="text-left px-4 py-3 w-32">From</th>
                <th className="text-left px-4 py-3 w-32">To</th>
                <th className="text-left px-4 py-3 w-28">Status</th>
                <th className="text-left px-4 py-3">Locked By / Reason</th>
                <th className="px-4 py-3 w-36"></th>
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.id} className={`border-b border-white/5 ${p.status === 'LOCKED' || p.status === 'YEAR_END' ? 'bg-red-900/5' : 'hover:bg-slate-800/40'}`}>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{p.period_number}</td>
                  <td className="px-4 py-2.5 text-sm font-medium text-slate-200">{p.period_name}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{p.period_from}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{p.period_to}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLE[p.status] ?? ''}`}>
                      {STATUS_ICON[p.status]} {p.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {p.locked_by ? <span>{p.locked_by} · {p.locked_at?.slice(0,10)}</span> : '—'}
                    {p.unlock_reason && <span className="ml-1 text-amber-400 italic">Unlocked: {p.unlock_reason.slice(0, 40)}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      {p.status === 'OPEN' && (
                        <>
                          <button onClick={() => doAction('soft_close_period', { periodId: p.id })}
                            className="px-2 py-1 bg-amber-900/30 text-amber-400 rounded-lg text-xs hover:bg-amber-900/50">
                            Soft Close
                          </button>
                          <button onClick={() => doAction('lock_period', { periodId: p.id, lockedBy: 'Finance Manager' })}
                            className="px-2 py-1 bg-red-900/30 text-red-400 rounded-lg text-xs hover:bg-red-900/50">
                            🔒 Lock
                          </button>
                        </>
                      )}
                      {p.status === 'SOFT_CLOSED' && (
                        <button onClick={() => doAction('lock_period', { periodId: p.id, lockedBy: 'Finance Manager' })}
                          className="px-2 py-1 bg-red-900/30 text-red-400 rounded-lg text-xs hover:bg-red-900/50">
                          🔒 Lock
                        </button>
                      )}
                      {p.status === 'LOCKED' && (
                        <button onClick={() => setUnlockPeriod(p)}
                          className="px-2 py-1 bg-slate-700 text-slate-300 rounded-lg text-xs hover:bg-slate-600">
                          🔓 Unlock
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 text-xs text-slate-500">
        {Object.entries(STATUS_STYLE).map(([s, style]) => (
          <span key={s} className="flex items-center gap-1">
            <span>{STATUS_ICON[s]}</span>
            <span>{s.replace('_', ' ')}</span>
            {s === 'OPEN' && ' — JEs can be posted'}
            {s === 'SOFT_CLOSED' && ' — Restricted posting'}
            {s === 'LOCKED' && ' — No JE posting allowed'}
            {s === 'YEAR_END' && ' — Year-end closed'}
          </span>
        ))}
      </div>

      {showSetup && <SetupYearModal onClose={() => setShowSetup(false)} onDone={load} />}
      {unlockPeriod && <UnlockModal period={unlockPeriod} onClose={() => setUnlockPeriod(null)} onDone={load} />}
    </div>
  );
}
