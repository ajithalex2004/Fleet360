'use client';

import React, { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

interface ChecklistDef {
  key: string; label: string; category: string; blocking: boolean;
}

const CATEGORY_ICON: Record<string, string> = {
  tyres: '🛞', brakes: '🛑', lights: '💡', safety: '🦺',
  docs: '📄', fluids: '⛽', cabin: '🚌', child: '🧒',
};

export default function SchoolBusPreTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [checklist, setChecklist] = useState<ChecklistDef[]>([]);
  const [results, setResults] = useState<Record<string, { ok: boolean; note?: string }>>({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/school-bus/trips/${id}/pretrip-check`);
      const data = res.ok ? await res.json() : { checklist: [] };
      setChecklist(data.checklist ?? []);
      const init: Record<string, { ok: boolean }> = {};
      for (const c of data.checklist ?? []) init[c.key] = { ok: true };
      setResults(init);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setOk = (key: string, ok: boolean) =>
    setResults(prev => ({ ...prev, [key]: { ...(prev[key] ?? {}), ok } }));
  const setNote = (key: string, note: string) =>
    setResults(prev => ({ ...prev, [key]: { ...(prev[key] ?? { ok: true }), note } }));

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const items = checklist.map(c => ({ key: c.key, ok: results[c.key]?.ok ?? true, note: results[c.key]?.note }));
      const res = await fetch(`/api/school-bus/trips/${id}/pretrip-check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, notes: notes || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Submit failed');
      const passed = data.assessment?.overallPass;
      setMsg({
        kind: passed ? 'ok' : 'err',
        text: passed
          ? '✓ Check passed. You may begin boarding.'
          : `⛔ UNSAFE — ${data.assessment.blockingFailures.length} blocking failure(s). Notify dispatch immediately.`,
      });
      if (passed) setTimeout(() => router.push(`/school-bus/driver/trip/${id}`), 1500);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Submit failed' });
    } finally { setBusy(false); }
  };

  if (loading) return <div className="text-slate-500">Loading checklist…</div>;

  const failCount = checklist.filter(c => results[c.key]?.ok === false).length;
  const blockingFailCount = checklist.filter(c => c.blocking && results[c.key]?.ok === false).length;

  return (
    <div className="space-y-4">
      <Link href={`/school-bus/driver/trip/${id}`} className="text-xs text-rose-400 hover:underline inline-flex items-center gap-1">
        <ChevronLeft className="w-3 h-3" /> Trip
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Pre-Trip Safety Check</h1>
        <p className="text-sm text-slate-400">Walk around the bus. Check each item, mark FAIL only when something is wrong.</p>
      </div>

      <div className={`p-3 rounded-xl text-sm ${
        blockingFailCount > 0 ? 'bg-rose-500/20 border border-rose-500/40 text-rose-200'
        : failCount > 0 ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200'
        : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-200'
      }`}>
        {blockingFailCount > 0
          ? `${blockingFailCount} blocking failure${blockingFailCount === 1 ? '' : 's'} — bus must NOT depart`
          : failCount > 0
            ? `${failCount} non-blocking issue${failCount === 1 ? '' : 's'} flagged — review with supervisor`
            : '✓ All clear — ready to submit'}
      </div>

      <div className="space-y-2">
        {checklist.map(c => {
          const ok = results[c.key]?.ok ?? true;
          return (
            <div key={c.key} className={`p-3 rounded-xl border ${ok ? 'bg-slate-800/40 border-white/10' : 'bg-rose-500/10 border-rose-500/40'}`}>
              <div className="flex items-start gap-3">
                <div className="text-2xl shrink-0">{CATEGORY_ICON[c.category] ?? '🔧'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{c.label}</div>
                  {c.blocking && <div className="text-[10px] text-amber-300 mt-0.5">⚠ Blocks departure if failed</div>}
                </div>
                <div className="inline-flex rounded-lg bg-slate-900/60 p-1 shrink-0">
                  <button onClick={() => setOk(c.key, true)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold ${ok ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>OK</button>
                  <button onClick={() => setOk(c.key, false)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold ${!ok ? 'bg-rose-600 text-white' : 'text-slate-400'}`}>FAIL</button>
                </div>
              </div>
              {!ok && (
                <input value={results[c.key]?.note ?? ''} onChange={e => setNote(c.key, e.target.value)}
                  placeholder="What's wrong?"
                  className="mt-2 w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-rose-500/30 text-white text-sm placeholder-slate-500" />
              )}
            </div>
          );
        })}
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5 font-semibold">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          className="w-full px-4 py-2 rounded-xl bg-slate-800/60 border border-white/10 text-white" />
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm ${msg.kind === 'ok' ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-200 border border-rose-500/40'}`}>
          {msg.text}
        </div>
      )}

      <button onClick={submit} disabled={busy}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-red-700 to-rose-700 text-white font-semibold disabled:opacity-50">
        {busy ? 'Submitting…' : `Submit Check (${checklist.length - failCount}/${checklist.length} OK)`}
      </button>
    </div>
  );
}
