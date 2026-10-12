'use client';
/**
 * Admin > Users > Module Access: a user's department and module access in
 * one company.
 *
 * Module access narrows the user's role there; it never widens it
 * (src/lib/authz/access-mask.ts). Each module offers View / Create / Edit /
 * Delete; what the role does not grant is greyed out, with the reason, so
 * it is clear when the role itself has to change (as when a Transport
 * Manager was given Logistics here and still could not open it).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Level = 'view' | 'create' | 'edit' | 'delete';
const LEVELS: { key: Level; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create / Add' },
  { key: 'edit', label: 'Update / Edit' },
  { key: 'delete', label: 'Remove / Delete' },
];

interface ModuleRow { key: string; label: string; enabledForTenant: boolean; roleAccess: Level[] }
interface AccessData {
  tenant: { id: string; name: string };
  role: { id: string; code: string; name: string } | null;
  isPlatformAdmin: boolean;
  modules: ModuleRow[];
  moduleAccess: Record<string, Level[]> | null;
  departmentId: string | null;
  departments: { id: string; name: string; isActive: boolean }[];
}

export interface AccessMembership { tenantId: string; tenantName: string; roleName: string }

interface Props {
  user: { id: string; username: string; email: string };
  memberships: AccessMembership[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * What the user ends up with for a module: an unsaved edit, else the saved
 * selection, else (or after "reset to the role") the role's access.
 */
function selectionFor(data: AccessData, edits: Record<string, Level[]>, key: string, ignoreSaved = false): Level[] {
  if (key in edits) return edits[key];
  const row = data.modules.find((m) => m.key === key);
  const granted = row?.roleAccess ?? [];
  const saved = ignoreSaved ? undefined : data.moduleAccess?.[key];
  return saved ? saved.filter((l) => granted.includes(l)) : granted;
}

