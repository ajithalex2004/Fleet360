'use client';
/**
 * Admin > Schema status — platform admins only. Lists, per module, any table
 * or column the app needs that is missing from the database, so a deploy
 * whose migrations were not applied is visible here (and in /api/readyz)
 * instead of as failing requests. Data: GET /api/admin/schema-status.
 */
import React, { useCallback, useEffect, useState } from 'react';

interface ModuleRow { name: string; tables: number; columns: number; missing: string[] }
interface Status {
  status: 'ok' | 'incomplete' | 'unknown';
  missingCount: number;
  checkedAt: string;
  error?: string;
  modules: ModuleRow[];
  runtimeDdl: 'allowed' | 'disabled';
}

export default function SchemaStatusPage() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/schema-status', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load schema status');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const banner = !data ? null
    : data.status === 'ok'
      ? { cls: 'bg-emerald-600 text-white', text: 'All tables and columns the app needs are present.' }
      : data.status === 'incomplete'
        ? { cls: 'bg-rose-700 text-white', text: `${data.missingCount} missing — apply the pending migrations (prisma migrate deploy).` }
        : { cls: 'bg-amber-600 text-white', text: `Could not check the database: ${data.error ?? 'unknown error'}` };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-1">Schema status</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Tables and columns the app checks at runtime. Migrations own the schema; the app does not create tables in production.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50">
          {loading ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl px-4 py-3 text-sm bg-rose-700 text-white">{error}</div>}
      {banner && <div role="status" className={`rounded-xl px-4 py-3 text-sm font-medium ${banner.cls}`}>{banner.text}</div>}

      {data && (
        <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)] text-xs uppercase">
              <tr><th className="text-left px-4 py-2">Module</th><th className="text-left px-4 py-2">Checks</th><th className="text-left px-4 py-2">Missing</th></tr>
            </thead>
            <tbody>
              {data.modules.map((m) => (
                <tr key={m.name} className="border-t border-[var(--border-subtle)]">
                  <td className="px-4 py-2 font-medium text-[var(--text-main)]">{m.name}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{m.tables} tables{m.columns ? `, ${m.columns} columns` : ''}</td>
                  <td className="px-4 py-2">
                    {m.missing.length === 0
                      ? <span className="text-emerald-600 font-medium">None</span>
                      : <span className="font-mono text-xs text-rose-600">{m.missing.join(', ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
            Checked {new Date(data.checkedAt).toLocaleString()} · runtime table creation {data.runtimeDdl}
          </div>
        </div>
      )}
    </div>
  );
}
