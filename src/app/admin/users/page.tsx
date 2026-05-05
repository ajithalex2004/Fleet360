'use client';
import React, { useState, useEffect, useCallback } from 'react';
import PasswordInput from '@/components/ui/PasswordInput';

const ALL_MODULES = [
  'fleet', 'driver', 'rental', 'leasing', 'maintenance',
  'finance', 'bus-ops', 'staff', 'logistics', 'booking',
  'compliance', 'admin',
] as const;
type ModuleKey = typeof ALL_MODULES[number];

const MODULE_META: Record<ModuleKey, { label: string; icon: string; color: string }> = {
  fleet:       { label: 'Fleet',         icon: '🚗', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  driver:      { label: 'Driver',        icon: '👤', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  rental:      { label: 'Rental (RAC)',  icon: '🔑', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  leasing:     { label: 'Leasing',       icon: '📄', color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  maintenance: { label: 'Maintenance',   icon: '🔧', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  finance:     { label: 'Finance',       icon: '💰', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  'bus-ops':   { label: 'Bus Ops',       icon: '🚌', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  staff:       { label: 'Staff Transp.', icon: '👥', color: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
  logistics:   { label: 'Logistics',     icon: '📦', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
  booking:     { label: 'Booking',       icon: '📅', color: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
  compliance:  { label: 'Compliance',    icon: '✅', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  admin:       { label: 'Admin',         icon: '⚙️', color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
};

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
  moduleAccess: Partial<Record<ModuleKey, { role: string }>> | null;
  lastLoginAt?: string | null;
  createdAt: string;
}

interface Role   { id: string; name: string; code: string; isSystem?: boolean }
interface Tenant { id: string; name: string; code?: string }

const USER_TYPES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'DRIVER', 'CUSTOMER', 'VIEWER'];
const MODULE_ROLES = ['admin', 'manager', 'operator', 'viewer'];

const EMPTY_USER = {
  username: '', email: '', firstName: '', lastName: '', department: '',
  position: '', userType: 'STAFF', isActive: true,
};

export default function UsersPage() {
  const [users, setUsers]     = useState<User[]>([]);
  const [roles, setRoles]     = useState<Role[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch]   = useState('');
  const [activeFilter, setActiveFilter] = useState<'' | 'true' | 'false'>('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [formError, setFormError] = useState('');

  // Modals
  const [showCreate, setShowCreate]   = useState(false);
  const [showEdit, setShowEdit]       = useState<User | null>(null);
  const [showAssign, setShowAssign]   = useState<User | null>(null);
  const [showModules, setShowModules] = useState<User | null>(null);

  const [userForm, setUserForm]   = useState(EMPTY_USER);
  const [editForm, setEditForm]   = useState<Partial<User & { newPassword: string }>>({});
  const [assignForm, setAssignForm] = useState({ tenantId: '', roleId: '' });

  // Module access editor state (for showModules modal)
  const [moduleEdits, setModuleEdits] = useState<Partial<Record<ModuleKey, { role: string } | null>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeFilter) params.set('isActive', activeFilter);
    if (moduleFilter) params.set('module', moduleFilter);
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
  }, [activeFilter, moduleFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      `${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase().includes(q) ||
      (u.department ?? '').toLowerCase().includes(q)
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

  const handleToggleActive = async (u: User) => {
    await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    load();
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
      department: u.department ?? '',
      position:   u.position   ?? '',
      userType:   u.userType   ?? 'STAFF',
      newPassword: '',
    });
    setFormError('');
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
        department: editForm.department,
        position:   editForm.position,
        userType:   editForm.userType,
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

  const openModuleEditor = (u: User) => {
    setShowModules(u);
    setModuleEdits(u.moduleAccess ?? {});
    setFormError('');
  };

  const handleSaveModules = async () => {
    if (!showModules) return;
    setSaving(true); setFormError('');
    // Filter out nulls (removed modules)
    const access: Partial<Record<ModuleKey, { role: string }>> = {};
    for (const [k, v] of Object.entries(moduleEdits)) {
      if (v !== null && v !== undefined) access[k as ModuleKey] = v;
    }
    try {
      const res = await fetch(`/api/admin/users/${showModules.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleAccess: access }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed'); }
      setShowModules(null); load();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Failed to save module access');
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-slate-700 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">User Management</h1>
          <p className="text-slate-400 mt-1">{users.length} users — global identity &amp; module access control</p>
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
          className="flex-1 min-w-[200px] bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/50" />
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value as '' | 'true' | 'false')}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none">
          <option value="">All Users</option>
          <option value="true">Active Only</option>
          <option value="false">Inactive Only</option>
        </select>
        <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none">
          <option value="">All Modules</option>
          {ALL_MODULES.map(m => <option key={m} value={m}>{MODULE_META[m].label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/10 rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center text-slate-400 py-14">No users found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 border-b border-white/10">
                <tr>
                  {['Name', 'Username', 'Email', 'Dept / Type', 'Status', 'Module Access', 'Last Login', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map(u => {
                  const modules = u.moduleAccess ? Object.keys(u.moduleAccess) as ModuleKey[] : [];
                  return (
                    <tr key={u.id} className={`hover:bg-white/5 transition-colors ${!u.isActive ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                        {u.firstName ?? ''} {u.lastName ?? ''}
                        {!u.firstName && !u.lastName && <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300 text-xs">{u.username}</td>
                      <td className="px-4 py-3 text-slate-300 text-xs">{u.email}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-slate-400">{u.department ?? '—'}</div>
                        <span className="mt-0.5 px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">{u.userType ?? 'STAFF'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`relative w-10 h-5 rounded-full transition-colors ${u.isActive ? 'bg-green-500' : 'bg-slate-600'}`}
                          title={u.isActive ? 'Click to deactivate' : 'Click to activate'}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${u.isActive ? 'translate-x-5' : ''}`} />
                        </button>
                        <div className="text-xs text-slate-500 mt-1">{u.isActive ? 'Active' : 'Inactive'}</div>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <div className="flex flex-wrap gap-1">
                          {modules.slice(0, 3).map(m => {
                            const meta = MODULE_META[m];
                            return meta ? (
                              <span key={m} className={`px-1.5 py-0.5 rounded text-xs border ${meta.color}`}>
                                {meta.icon} {meta.label}
                              </span>
                            ) : null;
                          })}
                          {modules.length > 3 && (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-slate-700 text-slate-400">+{modules.length - 3}</span>
                          )}
                          {modules.length === 0 && <span className="text-xs text-slate-600">No access</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEditModal(u)}
                            className="px-2.5 py-1.5 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 rounded-lg transition-colors whitespace-nowrap">
                            Edit
                          </button>
                          <button onClick={() => openModuleEditor(u)}
                            className="px-2.5 py-1.5 text-xs bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 border border-violet-500/30 rounded-lg transition-colors whitespace-nowrap">
                            Modules
                          </button>
                          <button onClick={() => setShowAssign(u)}
                            className="px-2.5 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors whitespace-nowrap">
                            Tenant
                          </button>
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
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">New User</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white text-2xl">×</button>
            </div>
            {formError && <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{formError}</div>}
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {([
                  { l: 'Username *',    k: 'username',   ph: 'ahmed.mansouri',   req: true },
                  { l: 'Email *',       k: 'email',      ph: 'ahmed@company.com', req: true },
                  { l: 'First Name',    k: 'firstName',  ph: 'Ahmed' },
                  { l: 'Last Name',     k: 'lastName',   ph: 'Al-Mansouri' },
                  { l: 'Department',    k: 'department', ph: 'Operations' },
                  { l: 'Position',      k: 'position',   ph: 'Fleet Manager' },
                ] as const).map(({ l, k, ph, req }) => (
                  <div key={k}>
                    <label className="block text-sm font-medium text-slate-300 mb-2">{l}</label>
                    <input
                      type={k === 'email' ? 'email' : 'text'}
                      value={(userForm as Record<string, string>)[k] ?? ''}
                      onChange={e => setUserForm(p => ({ ...p, [k]: e.target.value }))}
                      placeholder={ph} required={req}
                      className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none text-sm"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">User Type</label>
                <select value={userForm.userType} onChange={e => setUserForm(p => ({ ...p, userType: e.target.value }))}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-white focus:border-violet-500 focus:outline-none text-sm">
                  {USER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-6 py-2.5 rounded-xl border border-white/10 text-white hover:bg-white/5 text-sm">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-semibold">
                  {saving ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Module Access Editor Modal ── */}
      {showModules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl">
            <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Module Access</h2>
                <p className="text-sm text-slate-400 mt-0.5">{showModules.username} — {showModules.email}</p>
              </div>
              <button onClick={() => setShowModules(null)} className="text-slate-400 hover:text-white text-2xl">×</button>
            </div>
            <div className="p-6 space-y-3">
              {formError && <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{formError}</div>}
              <p className="text-xs text-slate-500 mb-4">Toggle access to each module and set the user's role within it.</p>
              {ALL_MODULES.map(mod => {
                const meta    = MODULE_META[mod];
                const current = moduleEdits[mod];
                const enabled = current !== null && current !== undefined;
                return (
                  <div key={mod} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    enabled ? 'bg-slate-800/60 border-white/10' : 'bg-slate-900/40 border-white/5 opacity-60'
                  }`}>
                    <button
                      onClick={() => setModuleEdits(p => ({
                        ...p,
                        [mod]: enabled ? null : { role: 'viewer' },
                      }))}
                      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-violet-500' : 'bg-slate-600'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                    </button>
                    <span className="text-lg flex-shrink-0">{meta.icon}</span>
                    <span className="text-sm font-medium text-white flex-1">{meta.label}</span>
                    {enabled && (
                      <select
                        value={current?.role ?? 'viewer'}
                        onChange={e => setModuleEdits(p => ({ ...p, [mod]: { role: e.target.value } }))}
                        className="px-3 py-1.5 rounded-lg bg-slate-700 border border-white/10 text-white text-xs focus:outline-none focus:border-violet-500"
                        onClick={e => e.stopPropagation()}
                      >
                        {MODULE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                    {!enabled && <span className="text-xs text-slate-600">No access</span>}
                  </div>
                );
              })}
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
              <button onClick={() => setShowModules(null)}
                className="px-5 py-2.5 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSaveModules} disabled={saving}
                className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white">Edit User</h2>
                <p className="text-sm text-slate-400 mt-0.5">{showEdit.email}</p>
              </div>
              <button onClick={() => setShowEdit(null)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>
            {formError && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{formError}</div>
            )}
            <form onSubmit={handleSaveEdit} className="space-y-5">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">First Name</label>
                  <input type="text" value={editForm.firstName ?? ''} onChange={e => setEditForm(p => ({ ...p, firstName: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none placeholder-slate-500"
                    placeholder="Alex" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Last Name</label>
                  <input type="text" value={editForm.lastName ?? ''} onChange={e => setEditForm(p => ({ ...p, lastName: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none placeholder-slate-500"
                    placeholder="Thomas" />
                </div>
              </div>
              {/* Email / Username */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Email *</label>
                  <input type="email" value={editForm.email ?? ''} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} required
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Username *</label>
                  <input type="text" value={editForm.username ?? ''} onChange={e => setEditForm(p => ({ ...p, username: e.target.value }))} required
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              {/* Department / Position */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Department</label>
                  <input type="text" value={editForm.department ?? ''} onChange={e => setEditForm(p => ({ ...p, department: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none placeholder-slate-500"
                    placeholder="Operations" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Position</label>
                  <input type="text" value={editForm.position ?? ''} onChange={e => setEditForm(p => ({ ...p, position: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none placeholder-slate-500"
                    placeholder="Fleet Manager" />
                </div>
              </div>
              {/* User Type */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">User Type</label>
                <select value={editForm.userType ?? 'STAFF'} onChange={e => setEditForm(p => ({ ...p, userType: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none">
                  {USER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {/* Password reset */}
              <div className="border-t border-white/10 pt-5">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                  New Password <span className="text-slate-600 normal-case font-normal">(leave blank to keep current)</span>
                </label>
                <PasswordInput value={editForm.newPassword ?? ''} onChange={e => setEditForm(p => ({ ...p, newPassword: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none placeholder-slate-500"
                  placeholder="Min. 8 characters" minLength={8} autoComplete="new-password" />
              </div>
              {/* Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowEdit(null)}
                  className="px-5 py-2.5 rounded-xl border border-white/10 text-white hover:bg-white/5 text-sm">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:opacity-90 disabled:opacity-50 text-sm font-semibold">
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assign to Tenant Modal ── */}
      {showAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Assign to Tenant</h2>
              <button onClick={() => setShowAssign(null)} className="text-slate-400 hover:text-white text-2xl">×</button>
            </div>
            <p className="text-slate-400 text-sm mb-5">
              Assigning <span className="text-white font-medium">{showAssign.username}</span> to a tenant with a specific role.
            </p>
            {formError && <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{formError}</div>}
            <form onSubmit={handleAssign} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Tenant *</label>
                <select value={assignForm.tenantId} onChange={e => setAssignForm(p => ({ ...p, tenantId: e.target.value }))} required
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-white focus:border-violet-500 focus:outline-none text-sm">
                  <option value="">Select tenant</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name} {t.code ? `(${t.code})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Role *</label>
                <select value={assignForm.roleId} onChange={e => setAssignForm(p => ({ ...p, roleId: e.target.value }))} required
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-white focus:border-violet-500 focus:outline-none text-sm">
                  <option value="">Select role</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name} {r.isSystem ? '(System)' : ''}</option>)}
                </select>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={() => setShowAssign(null)}
                  className="px-6 py-2.5 rounded-xl border border-white/10 text-white hover:bg-white/5 text-sm">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50 text-sm font-semibold">
                  {saving ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
