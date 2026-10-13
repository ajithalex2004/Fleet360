'use client';
import React, { useState, useEffect, useCallback } from 'react';
import PasswordInput from '@/components/ui/PasswordInput';
import { HardDeleteConfirm } from '@/components/HardDeleteConfirm';
import { SWITCH_OFF } from '@/lib/ui/toggle';
import UserAccessDialog from '@/components/admin/UserAccessDialog';

interface User {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  userType?: string;
  department?: string;
  position?: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  /** The companies the user belongs to, with the role in each. */
  memberships?: Membership[];
}

interface Membership {
  tenantId: string; tenantName: string; roleId: string; roleName: string; roleCode: string; isActive: boolean;
  departmentName: string | null;
  /** Modules narrowed below the role in this company. */
  narrowedModules: string[];
}

interface Role   { id: string; name: string; code: string; isSystem?: boolean; tenantId?: string | null }
interface Tenant { id: string; name: string; code?: string }

const USER_TYPES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'DRIVER', 'CUSTOMER', 'VIEWER'];

const EMPTY_USER = {
  username: '', email: '', firstName: '', lastName: '',
  position: '', userType: 'STAFF', isActive: true,
};

export default function UsersPage() {
  const [users, setUsers]     = useState<User[]>([]);
  const [roles, setRoles]     = useState<Role[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch]   = useState('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [lines, setLines]     = useState<{ managerUserId: string; departmentHeadUserId: string } | null>(null);
  const [error, setError]     = useState('');
  const [formError, setFormError] = useState('');

  // Modals
  const [showCreate, setShowCreate]   = useState(false);
  const [showEdit, setShowEdit]       = useState<User | null>(null);
  const [showAssign, setShowAssign]   = useState<User | null>(null);
  const [showModules, setShowModules] = useState<User | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<User | null>(null);

  const [userForm, setUserForm]   = useState(EMPTY_USER);
  const [editForm, setEditForm]   = useState<Partial<User & { newPassword: string }>>({});
  const [assignForm, setAssignForm] = useState({ tenantId: '', roleId: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeFilter) params.set('isActive', activeFilter);
    try {
      const [uRes, rRes, tRes] = await Promise.all([
        fetch('/api/admin/users?' + params),
        fetch('/api/admin/roles'),
        fetch('/api/admin/tenants'),
      ]);
      const uData = await uRes.json();
      const rData = await rRes.json().catch(() => []);
      const tData = await tRes.json().catch(() => []);
      setUsers(Array.isArray(uData) ? uData : []);
      setRoles(Array.isArray(rData) ? rData : []);
      setTenants(Array.isArray(tData) ? tData : []);
      setError('');
    } catch { setError('Failed to load users'); }
    finally { setLoading(false); }
  }, [activeFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      `${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase().includes(q) ||
      (u.memberships ?? []).some(m => (m.departmentName ?? '').toLowerCase().includes(q))
    );
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setFormError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...userForm, moduleAccess: {} }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed'); }
      setShowCreate(false); setUserForm(EMPTY_USER); load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to create user');
    } finally { setSaving(false); }
  };

  // Disabling blocks sign-in and ends the user's open sessions; enabling lets them sign in again.
  const handleToggleActive = async (u: User) => {
    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username;
    const ask = u.isActive
      ? `Disable ${name}? They will be signed out and unable to sign in until enabled again.`
      : `Enable ${name}? They will be able to sign in again.`;
    if (!confirm(ask)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? `Failed to ${u.isActive ? 'disable' : 'enable'} the user (${res.status})`);
      return;
    }
    setError('');
    load();
  };

  // The Tenant dialog opens on the user's current companies and roles;
  // picking one of them pre-fills the form to change that role.
  const openAssign = (u: User) => {
    setShowAssign(u); setFormError('');
    const only = u.memberships?.length === 1 ? u.memberships[0] : null;
    setAssignForm(only ? { tenantId: only.tenantId, roleId: only.roleId } : { tenantId: '', roleId: '' });
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAssign) return;
    setSaving(true); setFormError('');
    try {
      const res = await fetch(`/api/admin/tenants/${assignForm.tenantId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: showAssign.id, roleId: assignForm.roleId }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `Error ${res.status}`); }
      setShowAssign(null); setAssignForm({ tenantId: '', roleId: '' }); load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to assign');
    } finally { setSaving(false); }
  };

  const openEditModal = (u: User) => {
    setShowEdit(u);
    setEditForm({
      firstName:  u.firstName  ?? '',
      lastName:   u.lastName   ?? '',
      email:      u.email,
      username:   u.username,
      position:   u.position   ?? '',
      userType:   u.userType   ?? 'STAFF',
      newPassword: '',
    });
    setFormError('');
    setLines(null);
    // Reporting lines in this company, for the Direct Manager / Department
    // Head approvers (Admin > Workflows).
    fetch(`/api/admin/users/${u.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLines({
        managerUserId: d?.reportingLines?.managerUserId ?? '',
        departmentHeadUserId: d?.reportingLines?.departmentHeadUserId ?? '',
      }))
      .catch(() => setLines({ managerUserId: '', departmentHeadUserId: '' }));
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEdit) return;
    setSaving(true); setFormError('');
    try {
      // Save profile fields
      const profilePayload: Record<string, unknown> = {
        firstName:  editForm.firstName,
        lastName:   editForm.lastName,
        email:      editForm.email,
        username:   editForm.username,
        position:   editForm.position,
        userType:   editForm.userType,
        // Sent once loaded: '' clears a line.
        ...(lines ? { managerUserId: lines.managerUserId, departmentHeadUserId: lines.departmentHeadUserId } : {}),
      };
      const res = await fetch(`/api/admin/users/${showEdit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profilePayload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed to update'); }

      // Set new password if provided
      if (editForm.newPassword && editForm.newPassword.length >= 8) {
        const pwRes = await fetch('/api/admin/users/set-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: showEdit.id, password: editForm.newPassword }),
        });
        if (!pwRes.ok) {
          const d = await pwRes.json();
          throw new Error(d.error ?? 'Profile saved but password update failed');
        }
      }

      setShowEdit(null); load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-[var(--border-subtle)] border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">User Management</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">{users.length} users — global identity &amp; module access control</p>
        </div>
        <button onClick={() => { setShowCreate(true); setFormError(''); }}
          className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-semibold text-sm hover:opacity-90">
          + New User
        </button>
      </div>

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search users…"
          className="flex-1 min-w-[200px] bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-violet-500/50" />
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value as '' | 'true' | 'false')}
          className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-[var(--text-main)] text-sm focus:outline-none">
          <option value="">All Users</option>
          <option value="true">Active Only</option>
          <option value="false">Inactive Only</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)]/40 border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-14">No users found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-surface)]/60 border-b border-[var(--border-subtle)]">
                <tr>
                  {['Name', 'Username', 'Email', 'Company & Role', 'Dept / Type', 'Status', 'Module Access', 'Last Login', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map(u => {
                  return (
                    <tr key={u.id} className={`hover:bg-[var(--bg-surface-hover)] transition-colors ${!u.isActive ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-medium text-[var(--text-main)] whitespace-nowrap">
                        {u.firstName ?? ''} {u.lastName ?? ''}
                        {!u.firstName && !u.lastName && <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--text-muted)] text-xs">{u.username}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{u.email}</td>
                      <td className="px-4 py-3 max-w-[260px]">
                        <div className="flex flex-col gap-1">
                          {(u.memberships ?? []).map(m => (
                            <span key={m.tenantId} title={m.isActive ? undefined : 'Membership inactive'}
                              className={`px-2 py-0.5 rounded text-xs border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] text-[var(--text-main)] ${m.isActive ? '' : 'line-through opacity-60'}`}>
                              {m.tenantName} · <span className="text-[var(--text-muted)]">{m.roleName}</span>
                            </span>
                          ))}
                          {(u.memberships ?? []).length === 0 && <span className="text-xs text-amber-500">No company</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-[var(--text-muted)]">
                          {[...new Set((u.memberships ?? []).map(m => m.departmentName).filter(Boolean))].join(', ') || '—'}
                        </div>
                        <span className="mt-0.5 px-2 py-0.5 rounded text-xs bg-[var(--bg-surface-hover)] text-[var(--text-muted)]">{u.userType ?? 'STAFF'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`relative w-10 h-5 rounded-full transition-colors ${u.isActive ? 'bg-green-500' : SWITCH_OFF}`}
                          title={u.isActive ? 'Click to disable' : 'Click to enable'}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${u.isActive ? 'translate-x-5' : ''}`} />
                        </button>
                        <div className="text-xs text-[var(--text-faint)] mt-1">{u.isActive ? 'Enabled' : 'Disabled'}</div>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="flex flex-col gap-1">
                          {(u.memberships ?? []).map(m => (
                            <span key={m.tenantId} className="text-xs text-[var(--text-muted)]"
                              title={m.narrowedModules.length ? `Narrowed: ${m.narrowedModules.join(', ')}` : undefined}>
                              {(u.memberships ?? []).length > 1 ? `${m.tenantName}: ` : ''}
                              {m.narrowedModules.length
                                ? <span className="text-amber-500">Narrowed ({m.narrowedModules.length} module{m.narrowedModules.length === 1 ? '' : 's'})</span>
                                : 'As role'}
                            </span>
                          ))}
                          {(u.memberships ?? []).length === 0 && <span className="text-xs text-[var(--text-faint)]">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-faint)]">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEditModal(u)}
                            className="px-2.5 py-1.5 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-lg transition-colors whitespace-nowrap">
                            Edit
                          </button>
                          <button onClick={() => { setShowModules(u); setFormError(''); }}
                            className="px-2.5 py-1.5 text-xs bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 border border-violet-500/30 rounded-lg transition-colors whitespace-nowrap">
                            Modules
                          </button>
                          <button onClick={() => openAssign(u)}
                            className="px-2.5 py-1.5 text-xs bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] rounded-lg transition-colors whitespace-nowrap">
                            Tenant
                          </button>
                          <button onClick={() => handleToggleActive(u)}
                            className={`px-2.5 py-1.5 text-xs border rounded-lg transition-colors whitespace-nowrap ${u.isActive
                              ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/30'
                              : 'bg-green-500/10 hover:bg-green-500/20 text-green-500 border-green-500/30'}`}>
                            {u.isActive ? 'Disable' : 'Enable'}
                          </button>
                          {/* Hard delete — hidden for protected accounts. The server enforces the same whitelist. */}
                          {u.email !== 'admin@xl-mobility.com' && (
                            <button
                              onClick={() => setHardDeleteTarget(u)}
                              className="px-2.5 py-1.5 text-xs bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg transition-colors whitespace-nowrap">
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create User Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--text-main)]">New User</h2>
              <button onClick={() => setShowCreate(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl">×</button>
            </div>
            {formError && <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{formError}</div>}
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {([
                  { l: 'Username *',    k: 'username',   ph: 'ahmed.mansouri',   req: true },
                  { l: 'Email *',       k: 'email',      ph: 'ahmed@company.com', req: true },
                  { l: 'First Name',    k: 'firstName',  ph: 'Ahmed' },
                  { l: 'Last Name',     k: 'lastName',   ph: 'Al-Mansouri' },
                  { l: 'Position',      k: 'position',   ph: 'Fleet Manager' },
                ] as Array<{ l: string; k: string; ph: string; req?: boolean }>).map(({ l, k, ph, req }) => (
                  <div key={k}>
                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">{l}</label>
                    <input
                      type={k === 'email' ? 'email' : 'text'}
                      value={(userForm as unknown as Record<string, string>)[k] ?? ''}
                      onChange={e => setUserForm(p => ({ ...p, [k]: e.target.value }))}
                      placeholder={ph} required={req}
                      className="w-full px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none text-sm"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">User Type</label>
                <select value={userForm.userType} onChange={e => setUserForm(p => ({ ...p, userType: e.target.value }))}
                  className="w-full px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none text-sm">
                  {USER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-6 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-semibold">
                  {saving ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Module Access (per company: department + access narrowing the role) ── */}
      {showModules && (
        <UserAccessDialog
          user={showModules}
          memberships={(showModules.memberships ?? []).map(m => ({ tenantId: m.tenantId, tenantName: m.tenantName, roleName: m.roleName }))}
          onClose={() => setShowModules(null)}
          onSaved={() => { setShowModules(null); load(); }}
        />
      )}

      {/* ── Edit User Modal ── */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-[var(--text-main)]">Edit User</h2>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">{showEdit.email}</p>
              </div>
              <button onClick={() => setShowEdit(null)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl leading-none">×</button>
            </div>
            {formError && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{formError}</div>
            )}
            <form onSubmit={handleSaveEdit} className="space-y-5">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">First Name</label>
                  <input type="text" value={editForm.firstName ?? ''} onChange={e => setEditForm(p => ({ ...p, firstName: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none placeholder-[var(--text-faint)]"
                    placeholder="Alex" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Last Name</label>
                  <input type="text" value={editForm.lastName ?? ''} onChange={e => setEditForm(p => ({ ...p, lastName: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none placeholder-[var(--text-faint)]"
                    placeholder="Thomas" />
                </div>
              </div>
              {/* Email / Username */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Email *</label>
                  <input type="email" value={editForm.email ?? ''} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} required
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Username *</label>
                  <input type="text" value={editForm.username ?? ''} onChange={e => setEditForm(p => ({ ...p, username: e.target.value }))} required
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              {/* Position (department is per company, in Modules) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Department</div>
                  <p className="text-xs text-[var(--text-faint)] pt-1">
                    Set per company from its Department list in <strong>Modules</strong>.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Position</label>
                  <input type="text" value={editForm.position ?? ''} onChange={e => setEditForm(p => ({ ...p, position: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none placeholder-[var(--text-faint)]"
                    placeholder="Fleet Manager" />
                </div>
              </div>
              {/* Reporting lines (this company): the Direct Manager / Department Head workflow approvers */}
              <div className="grid grid-cols-2 gap-4">
                {([['managerUserId', 'Reports to (manager)'], ['departmentHeadUserId', 'Department head']] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">{label}</label>
                    <select value={lines?.[key] ?? ''} disabled={!lines}
                      onChange={e => setLines(p => (p ? { ...p, [key]: e.target.value } : p))}
                      className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none disabled:opacity-60">
                      <option value="">{lines ? '— None —' : 'Loading…'}</option>
                      {users.filter(o => o.id !== showEdit.id && o.isActive).map(o => (
                        <option key={o.id} value={o.id}>{[o.firstName, o.lastName].filter(Boolean).join(' ') || o.username} ({o.email})</option>
                      ))}
                    </select>
                  </div>
                ))}
                <p className="col-span-2 text-xs text-[var(--text-faint)] -mt-2">Used by approval workflows whose approver is the submitter&apos;s Direct Manager or Department Head.</p>
              </div>
              {/* User Type */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">User Type</label>
                <select value={editForm.userType ?? 'STAFF'} onChange={e => setEditForm(p => ({ ...p, userType: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none">
                  {USER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {/* Password reset */}
              <div className="border-t border-[var(--border-subtle)] pt-5">
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                  New Password <span className="text-[var(--text-faint)] normal-case font-normal">(leave blank to keep current)</span>
                </label>
                <PasswordInput value={editForm.newPassword ?? ''} onChange={e => setEditForm(p => ({ ...p, newPassword: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] text-sm focus:border-blue-500 focus:outline-none placeholder-[var(--text-faint)]"
                  placeholder="Min. 8 characters" minLength={8} autoComplete="new-password" />
              </div>
              {/* Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowEdit(null)}
                  className="px-5 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 text-sm font-semibold">
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hard Delete User dialog */}
      {hardDeleteTarget && (
        <HardDeleteConfirm
          title="Delete user"
          target={{
            kind:        'user',
            id:          hardDeleteTarget.id,
            confirmText: hardDeleteTarget.email,
          }}
          description={`This will permanently destroy the user "${hardDeleteTarget.email}" and ALL of their tenant memberships. Audit log entries authored by this user are kept (with the orphaned userId). This cannot be undone.`}
          onDone={() => { setHardDeleteTarget(null); load(); }}
          onCancel={() => setHardDeleteTarget(null)}
        />
      )}

      {/* ── Assign to Tenant Modal ── */}
      {showAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--text-main)]">Tenant &amp; Role</h2>
              <button onClick={() => setShowAssign(null)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl">×</button>
            </div>
            <div className="mb-5">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
                {showAssign.username} currently belongs to
              </p>
              {(showAssign.memberships ?? []).length === 0 ? (
                <p className="text-sm text-amber-500">No company yet: choose a tenant and role below.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(showAssign.memberships ?? []).map(m => (
                    <li key={m.tenantId}>
                      <button type="button" onClick={() => setAssignForm({ tenantId: m.tenantId, roleId: m.roleId })}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-left text-sm transition-colors ${
                          assignForm.tenantId === m.tenantId ? 'border-violet-500 bg-violet-500/10' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'}`}>
                        <span className="text-[var(--text-main)] font-medium">{m.tenantName}</span>
                        <span className="text-[var(--text-muted)]">{m.roleName}{m.isActive ? '' : ' (inactive)'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-[var(--text-faint)] mt-3">
                Choose a company above to change the role there, or pick another tenant to add the user to it.
              </p>
            </div>
            {formError && <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{formError}</div>}
            <form onSubmit={handleAssign} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Tenant *</label>
                <select value={assignForm.tenantId} onChange={e => setAssignForm(p => ({ ...p, tenantId: e.target.value, roleId: '' }))} required
                  className="w-full px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none text-sm">
                  <option value="">Select tenant</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name} {t.code ? `(${t.code})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Role *</label>
                <select value={assignForm.roleId} onChange={e => setAssignForm(p => ({ ...p, roleId: e.target.value }))} required
                  className="w-full px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none text-sm">
                  <option value="">Select role</option>
                  {/* Platform roles, plus the chosen tenant's own roles (not other tenants'). */}
                  {roles.filter(r => !r.tenantId || r.tenantId === assignForm.tenantId)
                    .map(r => <option key={r.id} value={r.id}>{r.name} {r.isSystem ? '(System)' : ''}</option>)}
                </select>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={() => setShowAssign(null)}
                  className="px-6 py-2.5 rounded-xl border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] text-sm">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-semibold">
                  {saving ? 'Saving…' : (showAssign.memberships ?? []).some(m => m.tenantId === assignForm.tenantId) ? 'Change role' : 'Add to tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
