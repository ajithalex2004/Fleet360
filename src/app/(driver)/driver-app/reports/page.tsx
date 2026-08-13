/**
 * src/app/(driver)/driver-app/reports/page.tsx
 *
 * "My reports" list. Shows the driver's recent REQUEST and INCIDENT
 * reports with status. Filter chips by kind (All / Requests / Incidents)
 * and by status (Open / Acknowledged / In progress / Resolved /
 * Cancelled). Tapping a card opens the detail (we render an inline
 * detail panel for now; a dedicated page is a follow-up).
 *
 * Driver can cancel their own OPEN reports from the detail panel.
 */

'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/driver-app/BackButton';
import {
  STATUS_META,
  SEVERITY_META,
  getTypeMeta,
  getSubtypeMeta,
  type ReportKind,
  type ReportStatus,
  type Severity,
} from '@/lib/driver-reports';

interface Report {
  id: string;
  kind: ReportKind;
  type: string;
  subtype: string | null;
  severity: Severity | null;
  title: string;
  description: string | null;
  status: ReportStatus;
  tripId: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

type KindFilter = 'ALL' | ReportKind;
type StatusFilter = 'ALL' | ReportStatus;

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'REQUEST', label: 'Requests' },
  { id: 'INCIDENT', label: 'Incidents' },
];
const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'OPEN', label: 'Open' },
  { id: 'ACK', label: 'Acknowledged' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'RESOLVED', label: 'Resolved' },
  { id: 'CANCELLED', label: 'Cancelled' },
];

function ReportsInner() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (kindFilter !== 'ALL') params.set('kind', kindFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      params.set('limit', '50');
      const r = await fetch(`/api/driver-app/reports?${params.toString()}`, { credentials: 'include' });
      if (!r.ok) {
        setErr(`Failed to load (${r.status})`);
        setReports([]);
        return;
      }
      const data = await r.json();
      setReports(data.reports ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error');
      setReports([]);
    }
  }, [kindFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const cancel = useCallback(async (id: string) => {
    if (!window.confirm('Cancel this report? The dispatcher will no longer see it as open.')) return;
    setCancellingId(id);
    try {
      const r = await fetch(`/api/driver-app/reports/${id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        window.alert(body.reason ?? body.error ?? `Failed (${r.status})`);
        return;
      }
      await load();
    } finally {
      setCancellingId(null);
    }
  }, [load]);

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-950 pb-24">
      <header className="border-b border-white/10 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">My reports</div>
            <div className="text-xl font-bold text-white truncate">Recent submissions</div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/driver-app/report')}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500"
          >
            + New
          </button>
        </div>
      </header>

      <main className="space-y-3 px-4 py-4">
        {/* Filter chips */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setKindFilter(f.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  kindFilter === f.id
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  statusFilter === f.id
                    ? 'bg-sky-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        {/* List */}
        {reports === null ? (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 text-sm text-slate-400">
            {kindFilter === 'ALL' && statusFilter === 'ALL'
              ? 'No reports yet. Tap "+ New" to file one.'
              : 'No reports match these filters.'}
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                expanded={selectedId === r.id}
                onExpand={() => setSelectedId(selectedId === r.id ? null : r.id)}
                onCancel={() => cancel(r.id)}
                cancelling={cancellingId === r.id}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ReportCard({
  report,
  expanded,
  onExpand,
  onCancel,
  cancelling,
}: {
  report: Report;
  expanded: boolean;
  onExpand: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const meta = getTypeMeta(report.kind, report.type);
  const subtypeMeta = report.subtype ? getSubtypeMeta(report.subtype) : null;
  const statusMeta = STATUS_META[report.status];
  const severityMeta = report.severity ? SEVERITY_META[report.severity] : null;
  const ageStr = timeAgo(report.createdAt);

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900">
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <div className="text-3xl">{meta?.emoji ?? '📋'}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {meta?.label ?? report.type}
            </span>
            {subtypeMeta && (
              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
                {subtypeMeta.label}
              </span>
            )}
            {severityMeta && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${severityMeta.cls}`}>
                {severityMeta.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-white">{report.title}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <span>{ageStr}</span>
            <span>·</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${statusMeta.cls}`}>
              {statusMeta.label}
            </span>
          </div>
        </div>
        <div className="text-slate-500">{expanded ? '▾' : '▸'}</div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4">
          {report.description && (
            <p className="text-sm text-slate-300">{report.description}</p>
          )}

          {/* Status timeline */}
          <div className="mt-3 space-y-1 text-[11px] text-slate-400">
            {report.acknowledgedAt && (
              <div>✓ Acknowledged {timeAgo(report.acknowledgedAt)}</div>
            )}
            {report.resolvedAt && (
              <div className="text-emerald-300">✓ Resolved {timeAgo(report.resolvedAt)}</div>
            )}
            {report.resolutionNotes && (
              <div className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-200">
                <span className="font-semibold">Dispatcher note: </span>{report.resolutionNotes}
              </div>
            )}
            {report.cancelledAt && (
              <div className="text-slate-500">✕ Cancelled {timeAgo(report.cancelledAt)}</div>
            )}
          </div>

          {/* Actions */}
          {report.status === 'OPEN' && (
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              className="mt-3 w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
            >
              {cancelling ? 'Cancelling…' : 'Cancel report'}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">Loading…</div>}>
      <ReportsInner />
    </Suspense>
  );
}
