'use client';
/**
 * Headway management — tab 2 of the Planning Engine.
 *
 * Was the standalone page at /bus-ops/headway, which now redirects to
 * /bus-ops/planning-engine?tab=headway. Sits next to CBA because every
 * headway rule can bind to a rule-set via cbaRuleSetId — the two are
 * edited together far more often than either is edited alone.
 *
 * The panel shows every route and lets the user:
 *   - Toggle a route between time-point and headway mode
 *   - Define headway windows (e.g. "every 15 min from 6-9am, every 30 min from 9am-3pm, every 15 min from 3-7pm")
 *   - Anchor to clock-face times (0, 10, 20, 30 min past the hour)
 *   - Preview the expanded departures in a date range
 *   - Bind each rule to a CBA rule-set
 *
 * Backed by /api/bus-ops/headway.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, X, Eye, Calendar } from 'lucide-react';
import { useFetchedData, fetchOnce } from '@/hooks/useFetchedData';

interface Route { id: string; name: string; origin: string; destination: string; }
interface HeadwayRule {
  id: string; routeId: string; dayMask: string;
  startTime: string; endTime: string;
  headwayMinutes: number; anchorTime: string | null;
  cbaRuleSetId: string | null; notes: string | null;
}
interface ExpandedDeparture {
  ruleId: string; routeId: string; localTime: string; isoUtc: string; isAnchor: boolean;
}
interface CbaRuleSet { id: string; name: string; }

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function maskToLabel(mask: string): string {
  const on = mask.split('').map((c, i) => c === 'Y' ? i : -1).filter((i) => i >= 0);
  if (on.length === 7) return 'Every day';
  if (on.length === 5 && [1,2,3,4,5].every((d) => on.includes(d))) return 'Weekdays';
  if (on.length === 2 && [0,6].every((d) => on.includes(d))) return 'Weekends';
  return on.map((d) => DAY_LABELS[d]).join(',');
}

export function HeadwayPanel() {
  const routesRes = useFetchedData<Route[]>('/api/bus-ops/routes');
  const cbaRes    = useFetchedData<CbaRuleSet[]>('/api/bus-ops/cba');
  const routes = useMemo(() => Array.isArray(routesRes.data) ? routesRes.data : [], [routesRes.data]);
  const cbaList = useMemo(() => Array.isArray(cbaRes.data) ? cbaRes.data : [], [cbaRes.data]);

  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [previewFrom, setPreviewFrom] = useState<string>(new Date().toISOString().slice(0,10));
  const [previewTo, setPreviewTo] = useState<string>(new Date(Date.now()+7*86400000).toISOString().slice(0,10));
  const [previewOpen, setPreviewOpen] = useState<{ rules: HeadwayRule[]; departures: ExpandedDeparture[] } | null>(null);
  const [schedulingMode, setSchedulingMode] = useState<'TIMEPOINT' | 'HEADWAY'>('TIMEPOINT');
  const [editing, setEditing] = useState<Partial<HeadwayRule> | null>(null);

  useEffect(() => { if (routes.length > 0 && !selectedRouteId) setSelectedRouteId(routes[0].id); }, [routes, selectedRouteId]);

  // Load rules for selected route
  const rulesUrl = selectedRouteId ? `/api/bus-ops/headway?routeId=${selectedRouteId}` : null;
  const rulesRes = useFetchedData<{ rules: HeadwayRule[] }>(rulesUrl);
  const rules = useMemo(() => rulesRes.data?.rules ?? [], [rulesRes.data]);

  const reloadRules = () => rulesRes.refresh();

  const preview = async () => {
    if (!selectedRouteId) return;
    const res = await fetchOnce<{ rules: HeadwayRule[]; departures: ExpandedDeparture[] }>(
      `/api/bus-ops/headway?routeId=${selectedRouteId}&from=${previewFrom}&to=${previewTo}`
    );
    setPreviewOpen(res ?? null);
  };

  const save = async () => {
    if (!editing || !selectedRouteId) return;
    const body = {
      routeId: selectedRouteId,
      dayMask: editing.dayMask ?? 'YYYYYYY',
      startTime: editing.startTime,
      endTime: editing.endTime,
      headwayMinutes: editing.headwayMinutes,
      anchorTime: editing.anchorTime ?? null,
      cbaRuleSetId: editing.cbaRuleSetId ?? null,
      notes: editing.notes ?? null,
    };
    const res = await fetch('/api/bus-ops/headway', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) { setEditing(null); reloadRules(); }
    else { alert((await res.json().catch(() => ({}))).error ?? 'Save failed'); }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this headway rule?')) return;
    const res = await fetch(`/api/bus-ops/headway?id=${id}`, { method: 'DELETE' });
    if (res.ok) reloadRules();
  };

  return (
    <div className="space-y-6">
      {/* Compact intro — the Planning Engine shell owns the page title. */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <p className="text-sm text-slate-400 max-w-3xl">
          Frequency-based scheduling: define time windows and headway intervals. Replaces the
          per-trip schedule for high-frequency corridors. Each rule can bind to a CBA rule-set.
        </p>
        <button onClick={preview} disabled={!selectedRouteId}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 shrink-0">
          <Eye className="w-4 h-4" /> Preview Expanded
        </button>
      </div>

      {/* Route selector + mode */}
      <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Route</label>
            <select value={selectedRouteId} onChange={(e) => setSelectedRouteId(e.target.value)}
              className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm">
              <option value="">— select a route —</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Scheduling mode</label>
            <div className="flex rounded-lg border border-white/15 overflow-hidden">
              {(['TIMEPOINT', 'HEADWAY'] as const).map((m) => (
                <button key={m} onClick={() => setSchedulingMode(m)}
                  className={`flex-1 px-3 py-2 text-xs font-semibold ${
                    schedulingMode === m ? 'bg-amber-500 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">From</label>
              <input type="date" value={previewFrom} onChange={(e) => setPreviewFrom(e.target.value)}
                className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">To</label>
              <input type="date" value={previewTo} onChange={(e) => setPreviewTo(e.target.value)}
                className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
          </div>
        </div>
      </div>

      {/* Rules list */}
      {selectedRouteId && (
        <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-white">Headway rules for this route</h3>
            <button onClick={() => setEditing({ routeId: selectedRouteId, dayMask: 'YYYYYYY', startTime: '06:00', endTime: '09:00', headwayMinutes: 15, anchorTime: '06:00', cbaRuleSetId: null, notes: null })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 px-3 py-2 text-sm text-white">
              <Plus className="w-3.5 h-3.5" /> New rule
            </button>
          </div>

          {rules.length === 0 ? (
            <p className="text-slate-500 italic text-sm">No headway rules yet — add one above to start defining frequency-based service.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="text-left py-2 px-2">Days</th>
                    <th className="text-left py-2 px-2">Window</th>
                    <th className="text-right py-2 px-2">Headway</th>
                    <th className="text-left py-2 px-2">Anchor</th>
                    <th className="text-left py-2 px-2">CBA</th>
                    <th className="text-left py-2 px-2">Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2 text-slate-200">{maskToLabel(r.dayMask)}</td>
                      <td className="py-2 px-2 text-white font-mono">{r.startTime} – {r.endTime}</td>
                      <td className="py-2 px-2 text-right text-amber-300 font-semibold">{r.headwayMinutes} min</td>
                      <td className="py-2 px-2 text-slate-300 font-mono">{r.anchorTime ?? '—'}</td>
                      <td className="py-2 px-2 text-slate-300">
                        {cbaList.find((c) => c.id === r.cbaRuleSetId)?.name ?? <span className="text-slate-500">default</span>}
                      </td>
                      <td className="py-2 px-2 text-slate-400 truncate max-w-[200px]">{r.notes ?? '—'}</td>
                      <td className="py-2 px-2 text-right">
                        <button onClick={() => del(r.id)} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Preview expanded */}
      {previewOpen && (
        <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
          <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-400" />
            Expanded departures: {previewOpen.departures.length} trips from {previewFrom} to {previewTo}
          </h3>
          {previewOpen.departures.length === 0 ? (
            <p className="text-slate-500 italic">No departures generated in this window.</p>
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-800">
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="text-left py-2 px-2">Date</th>
                    <th className="text-left py-2 px-2">Time</th>
                    <th className="text-left py-2 px-2">Anchor</th>
                    <th className="text-left py-2 px-2">Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {previewOpen.departures.slice(0, 200).map((d, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1.5 px-2 text-slate-200">{d.isoUtc.slice(0, 10)}</td>
                      <td className="py-1.5 px-2 text-white font-mono">{d.localTime}</td>
                      <td className="py-1.5 px-2">{d.isAnchor ? <span className="text-emerald-300">●</span> : <span className="text-slate-600">·</span>}</td>
                      <td className="py-1.5 px-2 text-slate-500 font-mono text-[10px]">{d.ruleId.slice(0, 8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewOpen.departures.length > 200 && (
                <p className="text-xs text-slate-500 mt-2 text-center">Showing first 200 of {previewOpen.departures.length} departures.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit drawer */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-800 border-2 border-amber-500/40 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">New headway rule</h3>
              <button onClick={() => setEditing(null)} className="text-slate-300 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Days of week</label>
                <div className="flex gap-1">
                  {DAY_LABELS.map((d, i) => (
                    <button key={i}
                      onClick={() => {
                        const cur = editing.dayMask ?? 'YYYYYYY';
                        const arr = cur.split('');
                        arr[i] = arr[i] === 'Y' ? 'N' : 'Y';
                        setEditing({ ...editing, dayMask: arr.join('') });
                      }}
                      className={`w-9 h-9 rounded text-xs font-bold ${
                        (editing.dayMask ?? 'YYYYYYY')[i] === 'Y'
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-900 text-slate-500 border border-white/10'
                      }`}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Start time</label>
                  <input type="time" value={editing.startTime ?? '06:00'} onChange={(e) => setEditing({ ...editing, startTime: e.target.value })}
                    className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">End time</label>
                  <input type="time" value={editing.endTime ?? '09:00'} onChange={(e) => setEditing({ ...editing, endTime: e.target.value })}
                    className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Headway (min)</label>
                  <input type="number" min={1} max={240} value={editing.headwayMinutes ?? 15}
                    onChange={(e) => setEditing({ ...editing, headwayMinutes: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Anchor time (optional)</label>
                  <input type="time" value={editing.anchorTime ?? ''} onChange={(e) => setEditing({ ...editing, anchorTime: e.target.value || null })}
                    className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">CBA rule-set (optional)</label>
                <select value={editing.cbaRuleSetId ?? ''} onChange={(e) => setEditing({ ...editing, cbaRuleSetId: e.target.value || null })}
                  className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm">
                  <option value="">— tenant default —</option>
                  {cbaList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <input type="text" value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value || null })}
                  className="w-full bg-slate-900 border border-white/15 rounded-lg px-3 py-2 text-white text-sm" />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-lg border border-white/30 text-white text-sm hover:bg-white/10">Cancel</button>
              <button onClick={save}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold">
                <Save className="w-3.5 h-3.5" /> Save rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
