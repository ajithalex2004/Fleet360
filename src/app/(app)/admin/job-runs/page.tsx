'use client';
/**
 * Admin > Job runs — platform admins only. Recent background-job runs from
 * job_runs (src/lib/jobs/job-runs.ts): when each started, which process ran
 * it, how long it took, and the outcome. Data: GET /api/admin/job-runs.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface Run {
  id: string; jobName: string; scope: string; occurrence: string; trigger: string; owner: string;
  status: string; startedAt: string; finishedAt: string | null; durationMs: number | null;
  summary: string | null; error: string | null;
}

const STATUS_CLS: Record<string, string> = {
  SUCCEEDED: 'bg-emerald-600 text-white',
  FAILED: 'bg-rose-700 text-white',
  RUNNING: 'bg-blue-600 text-white',
  SKIPPED: 'bg-slate-600 text-white',
};

export default function JobRunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [job, setJob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/job-runs?limit=300${job ? `&job=${encodeURIComponent(job)}` : ''}`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setRuns(d.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load job runs');
    } finally { setLoading(false); }
  }, [job]);

  useEffect(() => { void load(); }, [load]);

  const jobs = useMemo(() => [...new Set(runs.map((r) => r.jobName))].sort(), [runs]);
  const failed = runs.filter((r) => r.status === 'FAILED').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-1">Job runs</h1>
          <p className="text-xs text-[var(--text-muted)] max-w-2xl">
            Every background-job run is claimed before it starts: one run per scheduled minute across all web servers,
            and never two runs of the same job at once. Kept for 30 days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={job} onChange={(e) => setJob(e.target.value)} aria-label="Filter by job"
            className="px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm">
            <option value="">All jobs</option>
            {jobs.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl px-4 py-3 text-sm bg-rose-700 text-white">{error}</div>}
      {!error && runs.length > 0 && (
        <div role="status" className="text-sm text-[var(--text-muted)]">
          {runs.length} run(s) shown{failed ? ` · ${failed} failed` : ''}
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border-subtle)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)] text-xs uppercase">
            <tr>
              {['Job', 'Status', 'Started', 'Duration', 'Trigger', 'Scope', 'Result'].map((h) => (
                <th key={h} className="text-left px-3 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[var(--text-muted)]">No runs recorded yet.</td></tr>
            )}
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border-subtle)] align-top">
                <td className="px-3 py-2 font-medium text-[var(--text-main)] whitespace-nowrap">{r.jobName}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_CLS[r.status] ?? 'bg-slate-600 text-white'}`}>{r.status}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--text-muted)]">{new Date(r.startedAt).toLocaleString()}</td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--text-muted)]">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)} s` : '—'}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]" title={r.owner}>{r.trigger}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{r.scope === '*' ? 'All tenants' : 'One tenant'}</td>
                <td className="px-3 py-2 text-[var(--text-muted)] max-w-md">
                  <span className={r.error ? 'text-rose-600' : ''}>{(r.error ?? r.summary ?? '').split('\n')[0]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
