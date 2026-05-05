'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Role {
  id: string; name: string; code: string; description?: string;
  isSystem?: boolean; tenantId?: string; permissions?: any[];
  _count?: { permissions: number; userTenants: number };
}
interface Permission { id: string; module: string; action: string; resource: string; label?: string; }

const MODULES = ['leasing','rac','bus_ops','fleet','maintenance','finance','drivers','compliance','reports','admin'];
const ACTIONS = ['view','create','edit','delete','approve','export'];
const MODULE_LABELS: Record<string,string> = {
  leasing:'Leasing', rac:'Rent-a-Car', bus_ops:'Staff Transport', fleet:'Fleet',
  maintenance:'Maintenance', finance:'Finance', drivers:'Drivers',
  compliance:'Compliance', reports:'Reports', admin:'Admin',
};
const ACTION_COLORS: Record<string,string> = {
  view:'text-blue-400', create:'text-emerald-400', edit:'text-amber-400',
  delete:'text-rose-400', approve:'text-violet-400', export:'text-cyan-400',
};

export default function RolesPage() {
  const [roles, setRoles]               = useState<Role[]>([]);
  const [permissions, setPermissions]   = useState<Permission[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [rolePermIds, setRolePermIds]   = useState<Set<string>>(new Set());
  const [filterModule, setFilterModule] = useState('all');
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [removingFlag, setRemovingFlag] = useState(false);
  const [dirty, setDirty]               = useState(false);
  const [saveMsg, setSaveMsg]           = useState('');
  const [newRole, setNewRole]           = useState({ name:'', code:'', description:'' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, pRes] = await Promise.all([
        fetch('/api/admin/roles'),
        fetch('/api/admin/permissions'),
      ]);
      const [rData, pData] = await Promise.all([rRes.json(), pRes.json()]);
      setRoles(Array.isArray(rData) ? rData : []);
      setPermissions(Array.isArray(pData) ? pData : []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectRole = async (role: Role) => {
    setSelectedRole(role);
    setDirty(false);
    setSaveMsg('');
    const res = await fetch(`/api/admin/roles/${role.id}/permissions`);
    const data = await res.json();
    setRolePermIds(new Set(Array.isArray(data) ? data.map((p: Permission) => p.id) : []));
  };

  // Toggle a single permission  -  allowed for ALL roles including system
  const togglePermission = (permId: string) => {
    setRolePermIds(prev => {
      const next = new Set(prev);
      next.has(permId) ? next.delete(permId) : next.add(permId);
      return next;
    });
    setDirty(true);
  };

  // Toggle all permissions for a module  -  allowed for ALL roles
  const toggleModule = (module: string, grant: boolean) => {
    const modulePerms = permissions.filter(p => p.module === module).map(p => p.id);
    setRolePermIds(prev => {
      const next = new Set(prev);
      modulePerms.forEach(id => grant ? next.add(id) : next.delete(id));
      return next;
    });
    setDirty(true);
  };

  const savePermissions = async () => {
    if (!selectedRole) return;
    setSaving(true); setSaveMsg('');
    try {
      const res = await fetch(`/api/admin/roles/${selectedRole.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionIds: [...rolePermIds] }),
      });
      if (!res.ok) throw new Error('Save failed');
      setDirty(false);
      setSaveMsg('Saved successfully');
      setTimeout(() => setSaveMsg(''), 3000);
      await load();
      // Re-select to refresh permission count
      const updated = roles.find(r => r.id === selectedRole.id);
      if (updated) setSelectedRole({ ...updated, _count: { ...updated._count, permissions: rolePermIds.size, userTenants: updated._count?.userTenants ?? 0 } });
    } catch (e: any) {
      setSaveMsg(e.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Remove the system flag  -  makes the role a regular editable/deletable role
  const removeSystemFlag = async (role: Role) => {
    if (!confirm(`Remove the SYSTEM flag from "${role.name}"?\n\nThis will make it a regular role that can be deleted. The permissions will be unchanged.`)) return;
    setRemovingFlag(true);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSystem: false }),
      });
      if (!res.ok) throw new Error('Failed');
      await load();
      setSelectedRole(prev => prev ? { ...prev, isSystem: false } : null);
    } catch { alert('Failed to remove system flag'); }
    finally { setRemovingFlag(false); }
  };

  const createRole = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRole),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed'); }
      setShowCreateRole(false); setNewRole({ name:'', code:'', description:'' }); load();
    } catch (e: any) { alert(e.message ?? 'Failed to create role'); }
    finally { setSaving(false); }
  };

  const deleteRole = async (role: Role) => {
    const msg = role.isSystem
      ? `"${role.name}" is a system role.\n\nAre you sure you want to permanently delete it? This cannot be undone.`
      : `Delete role "${role.name}"?`;
    if (!confirm(msg)) return;
    const res = await fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error ?? 'Delete failed'); return; }
    if (selectedRole?.id === role.id) setSelectedRole(null);
    load();
  };

  const filteredPerms = filterModule === 'all' ? permissions : permissions.filter(p => p.module === filterModule);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400 animate-pulse">Loading roles...</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Roles & Permissions</h1>
          <p className="text-slate-400">Configure granular access control per module, action, and resource</p>
        </div>
        <button onClick={() => setShowCreateRole(true)}
          className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">
          + New Role
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* -- Role List ----------------------------------- */}
        <div className="col-span-3">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <h2 className="text-sm font-semibold text-slate-300">ROLES ({roles.length})</h2>
            </div>
            <div className="divide-y divide-white/5 max-h-[calc(100vh-300px)] overflow-y-auto">
              {roles.map(role => (
                <div key={role.id}
                  className={`w-full text-left p-4 hover:bg-white/5 transition-all cursor-pointer ${selectedRole?.id === role.id ? 'bg-blue-500/10 border-r-2 border-blue-500' : ''}`}
                  onClick={() => selectRole(role)}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-white truncate">{role.name}</span>
                    {role.isSystem && (
                      <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded flex-shrink-0">
                        SYS
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-slate-400 mb-1">{role.code}</div>
                  <div className="text-xs text-slate-400">{role._count?.permissions ?? 0} perms</div>
                  <button
                    onClick={e => { e.stopPropagation(); deleteRole(role); }}
                    className="mt-2 text-xs text-rose-400 hover:text-rose-300 transition-colors">
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* -- Permission Matrix --------------------------- */}
        <div className="col-span-9">
          {!selectedRole ? (
            <div className="h-64 flex items-center justify-center bg-slate-800/30 border border-white/5 rounded-2xl text-slate-500">
              Select a role from the left to configure its permissions
            </div>
          ) : (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-white flex items-center gap-3 flex-wrap">
                    {selectedRole.name}
                    {selectedRole.isSystem && (
                      <span className="text-sm bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded">
                        SYSTEM
                      </span>
                    )}
                    {dirty && (
                      <span className="text-sm bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded">
                        Unsaved changes
                      </span>
                    )}
                    {saveMsg && (
                      <span className={`text-sm px-2 py-0.5 rounded ${saveMsg.includes('success') ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>
                        {saveMsg}
                      </span>
                    )}
                  </h2>
                  <p className="text-slate-400 text-sm mt-0.5">
                    {selectedRole.description ?? selectedRole.code} &mdash; {rolePermIds.size} permissions granted
                  </p>
                </div>

                {/* Action buttons - available for ALL roles */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selectedRole.isSystem && (
                    <button
                      onClick={() => removeSystemFlag(selectedRole)}
                      disabled={removingFlag}
                      className="px-4 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-400 text-sm font-medium hover:bg-amber-500/20 disabled:opacity-50 transition-all">
                      {removingFlag ? 'Removing...' : 'Remove System Flag'}
                    </button>
                  )}
                  <button
                    onClick={savePermissions}
                    disabled={saving || !dirty}
                    className="px-6 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium hover:opacity-90 disabled:opacity-50 transition-all">
                    {saving ? 'Saving...' : 'Save Permissions'}
                  </button>
                </div>
              </div>

              {/* Module filter chips */}
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setFilterModule('all')}
                  className={`px-3 py-1 rounded text-xs border transition-all ${filterModule === 'all' ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/20'}`}>
                  All Modules
                </button>
                {MODULES.map(m => (
                  <button key={m} onClick={() => setFilterModule(m)}
                    className={`px-3 py-1 rounded text-xs border transition-all ${filterModule === m ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/20'}`}>
                    {MODULE_LABELS[m]}
                  </button>
                ))}
              </div>

              {/* Permission matrix */}
              <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-800">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 w-40">MODULE</th>
                      {ACTIONS.map(a => (
                        <th key={a} className="px-3 py-3 text-left text-xs font-semibold min-w-[180px]">
                          <span className={ACTION_COLORS[a]}>{a.toUpperCase()}</span>
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-400 w-20">ALL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filterModule === 'all' ? MODULES : [filterModule]).map(mod => {
                      const modPerms    = permissions.filter(p => p.module === mod);
                      const grantedInMod = modPerms.filter(p => rolePermIds.has(p.id)).length;
                      const allGranted  = grantedInMod === modPerms.length && modPerms.length > 0;
                      return (
                        <tr key={mod} className="border-b border-white/5 hover:bg-white/[0.03]">
                          <td className="px-4 py-3 align-top">
                            <div className="text-sm font-semibold text-white">{MODULE_LABELS[mod]}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{grantedInMod}/{modPerms.length} granted</div>
                          </td>
                          {ACTIONS.map(action => {
                            const actionPerms = permissions.filter(p => p.module === mod && p.action === action);
                            if (actionPerms.length === 0) {
                              return (
                                <td key={action} className="px-3 py-3 align-top">
                                  <span className="text-slate-700 text-xs">—</span>
                                </td>
                              );
                            }
                            return (
                              <td key={action} className="px-3 py-3 align-top">
                                <div className="flex flex-col gap-1.5">
                                  {actionPerms.map(perm => {
                                    const granted = rolePermIds.has(perm.id);
                                    const label = perm.label ?? `${perm.resource}`;
                                    return (
                                      <button
                                        key={perm.id}
                                        onClick={() => togglePermission(perm.id)}
                                        className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                                          granted
                                            ? 'bg-emerald-500/15 border-emerald-500/40 hover:bg-emerald-500/25'
                                            : 'bg-slate-700/40 border-slate-600/40 hover:bg-slate-700/70 hover:border-slate-500/60'
                                        }`}
                                      >
                                        <span className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${
                                          granted
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-slate-600 text-slate-400'
                                        }`}>
                                          {granted ? 'Y' : ''}
                                        </span>
                                        <span className={`text-xs leading-snug font-medium ${
                                          granted ? 'text-emerald-200' : 'text-slate-400'
                                        }`}>
                                          {label}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>
                            );
                          })}
                          {/* ALL toggle column */}
                          <td className="px-3 py-3 text-center align-top">
                            <button
                              onClick={() => toggleModule(mod, !allGranted)}
                              className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-all ${
                                allGranted
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30'
                                  : 'bg-slate-700 text-slate-300 border-white/10 hover:border-white/25 hover:text-white'
                              }`}>
                              {allGranted ? 'All ✓' : 'Grant\nAll'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-6 text-xs text-slate-400 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40">
                    <span className="w-5 h-5 rounded bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">Y</span>
                    <span className="text-emerald-200 text-xs">Permission Label</span>
                  </div>
                  <span className="text-slate-500">= Granted</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-700/40 border border-slate-600/40">
                    <span className="w-5 h-5 rounded bg-slate-600 flex items-center justify-center text-xs"></span>
                    <span className="text-slate-400 text-xs">Permission Label</span>
                  </div>
                  <span className="text-slate-500">= Not granted</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-600 font-bold">—</span>
                  <span>No permission for this action</span>
                </div>
                <div className="ml-auto text-slate-500 italic">Click any row to toggle</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Role Modal */}
      {showCreateRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">New Role</h3>
              <button onClick={() => setShowCreateRole(false)} className="text-slate-400 hover:text-white">X</button>
            </div>
            <form onSubmit={createRole} className="space-y-4">
              {[
                { l:'Role Name *',  k:'name',        ph:'e.g. Senior Leasing Officer',          req:true  },
                { l:'Code *',       k:'code',        ph:'e.g. SENIOR_LEASING_OFFICER',          req:true  },
                { l:'Description',  k:'description', ph:'Brief description of responsibilities', req:false },
              ].map(({ l, k, ph, req }) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-slate-300 mb-2">{l}</label>
                  <input type="text" value={(newRole as any)[k]} onChange={e => setNewRole(p => ({ ...p, [k]: e.target.value }))}
                    required={req} placeholder={ph}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"/>
                </div>
              ))}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowCreateRole(false)}
                  className="px-5 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
