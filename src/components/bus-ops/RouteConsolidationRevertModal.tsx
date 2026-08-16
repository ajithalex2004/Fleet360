'use client';

/**
 * RouteConsolidationRevertModal — confirmation + revert action.
 *
 * The engine's /revert endpoint runs its own guard cascade (window,
 * executed trips, downstream consolidation, drift hash, restored-
 * state PCE) inside the transaction. We don't have a dedicated
 * revert-preview endpoint, so this modal is a simple "are you sure?"
 * that renders guard failures back to the operator when the endpoint
 * returns 409 BLOCKED.
 */

import React, { useState } from 'react';
import { X, Loader2, Undo2 } from 'lucide-react';

interface GuardCheck {
  code: string;
  status: 'PASS' | 'WARN' | 'BLOCK';
  message: string;
}

export type ConsolidationForRevert = {
  id: string;
  appliedAt: string;
  mergedRoute: { id: string; name: string | null } | null;
  sources: Array<{ id: string; name: string | null }>;
};

export default function RouteConsolidationRevertModal({
  consolidation,
  onClose,
  onReverted,
}: {
  consolidation: ConsolidationForRevert;
  onClose: () => void;
  onReverted: (consolidationId: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [reverting, setReverting] = useState(false);
  const [guardsBlocking, setGuardsBlocking] = useState<GuardCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runRevert = async () => {
    setReverting(true); setError(null); setGuardsBlocking(null);
    try {
      const res = await fetch('/api/bus-ops/route-consolidation/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consolidationId: consolidation.id, revertReason: reason.trim() || null }),
      });
      const data = await res.json();
      if (res.status === 409 && data?.status === 'BLOCKED') {
        setGuardsBlocking(data.guards ?? []);
        setReverting(false);
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (data.status === 'REVERTED') onReverted(consolidation.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revert failed');
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Revert consolidation</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="w-5 h-5" /></button>
        </header>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-1 text-sm">
            <div className="text-slate-400 text-xs uppercase tracking-wider">Consolidation</div>
            <div className="font-mono text-[11px] text-slate-500">{consolidation.id}</div>
            <div className="mt-2 text-slate-300">
              <span className="text-slate-500">Merged:</span> {consolidation.mergedRoute?.name ?? '(none)'}
            </div>
            <div className="text-slate-300">
              <span className="text-slate-500">Sources:</span> {consolidation.sources.map((s) => s.name ?? s.id.slice(0, 8)).join(' + ')}
            </div>
            <div className="text-xs text-slate-500 mt-2">Applied {new Date(consolidation.appliedAt).toLocaleString()}</div>
          </div>

          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Reverting will reactivate the source routes, restore each enrolment to its original route + stops, and archive the merged route. Lineage is preserved; the merged route is <em>not</em> deleted.
          </div>

          <label className="block">
            <div className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Reason (optional)</div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='e.g. "capacity issue only surfaced after apply"'
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>

          {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}

          {guardsBlocking && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 space-y-2">
              <div className="text-sm font-semibold text-rose-200">Revert refused by guards</div>
              <ul className="space-y-1.5">
                {guardsBlocking.filter((g) => g.status === 'BLOCK').map((g) => (
                  <li key={g.code} className="text-xs">
                    <div className="font-mono text-rose-300">{g.code}</div>
                    <div className="text-slate-400 mt-0.5">{g.message}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-800 px-6 py-4">
          <button onClick={onClose} disabled={reverting} className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">Cancel</button>
          <button
            onClick={runRevert}
            disabled={reverting || guardsBlocking !== null}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {reverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} {reverting ? 'Reverting…' : 'Revert'}
          </button>
        </footer>
      </div>
    </div>
  );
}
