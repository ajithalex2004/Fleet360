'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, RefreshCw, AlertTriangle, CheckCircle2, Play, SkipForward, XCircle, type LucideIcon } from 'lucide-react';

interface Run {
  id: string;
  jobName: string;
  scope: string;
  occurrence: string;
  trigger: string;
  owner: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
}

const STATUS_BADGES: Record<string, { bg: string; text: string; border: string; icon: LucideIcon }> = {
  SUCCEEDED: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    icon: CheckCircle2,
  },
  FAILED: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
    icon: XCircle,
  },
  RUNNING: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    icon: Play,
  },
  SKIPPED: {
    bg: 'bg-zinc-500/10',
    text: 'text-zinc-400',
    border: 'border-zinc-500/30',
    icon: SkipForward,
  },
};

export function JobRunsTab() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [job, setJob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/job-runs?limit=300${job ? `&job=${encodeURIComponent(job)}` : ''}`,
        { cache: 'no-store' }
      );
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setRuns(d.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load job runs');
    } finally {
      setLoading(false);
    }
  }, [job]);

  useEffect(() => {
    void load();
  }, [load]);

  const jobs = useMemo(() => [...new Set(runs.map((r) => r.jobName))].sort(), [runs]);
  const failedCount = runs.filter((r) => r.status === 'FAILED').length;
  const runningCount = runs.filter((r) => r.status === 'RUNNING').length;

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4 pb-2 border-b border-[var(--border-subtle)]">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-main)] flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            <span>Background Job Scheduler Execution History</span>
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Distributed execution lock ensures exactly one worker process claims each scheduled occurrence without double execution.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={job}
            onChange={(e) => setJob(e.target.value)}
            aria-label="Filter by job name"
            className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          >
            <option value="">All Registered Jobs ({jobs.length})</option>
            {jobs.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Refreshing...' : 'Refresh Logs'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl px-4 py-3 text-xs bg-rose-500/15 border border-rose-500/30 text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]">
          <div className="text-[var(--text-muted)]">Total Logged Runs</div>
          <div className="text-lg font-bold text-[var(--text-main)] font-mono mt-0.5">{runs.length}</div>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]">
          <div className="text-[var(--text-muted)]">Succeeded (24h)</div>
          <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
            {runs.filter((r) => r.status === 'SUCCEEDED').length}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]">
          <div className="text-[var(--text-muted)]">Failed Runs</div>
          <div className={`text-lg font-bold font-mono mt-0.5 ${failedCount > 0 ? 'text-rose-400' : 'text-[var(--text-muted)]'}`}>
            {failedCount}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)]">
          <div className="text-[var(--text-muted)]">Active Workers</div>
          <div className="text-lg font-bold text-blue-400 font-mono mt-0.5">{runningCount}</div>
        </div>
      </div>

      {/* Execution Logs Table */}
      <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-surface-hover)]/70 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
              <tr>
                <th className="text-left px-3.5 py-3 whitespace-nowrap">Job Task</th>
                <th className="text-left px-3.5 py-3 whitespace-nowrap">Status</th>
                <th className="text-left px-3.5 py-3 whitespace-nowrap">Started At</th>
                <th className="text-left px-3.5 py-3 whitespace-nowrap">Duration</th>
                <th className="text-left px-3.5 py-3 whitespace-nowrap">Trigger</th>
                <th className="text-left px-3.5 py-3 whitespace-nowrap">Scope</th>
                <th className="text-left px-3.5 py-3">Outcome Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {runs.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                    No matching background runs recorded in `job_runs` table.
                  </td>
                </tr>
              )}
              {runs.map((r) => {
                const badge = STATUS_BADGES[r.status] || STATUS_BADGES.SKIPPED;
                const Icon = badge.icon;
                return (
                  <tr key={r.id} className="hover:bg-[var(--bg-surface-hover)]/40 transition-colors align-top">
                    <td className="px-3.5 py-2.5 font-semibold text-[var(--text-main)] whitespace-nowrap font-mono">
                      {r.jobName}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        <Icon className="w-3 h-3" />
                        <span>{r.status}</span>
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap text-[var(--text-muted)] font-mono">
                      {new Date(r.startedAt).toLocaleString()}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap text-[var(--text-muted)] font-mono">
                      {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(2)}s` : '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-[var(--text-muted)] whitespace-nowrap" title={r.owner}>
                      {r.trigger}
                    </td>
                    <td className="px-3.5 py-2.5 text-[var(--text-muted)] whitespace-nowrap">
                      {r.scope === '*' ? 'All Tenants' : 'Tenant Scoped'}
                    </td>
                    <td className="px-3.5 py-2.5 text-[var(--text-muted)] max-w-sm">
                      {r.error ? (
                        <span className="text-rose-400 font-medium font-mono text-[11px] block truncate" title={r.error}>
                          {r.error}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)] text-[11px] block truncate" title={r.summary || ''}>
                          {r.summary || 'Nominal execution'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 text-[11px] text-[var(--text-faint)] border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between">
          <span>Kept for 30 days &bull; Distributed leader lock via PostgreSQL row claim</span>
          <span>Showing up to 300 latest runs</span>
        </div>
      </div>
    </div>
  );
}
