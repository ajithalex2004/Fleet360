'use client';
/**
 * Admin > Departments: the company's Department master. A user's
 * department in this company is chosen from it (Admin > Users > Module
 * Access).
 */
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface Department { id: string; name: string; code: string | null; isActive: boolean; memberCount: number }

const INPUT = 'w-full px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:outline-none focus:border-violet-500';

function DepartmentsMaster() {
  // A platform admin arriving from Users › Module Access manages that company's list.
  const tenantId = useSearchParams().get('tenantId') ?? '';
  const scope = tenantId ? `tenantId=${encodeURIComponent(tenantId)}` : '';
  const api = (path = '', extra = '') => `/api/admin/departments${path}?${[scope, extra].filter(Boolean).join('&')}`;
  const [rows, setRows] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', code: '' });
  const [editing, setEditing] = useState<{ id: string; name: string; code: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(api('', 'includeInactive=true'), { cache: 'no-store' });
      const d = await res.json().catch(() => []);
      if (!res.ok) throw new Error(d.error ?? `Failed to load (${res.status})`);
      setRows(Array.isArray(d) ? d : []);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load departments'); }
    finally { setLoading(false); }
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const send = async (url: string, method: string, body?: unknown) => {
    setSaving(true); setError('');
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `Failed (${res.status})`);
      await load();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); return false; }
    finally { setSaving(false); }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await send(api(), 'POST', { name: form.name, code: form.code || null })) setForm({ name: '', code: '' });
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (await send(api(`/${editing.id}`), 'PATCH', { name: editing.name, code: editing.code || null })) setEditing(null);
  };

  const remove = async (d: Department) => {
    const note = d.memberCount ? ` ${d.memberCount} user(s) in it will have no department.` : '';
    if (!confirm(`Delete the department "${d.name}"?${note}`)) return;
    await send(api(`/${d.id}`), 'DELETE');
  };

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-main)]">Departments</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">This company&apos;s departments. A user&apos;s department is chosen from this list in Users › Module Access.</p>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="dept-name" className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Name *</label>
          <input id="dept-name" className={INPUT} value={form.name} required maxLength={120} placeholder="Operations"
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </div>
        <div className="w-40">
          <label htmlFor="dept-code" className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Code</label>
          <input id="dept-code" className={INPUT} value={form.code} maxLength={40} placeholder="OPS"
            onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
        </div>
        <button type="submit" disabled={saving}
          className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
          + Add department
        </button>
      </form>

      <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-[var(--text-muted)] animate-pulse">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-[var(--text-muted)]">No departments yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-surface-hover)]">
              <tr>
                {['Name', 'Code', 'Users', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {rows.map((d) => (
                <tr key={d.id} className={d.isActive ? '' : 'opacity-60'}>
                  <td className="px-4 py-3 text-[var(--text-main)] font-medium">
                    {editing?.id === d.id
                      ? <input aria-label="Department name" className={INPUT} value={editing.name} maxLength={120} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                      : d.name}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {editing?.id === d.id
                      ? <input aria-label="Department code" className={INPUT} value={editing.code} maxLength={40} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
                      : (d.code ?? '—')}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{d.memberCount}</td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{d.isActive ? 'Active' : 'Inactive'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {editing?.id === d.id ? (
                        <>
                          <button onClick={saveEdit} disabled={saving} className="px-2.5 py-1.5 text-xs rounded-lg bg-blue-600 text-white">Save</button>
                          <button onClick={() => setEditing(null)} className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)]">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditing({ id: d.id, name: d.name, code: d.code ?? '' })}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">Edit</button>
                          <button onClick={() => send(api(`/${d.id}`), 'PATCH', { isActive: !d.isActive })}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/30">{d.isActive ? 'Deactivate' : 'Activate'}</button>
                          <button onClick={() => remove(d)}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/30">Delete</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for the static build.
export default function DepartmentsPage() {
  return <Suspense fallback={null}><DepartmentsMaster /></Suspense>;
}