export default function UserAccessDialog({ user, memberships, onClose, onSaved }: Props) {
  const [tenantId, setTenantId] = useState(memberships[0]?.tenantId ?? '');
  const [data, setData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<Record<string, Level[]>>({});
  const [departmentId, setDepartmentId] = useState<string>('');
  const [resetToRole, setResetToRole] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError(''); setEdits({}); setResetToRole(false);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/users/${user.id}/access`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `Failed to load (${res.status})`);
      setData(d as AccessData);
      setDepartmentId((d as AccessData).departmentId ?? '');
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Failed to load the user\'s access');
    } finally { setLoading(false); }
  }, [tenantId, user.id]);

  useEffect(() => { load(); }, [load]);

  const toggle = (row: ModuleRow, level: Level) => {
    if (!data) return;
    const current = new Set(selectionFor(data, edits, row.key, resetToRole));
    if (current.has(level)) {
      current.delete(level);
      if (level === 'view') current.clear(); // nothing works without view
    } else {
      current.add(level);
      current.add('view'); // create, edit and delete need view
    }
    setEdits((p) => ({ ...p, [row.key]: LEVELS.map((l) => l.key).filter((l) => current.has(l) && row.roleAccess.includes(l)) }));
  };

  const narrowed = useMemo(() => {
    if (!data) return false;
    return data.modules.some((m) => selectionFor(data, edits, m.key, resetToRole).length !== m.roleAccess.length);
  }, [data, edits, resetToRole]);

  const save = async () => {
    if (!data) return;
    setSaving(true); setError('');
    // Only the modules narrowed below the role are stored; the others follow
    // the role, including later changes to it. None narrowed: no mask.
    let moduleAccess: Record<string, Level[]> | null = null;
    for (const m of data.modules) {
      const selected = selectionFor(data, edits, m.key, resetToRole);
      if (selected.length !== m.roleAccess.length) (moduleAccess ??= {})[m.key] = selected;
    }
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/users/${user.id}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleAccess, departmentId: departmentId || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `Failed to save (${res.status})`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl">
        <div className="px-6 py-5 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-main)]">Module Access</h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{user.username} — {user.email}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl" aria-label="Close">×</button>
        </div>

        <div className="p-6 space-y-5">
          {memberships.length === 0 && (
            <p className="text-sm text-amber-500">
              This user does not belong to any company yet. Use <strong>Tenant</strong> to add them to one with a role first.
            </p>
          )}

          {memberships.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {memberships.map((m) => (
                <button key={m.tenantId} onClick={() => setTenantId(m.tenantId)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${tenantId === m.tenantId
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'}`}>
                  {m.tenantName} · {m.roleName}
                </button>
              ))}
            </div>
          )}

          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}
          {loading && <p className="text-sm text-[var(--text-muted)] animate-pulse">Loading…</p>}

          {data && !loading && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Role in {data.tenant.name}</div>
                  <div className="text-sm text-[var(--text-main)] font-medium">{data.role?.name ?? 'No role'}</div>
                  <p className="text-xs text-[var(--text-faint)] mt-1">Change it with <strong>Tenant</strong>; what each role allows is set in Roles &amp; Permissions.</p>
                </div>
                <div>
                  <label htmlFor="access-department" className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Department</label>
                  <select id="access-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:outline-none focus:border-violet-500">
                    <option value="">— None —</option>
                    {data.departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}{d.isActive ? '' : ' (inactive)'}</option>
                    ))}
                  </select>
                  {data.departments.length === 0 && (
                    <p className="text-xs text-[var(--text-faint)] mt-1">
                      No departments yet: add them in <Link href={`/admin/departments?tenantId=${encodeURIComponent(data.tenant.id)}`} className="text-blue-500 hover:underline">Admin › Departments</Link>.
                    </p>
                  )}
                </div>
              </div>

              {data.isPlatformAdmin ? (
                <p className="text-sm text-[var(--text-muted)]">Platform administrators always have full access; module access does not apply to them.</p>
              ) : (
                <>
                  <p className="text-xs text-[var(--text-faint)]">
                    Module access can only narrow what the role allows. To give access the role does not include, choose another role
                    or create a custom role in <Link href="/admin/roles" className="text-blue-500 hover:underline">Roles &amp; Permissions</Link>.
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--bg-surface-hover)]">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Module</th>
                          {LEVELS.map((l) => (
                            <th key={l.key} className="px-3 py-2.5 text-center text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{l.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {data.modules.map((m) => {
                          const selected = selectionFor(data, edits, m.key, resetToRole);
                          const why = !m.enabledForTenant
                            ? `${data.tenant.name} does not have this module`
                            : m.roleAccess.length === 0
                              ? `The ${data.role?.name ?? ''} role does not include ${m.label}`
                              : null;
                          return (
                            <tr key={m.key}>
                              <td className="px-4 py-2.5">
                                <div className={`font-medium ${m.roleAccess.length && m.enabledForTenant ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}`}>{m.label}</div>
                                {why && <div className="text-xs text-amber-500 mt-0.5">{why}</div>}
                              </td>
                              {LEVELS.map((l) => {
                                const granted = m.enabledForTenant && m.roleAccess.includes(l.key);
                                return (
                                  <td key={l.key} className="px-3 py-2.5 text-center">
                                    <input
                                      type="checkbox"
                                      aria-label={`${m.label}: ${l.label}`}
                                      className="w-4 h-4 accent-violet-600 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                                      disabled={!granted}
                                      checked={granted && selected.includes(l.key)}
                                      onChange={() => toggle(m, l.key)}
                                      title={granted ? undefined : (why ?? `The role does not allow ${l.label.toLowerCase()} in ${m.label}`)}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">
                      {narrowed ? 'Narrowed below the role for some modules.' : 'Same as the role (no restriction).'}
                    </span>
                    {narrowed && (
                      <button type="button" onClick={() => { setEdits({}); setResetToRole(true); }}
                        className="text-blue-500 hover:underline">Reset to the role&apos;s access</button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors">Cancel</button>
          <button onClick={save} disabled={saving || !data}
            className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Access'}
          </button>
        </div>
      </div>
    </div>
  );
}
