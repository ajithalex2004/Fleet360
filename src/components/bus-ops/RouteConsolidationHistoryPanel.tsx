'use client';

/**
 * RouteConsolidationHistoryPanel — read view over
 * GET /api/bus-ops/route-consolidations.
 *
 * Table of past consolidations (APPLIED + REVERTED), most recent first.
 * Per-row "Revert" button appears for APPLIED rows whose appliedAt is
 * within the revert window (default 24h; UI mirrors the engine env
 * flag RC_REVERT_WINDOW_HOURS). The window is a heuristic — the
 * engine re-checks its own guards at revert time, so out-of-window
 * clicks fail cleanly.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw, Undo2, CheckCircle2, XCircle } from 'lucide-react';
import RouteConsolidationRevertModal, { type ConsolidationForRevert } from '@/components/bus-ops/RouteConsolidationRevertModal';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';

interface HistoryRow {
  id: string;
  status: 'APPLIED' | 'REVERTED';
  recommendationId: string;
  appliedAt: string;
  appliedBy: string;
  revertedAt: string | null;
  revertedBy: string | null;
  revertReason: string | null;
  mergedRoute: { id: string; name: string | null; retiredReason: string | null } | null;
  sources: Array<{ id: string; name: string | null; sequence: number }>;
}

// Same default as the engine's readRevertWindowMs — env-overridable
// server-side. UI shows the button optimistically; the API re-checks.
const REVERT_WINDOW_HOURS = 24;

export default function RouteConsolidationHistoryPanel() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reverting, setReverting] = useState<ConsolidationForRevert | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/bus-ops/route-consolidations', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRows(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const historyColumns: DataGridColumn<HistoryRow>[] = [
    { key: 'status', header: 'Status', accessor: r => r.status, filter: 'select',
      render: r => <StatusPill status={r.status} /> },
    { key: 'mergedRoute', header: 'Merged route', accessor: r => r.mergedRoute?.name,
      render: r => (
        <div>
          <div className="font-medium">{r.mergedRoute?.name ?? '(no merged route)'}</div>
          <div className="font-mono text-[10px] text-slate-500">{r.mergedRoute?.id.slice(0, 8) ?? '—'}</div>
        </div>
      ) },
    { key: 'sources', header: 'Sources', accessor: r => r.sources.map(s => s.name ?? s.id).join(' + '),
      render: r => <span className="text-xs text-slate-400">{r.sources.map((s) => s.name ?? s.id.slice(0, 8)).join(' + ')}</span> },
    { key: 'applied', header: 'Applied', accessor: r => r.appliedAt,
      render: r => (
        <div className="text-xs">
          <div className="text-slate-300">{new Date(r.appliedAt).toLocaleString()}</div>
          <div className="text-slate-500">by {r.appliedBy}</div>
        </div>
      ) },
    { key: 'reverted', header: 'Reverted', accessor: r => r.revertedAt,
      render: r => r.revertedAt ? (
        <div className="text-xs">
          <div className="text-slate-300">{new Date(r.revertedAt).toLocaleString()}</div>
          <div className="text-slate-500">by {r.revertedBy}</div>
          {r.revertReason && <div className="text-slate-500 mt-0.5 italic">{r.revertReason}</div>}
        </div>
      ) : <span className="text-slate-600">—</span> },
    { key: 'rowActions', header: 'Actions', align: 'right', filter: false, sortable: false,
      render: r => {
        const withinWindow = revertEligibleWindow(r);
        const canRevert = r.status === 'APPLIED' && withinWindow;
        return canRevert ? (
          <button
            onClick={() => setReverting({
              id: r.id,
              appliedAt: r.appliedAt,
              mergedRoute: r.mergedRoute,
              sources: r.sources,
            })}
            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/20"
          >
            <Undo2 className="w-3.5 h-3.5" /> Revert
          </button>
        ) : r.status === 'APPLIED' && !withinWindow ? (
          <span className="text-xs text-slate-500" title={`Revert window (${REVERT_WINDOW_HOURS}h) elapsed`}>outside window</span>
        ) : (
          <span className="text-xs text-slate-600">—</span>
        );
      } },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <History className="w-4 h-4" /> Applied consolidations
        </h3>
        <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {loading && rows.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400 animate-pulse">Loading history…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-400">
          <History className="mx-auto h-10 w-10 text-slate-600 mb-3" />
          <p>No consolidations applied yet in this tenant.</p>
          <p className="mt-1 text-xs text-slate-500">Apply a recommendation from the Recommendations tab to populate this view.</p>
        </div>
      ) : (
        <FleetDataGrid
          gridName="RouteConsolidationHistory"
          rows={rows}
          getRowId={r => r.id}
          loading={false}
          emptyMessage="No consolidations applied yet in this tenant."
          columns={historyColumns}
          numbered
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          toolbar={{
            exportName: 'route-consolidation-history',
            title: 'Applied Consolidations',
            actions: selectedIds.size > 0 ? (
              <span className="inline-flex items-center gap-2 text-xs text-violet-300">
                {selectedIds.size} selected
                <button type="button" onClick={() => setSelectedIds(new Set())}
                  className="text-slate-400 hover:text-white underline underline-offset-2">
                  Clear
                </button>
              </span>
            ) : undefined,
          }}
        />
      )}

      {reverting && (
        <RouteConsolidationRevertModal
          consolidation={reverting}
          onClose={() => setReverting(null)}
          onReverted={async () => { setReverting(null); await load(); }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: 'APPLIED' | 'REVERTED' }) {
  const cls = status === 'APPLIED'
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : 'bg-slate-500/20 text-slate-300 border-slate-500/40';
  const Icon = status === 'APPLIED' ? CheckCircle2 : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      <Icon className="w-3 h-3" /> {status}
    </span>
  );
}

function revertEligibleWindow(r: HistoryRow): boolean {
  const elapsed = Date.now() - new Date(r.appliedAt).getTime();
  return elapsed <= REVERT_WINDOW_HOURS * 3600_000;
}
