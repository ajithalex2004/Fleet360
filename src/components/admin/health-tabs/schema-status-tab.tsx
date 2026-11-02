'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Database, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';

interface ModuleRow {
  name: string;
  tables: number;
  columns: number;
  missing: string[];
}

interface Status {
  status: 'ok' | 'incomplete' | 'unknown';
  missingCount: number;
  checkedAt: string;
  error?: string;
  modules: ModuleRow[];
  runtimeDdl: 'allowed' | 'disabled';
}

export function SchemaStatusTab() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/schema-status', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load schema status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-[var(--border-subtle)]">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-main)] flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            <span>Database Schema Registry & Migrations</span>
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Verifies that all required PostgreSQL tables, columns, and relations are present in production without runtime DDL errors.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Verifying Schema...' : 'Verify Schema Now'}</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl px-4 py-3 text-xs bg-rose-500/15 border border-rose-500/30 text-rose-300 flex items-center gap-2">
          <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Banner Card */}
      {data && (
        <div
          className={`rounded-2xl p-4 border flex items-center justify-between flex-wrap gap-3 ${
            data.status === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : data.status === 'incomplete'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}
        >
          <div className="flex items-center gap-3">
            {data.status === 'ok' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : data.status === 'incomplete' ? (
              <AlertTriangle className="w-5 h-5 text-rose-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            )}
            <div>
              <div className="text-sm font-bold text-[var(--text-main)]">
                {data.status === 'ok'
                  ? 'Schema Registry In Sync'
                  : data.status === 'incomplete'
                  ? `${data.missingCount} Missing Schema Object(s)`
                  : 'Schema Verification Error'}
              </div>
              <div className="text-xs opacity-90 mt-0.5">
                {data.status === 'ok'
                  ? 'All tables, foreign keys, and column definitions expected by the application runtime exist in Neon PostgreSQL.'
                  : data.status === 'incomplete'
                  ? 'Missing tables/columns detected — run `npx prisma migrate deploy` to synchronize migrations.'
                  : data.error ?? 'Unable to verify schema registry against database'}
              </div>
            </div>
          </div>
          <div className="text-xs font-mono opacity-80">
            Checked: {new Date(data.checkedAt).toLocaleTimeString()} &bull; DDL: {data.runtimeDdl}
          </div>
        </div>
      )}

      {/* Module Schema Table */}
      {data && (
        <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]/60">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-surface-hover)]/70 text-[var(--text-muted)] uppercase tracking-wider font-semibold border-b border-[var(--border-subtle)]">
              <tr>
                <th className="text-left px-4 py-3">Module Namespace</th>
                <th className="text-left px-4 py-3">Checked Elements</th>
                <th className="text-left px-4 py-3">Verification Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {data.modules.map((m) => (
                <tr key={m.name} className="hover:bg-[var(--bg-surface-hover)]/40 transition-colors">
                  <td className="px-4 py-3 font-semibold text-[var(--text-main)]">{m.name}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)] font-mono">
                    {m.tables} tables{m.columns ? `, ${m.columns} columns` : ''}
                  </td>
                  <td className="px-4 py-3">
                    {m.missing.length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>All Present</span>
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-rose-400 font-semibold">
                        Missing: {m.missing.join(', ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2.5 text-[11px] text-[var(--text-faint)] border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between">
            <span>Verified across {data.modules.length} registered core system modules</span>
            <span className="font-mono">Prisma schema / Neon PostgreSQL</span>
          </div>
        </div>
      )}
    </div>
  );
}
