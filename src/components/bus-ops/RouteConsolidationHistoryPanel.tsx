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
import { History, RefreshCw, Undo2, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
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
  /** Rows queued for permanent deletion, pending confirmation. */
  const [deleting, setDeleting] = useState<HistoryRow[] | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  /**
   * Deletes the confirmed rows one at a time and reports partial outcomes.
   * Sequential rather than Promise.all so a mid-batch failure leaves a
   * clear "N of M" result instead of an indeterminate mix — and so the
   * server isn't hit with a burst of writes against the same table.
   */
  const confirmDelete = useCallback(async () => {
    if (!deleting?.length) return;
    setDeleteBusy(true); setDeleteError(null);
    const failures: string[] = [];
    let ok = 0;
    let gone = 0;

    for (const row of deleting) {
      try {
        const res = await fetch(`/api/bus-ops/route-consolidations/${row.id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        // 404 means the row is already absent, which is the outcome the
        // operator asked for — delete is idempotent. This list is only
        // refetched on mount, so a tab left open while the rows were removed
        // elsewhere will offer stale ids; reporting that as a failure makes a
        // successful state look broken. Count it and let load() reconcile.
        if (res.status === 404) gone++;
        else if (!res.ok) failures.push(`${row.id.slice(0, 8)}: ${data?.error ?? `HTTP ${res.status}`}`);
        else ok++;
      } catch (e) {
        failures.push(`${row.id.slice(0, 8)}: ${e instanceof Error ? e.message : 'request failed'}`);
      }
    }

    setDeleteBusy(false);
    if (failures.length) {
      // Keep the panel open so the operator sees exactly which failed.
      const staleNote = gone ? ` ${gone} had already been removed.` : '';
      setDeleteError(`Deleted ${ok} of ${deleting.length}.${staleNote} Failed — ${failures.join('; ')}`);
    } else {
      setDeleting(null);
    }
    // Clear selection for rows that are gone, then refresh either way.
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const row of deleting) next.delete(row.id);
      return next;
    });
    await load();
  }, [deleting, load]);

  const historyColumns: DataGridColumn<HistoryRow>[] = [
    { key: 'status', header: 'Status', accessor: r => r.status, filter: 'select',
      render: r => <StatusPill status={r.status} /> },
    { key: 'mergedRoute', header: 'Merged route', accessor: r => r.mergedRoute?.name,
      render: r => (
        <div>
          <div className="font-medium">{r.mergedRoute?.name ?? '(no merged route)'}</div>
          <div className="font-mono text-[10px] text-[var(--text-faint)]">{r.mergedRoute?.id.slice(0, 8) ?? '—'}</div>
        </div>
      ) },
    { key: 'sources', header: 'Sources', accessor: r => r.sources.map(s => s.name ?? s.id).join(' + '),
      render: r => <span className="text-xs text-[var(--text-muted)]">{r.sources.map((s) => s.name ?? s.id.slice(0, 8)).join(' + ')}</span> },
    { key: 'applied', header: 'Applied', accessor: r => r.appliedAt,
      render: r => (
        <div className="text-xs">
          <div className="text-[var(--text-muted)]">{new Date(r.appliedAt).toLocaleString()}</div>
          <div className="text-[var(--text-faint)]">by {r.appliedBy}</div>
        </div>
      ) },
    { key: 'reverted', header: 'Reverted', accessor: r => r.revertedAt,
      render: r => r.revertedAt ? (
        <div className="text-xs">
          <div className="text-[var(--text-muted)]">{new Date(r.revertedAt).toLocaleString()}</div>
          <div className="text-[var(--text-faint)]">by {r.revertedBy}</div>
          {r.revertReason && <div className="text-[var(--text-faint)] mt-0.5 italic">{r.revertReason}</div>}
        </div>
      ) : <span className="text-[var(--text-faint)]">—</span> },
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
          <span className="text-xs text-[var(--text-faint)]" title={`Revert window (${REVERT_WINDOW_HOURS}h) elapsed`}>outside window</span>
        ) : (
          // REVERTED — the merge is already undone, so there is nothing left
          // to revert. The row is an audit record; deleting it is permanent.
          <button
            onClick={() => setDeleting([r])}
            title="Permanently delete this reverted consolidation's audit record"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-2 py-1 text-xs text-[var(--text-muted)] hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-200"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        );
      } },
  ];

  // Only REVERTED rows are deletable — an APPLIED row is live state and the
  // API rejects it with 409. Filtering here keeps the bulk action honest
  // rather than firing calls that are guaranteed to fail.
  const selectedDeletable = rows.filter(r => selectedIds.has(r.id) && r.status === 'REVERTED');
  const selectedBlocked = selectedIds.size - selectedDeletable.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
          <History className="w-4 h-4" /> Applied consolidations
        </h3>
        <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-3 py-1.5 text-xs text-[var(--text-main)] hover:bg-[var(--bg-surface)]">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {loading && rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-10 text-center text-[var(--text-muted)] animate-pulse">Loading history…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 p-10 text-center text-[var(--text-muted)]">
          <History className="mx-auto h-10 w-10 text-[var(--text-faint)] mb-3" />
          <p>No consolidations applied yet in this tenant.</p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">Apply a recommendation from the Recommendations tab to populate this view.</p>
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
                {selectedDeletable.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDeleting(selectedDeletable)}
                    title={
                      selectedBlocked > 0
                        ? `${selectedBlocked} selected row(s) are still APPLIED and cannot be deleted — revert them first`
                        : undefined
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200 hover:bg-rose-500/20"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete {selectedDeletable.length} reverted
                  </button>
                )}
                {selectedBlocked > 0 && (
                  <span className="text-[var(--text-faint)]">
                    ({selectedBlocked} still applied — revert first)
                  </span>
                )}
                <button type="button" onClick={() => setSelectedIds(new Set())}
                  className="text-[var(--text-muted)] hover:text-[var(--text-main)] underline underline-offset-2">
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

      {deleting && deleting.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-xl">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-rose-200">
              <Trash2 className="h-4 w-4" />
              Delete {deleting.length} reverted consolidation{deleting.length === 1 ? '' : 's'}?
            </h4>

            <p className="mt-3 text-sm text-[var(--text-muted)]">
              This permanently removes the audit record and its source and
              enrolment-migration rows. It cannot be undone.
            </p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              The merges themselves were already reverted — routes and enrolments
              are unaffected. Only the history entry is removed.
            </p>

            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 p-2 text-xs text-[var(--text-muted)]">
              {deleting.map(r => (
                <li key={r.id} className="truncate">
                  <span className="font-mono text-[var(--text-faint)]">{r.id.slice(0, 8)}</span>
                  {' · '}
                  {r.mergedRoute?.name ?? '(merged route removed)'}
                </li>
              ))}
            </ul>

            {deleteError && (
              <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {deleteError}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => { setDeleting(null); setDeleteError(null); }}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 px-3 py-1.5 text-xs text-[var(--text-main)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void confirmDelete()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleteBusy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: 'APPLIED' | 'REVERTED' }) {
  const cls = status === 'APPLIED'
    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    : 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/40';
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
