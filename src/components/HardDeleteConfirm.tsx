'use client';

/**
 * HardDeleteConfirm — 2-step destructive-action dialog.
 *
 * Step 1 (preview): POSTs `?dryRun=true` and shows what would be deleted
 *   (a per-table count for tenants, a single count for users).
 *   The user must type the target's identifier to confirm.
 *
 * Step 2 (execute): POSTs `?dryRun=false`. On success, calls `onDone`
 *   so the parent can refresh.
 *
 * SAFETY:
 *  - Dry-run is the default. Execute is explicit.
 *  - The user must type the exact identifier (tenant name / user email)
 *    to enable the Execute button — no accidental clicks.
 *  - All runs (dry AND execute) are recorded server-side in
 *    platform_audit_log.
 */

import { useState, useEffect } from 'react';

interface TableCount { name: string; rowCount: number; }
interface PreviewState {
  dryRun: true;
  tenant?: { id: string; name: string };
  user?:   { id: string; email: string; username?: string; firstName?: string; lastName?: string };
  tables?: TableCount[];
  counts?: { memberships: number };
  totalRows?: number;
}

interface ResultState {
  dryRun: false;
  tenant?: { id: string; name: string };
  user?:   { id: string; email: string };
  tables?: TableCount[];
  counts?: { memberships?: number; membershipsDeleted?: number; userDeleted?: number };
  totalRows?: number;
}

interface Props {
  /** Title of the modal. e.g. "Hard delete tenant" */
  title: string;
  /** What the user is being asked to delete. */
  target: {
    /** Type discriminator — shown in the API URL. */
    kind: 'tenant' | 'user';
    id:   string;
    /** The string the user must type to confirm (tenant name / user email). */
    confirmText: string;
  };
  /** Short message above the table. e.g. "This will permanently remove..." */
  description: string;
  /** Called after successful execute so the parent can refresh. */
  onDone: () => void;
  onCancel: () => void;
}

export function HardDeleteConfirm({ title, target, description, onDone, onCancel }: Props) {
  const [step, setStep]       = useState<'preview' | 'execute' | 'done'>('preview');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [result, setResult]   = useState<ResultState | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [typed, setTyped]     = useState('');
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  // Auto-load the dry-run preview on mount.
  useEffect(() => { void loadPreview(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const url = target.kind === 'tenant'
    ? `/api/admin/tenants/${target.id}/hard-delete`
    : `/api/admin/users/${target.id}/hard-delete`;

  function formatApiError(data: unknown, status: number): string {
    const d = data as { error?: string; message?: string } | null;
    if (d?.error && d.message) return `${d.error}: ${d.message}`;
    if (d?.error) return d.error;
    if (d?.message) return d.message;
    return `HTTP ${status}`;
  }

  async function loadPreview() {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${url}?dryRun=true`);
      const data = await r.json();
      if (!r.ok) {
        setError(formatApiError(data, r.status));
        return;
      }
      setPreview(data as PreviewState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  async function executeDelete() {
    if (typed !== target.confirmText) {
      setError(`Type "${target.confirmText}" exactly to confirm.`);
      return;
    }
    setExecuting(true); setError(null);
    try {
      const r = await fetch(`${url}?dryRun=false`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) {
        setError(formatApiError(data, r.status));
        return;
      }
      setResult(data as ResultState);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-rose-500/30 rounded-2xl flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-rose-500/20 bg-rose-950/30 flex items-start justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-rose-300 flex items-center gap-2">
              <span>⚠️</span> {title}
            </h2>
            <p className="text-rose-200/80 text-xs mt-1">{description}</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          {loading && (
            <div className="text-slate-400 text-sm">Loading preview…</div>
          )}

          {/* ── Preview step ── */}
          {step === 'preview' && preview && (
            <>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Target</div>
                <div className="text-white font-mono text-sm">
                  {target.kind === 'tenant' ? preview.tenant?.name : preview.user?.email}
                </div>
              </div>

              {target.kind === 'tenant' && preview.tables && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                    Would delete from {preview.tables.length} table(s) — total {preview.totalRows ?? 0} row(s)
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/50">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-800 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-slate-300 font-medium">Table</th>
                          <th className="text-right px-3 py-2 text-slate-300 font-medium">Rows</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.tables.map(t => (
                          <tr key={t.name} className="border-t border-white/5">
                            <td className="px-3 py-1.5 text-slate-300 font-mono">{t.name}</td>
                            <td className="px-3 py-1.5 text-right text-rose-300 font-medium">{t.rowCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {target.kind === 'user' && preview.counts && (
                <div className="p-3 rounded-lg bg-slate-800/50 border border-white/10 text-sm">
                  Would delete:
                  <ul className="mt-2 space-y-1 ml-4 list-disc text-slate-300">
                    <li><span className="font-mono">{preview.user?.email}</span> (the User row)</li>
                    {preview.counts.memberships > 0 && (
                      <li><span className="text-rose-300 font-medium">{preview.counts.memberships}</span> UserTenant membership(s) across all tenants</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs">
                <strong>This is irreversible.</strong> All deleted data is gone permanently. An audit log entry is created either way.
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Type <code className="px-1 py-0.5 rounded bg-slate-800 text-rose-300">{target.confirmText}</code> to confirm
                </label>
                <input
                  className="w-full px-3 py-2 rounded border border-white/10 bg-slate-900 text-white text-sm focus:outline-none focus:border-rose-500"
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  placeholder={target.confirmText}
                  autoComplete="off"
                />
              </div>
            </>
          )}

          {/* ── Done step ── */}
          {step === 'done' && result && (
            <div className="text-sm space-y-2">
              <div className="text-emerald-300 font-medium">
                ✓ Hard delete complete.
              </div>
              {result.tenant && (
                <div>Tenant: <span className="font-mono">{result.tenant.name}</span></div>
              )}
              {result.user && (
                <div>User: <span className="font-mono">{result.user.email}</span></div>
              )}
              {result.tables && result.totalRows !== undefined && (
                <div>Deleted <span className="text-rose-300 font-medium">{result.totalRows}</span> row(s) across {result.tables.length} table(s).</div>
              )}
              {result.counts && result.counts.userDeleted !== undefined && (
                <div>
                  Deleted 1 user{result.counts.membershipsDeleted !== undefined && result.counts.membershipsDeleted > 0
                    ? <> and <span className="text-rose-300 font-medium">{result.counts.membershipsDeleted}</span> membership(s)</>
                    : null}
                  .
                </div>
              )}
              <div className="text-slate-500 text-xs mt-2">Audit log entry recorded.</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2 flex-shrink-0">
          {step === 'preview' && (
            <>
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded border border-white/10 text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => void executeDelete()}
                disabled={executing || typed !== target.confirmText || !preview}
                className="px-4 py-2 text-sm rounded bg-rose-600 hover:bg-rose-500 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {executing ? 'Deleting…' : 'Hard delete (irreversible)'}
              </button>
            </>
          )}
          {step === 'done' && (
            <button
              onClick={onDone}
              className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
