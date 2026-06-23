'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { MODULE_ACCESS_PRESETS, permissionKeysForModulePreset, type ModuleAccessPreset } from '@/lib/module-access-presets';

interface Role {
  id: string; name: string; code: string; description?: string;
  isSystem?: boolean; tenantId?: string; permissions?: Array<{ permission?: Permission }>;
  _count?: { permissions: number; userTenants: number };
}
interface Permission { id: string; module: string; action: string; resource: string; label?: string; }
interface RoleCompare {
  left: { id: string; name: string; code: string; userCount: number };
  right: { id: string; name: string; code: string; userCount: number };
  added: Array<{ key: string }>;
  removed: Array<{ key: string }>;
  unchanged: number;
  affectedUsers: { leftRoleUsers: number; rightRoleUsers: number };
}
interface RoleVersion {
  id: string;
  version_number: number;
  change_type: string;
  actor_user_id?: string;
  actor_role?: string;
  summary?: string;
  created_at: string;
  snapshot_json: {
    name: string;
    code: string;
    permissions?: unknown[];
    counts?: { userTenants?: number; permissions?: number };
  };
}
interface PermissionPreview {
  roleId: string;
  roleName: string;
  roleCode: string;
  riskLevel: 'low' | 'medium' | 'high';
  riskReasons: string[];
  affectedUsers: number;
  affectedUserSample: Array<{ id: string; email: string; username: string; name: string; department?: string | null }>;
  currentPermissionCount: number;
  proposedPermissionCount: number;
  added: Permission[];
  removed: Permission[];
  moduleDelta: Array<{ module: string; added: number; removed: number }>;
}
interface ConfirmAction {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'danger' | 'warning';
  onConfirm: () => Promise<void> | void;
}

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

function presetCoverage(module: string, preset: string, permissions: Permission[]) {
  const keys = new Set(permissionKeysForModulePreset(module, preset as ModuleAccessPreset));
  return permissions.filter(p => keys.has(`${p.module}:${p.action}:${p.resource ?? '*'}`));
}

const initialNewRole = { name:'', code:'', description:'' };
type RoleFormKey = keyof typeof initialNewRole;
const ROLE_FORM_FIELDS: Array<{ l: string; k: RoleFormKey; ph: string; req: boolean }> = [
  { l:'Role Name *',  k:'name',        ph:'e.g. Senior Leasing Officer',          req:true  },
  { l:'Code *',       k:'code',        ph:'e.g. SENIOR_LEASING_OFFICER',          req:true  },
  { l:'Description',  k:'description', ph:'Brief description of responsibilities', req:false },
];

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
  const [newRole, setNewRole]           = useState(initialNewRole);
  const [compareRoleId, setCompareRoleId] = useState('');
  const [compareData, setCompareData]     = useState<RoleCompare | null>(null);
  const [versions, setVersions]           = useState<RoleVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [rollingBack, setRollingBack]     = useState<string | null>(null);
  const [notice, setNotice]               = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [permissionPreview, setPermissionPreview] = useState<PermissionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  useEffect(() => {
    if (!selectedRole || !dirty) {
      setPermissionPreview(null);
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    const loadPreview = async () => {
      setPreviewLoading(true);
      try {
        const ids = encodeURIComponent([...rolePermIds].join(','));
        const res = await fetch(`/api/admin/roles/${selectedRole.id}/permissions?previewPermissionIds=${ids}`, {
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) setPermissionPreview(data);
      } catch {
        if (!controller.signal.aborted) setPermissionPreview(null);
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    };
    const timer = window.setTimeout(() => void loadPreview(), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedRole, dirty, rolePermIds]);

  const selectRole = async (role: Role) => {
    setSelectedRole(role);
    setDirty(false);
    setSaveMsg('');
    const res = await fetch(`/api/admin/roles/${role.id}/permissions`);
    const data = await res.json();
    setRolePermIds(new Set(Array.isArray(data) ? data.map((p: Permission) => p.id) : []));
    void loadVersions(role.id);
  };

  const loadVersions = async (roleId: string) => {
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/admin/roles/${roleId}/versions`);
      const data = await res.json();
      setVersions(Array.isArray(data.versions) ? data.versions : []);
    } finally {
      setVersionsLoading(false);
    }
  };

  // Toggle a single permission  -  allowed for ALL roles including system
  const togglePermission = (permId: string) => {
    setRolePermIds(prev => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
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
        headers: {
          'Content-Type': 'application/json',
          ...(selectedRole.isSystem ? { 'x-admin-confirm-action': 'role.permissions.update.system' } : {}),
        },
        body: JSON.stringify({ permissionIds: [...rolePermIds] }),
      });
      if (!res.ok) throw new Error('Save failed');
      setDirty(false);
      setPermissionPreview(null);
      setSaveMsg('Saved successfully');
      setNotice({ tone: 'success', text: `Permissions saved for ${selectedRole.name}.` });
      setTimeout(() => setSaveMsg(''), 3000);
      await load();
      await loadVersions(selectedRole.id);
      // Re-select to refresh permission count
      const updated = roles.find(r => r.id === selectedRole.id);
      if (updated) setSelectedRole({ ...updated, _count: { ...updated._count, permissions: rolePermIds.size, userTenants: updated._count?.userTenants ?? 0 } });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save';
      setSaveMsg(message);
      setNotice({ tone: 'error', text: message || 'Failed to save permissions.' });
    } finally {
      setSaving(false);
    }
  };

  // Remove the system flag  -  makes the role a regular editable/deletable role
  const removeSystemFlag = async (role: Role) => {
    setConfirmAction({
      title: 'Remove System Flag',
      body: `Remove the SYSTEM flag from "${role.name}"? This makes it a regular editable role while keeping permissions unchanged.`,
      confirmLabel: 'Remove Flag',
      tone: 'warning',
      onConfirm: async () => performRemoveSystemFlag(role),
    });
  };

  const performRemoveSystemFlag = async (role: Role) => {
    setRemovingFlag(true);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-confirm-action': 'role.system-flag.remove',
        },
        body: JSON.stringify({ isSystem: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 428) {
        setNotice({ tone: 'info', text: `System flag removal queued for approval: ${body.approvalRequest?.id ?? 'pending request'}.` });
        return;
      }
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      await load();
      setSelectedRole(prev => prev ? { ...prev, isSystem: false } : null);
      setNotice({ tone: 'success', text: `System flag removed from ${role.name}.` });
    } catch (e: unknown) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Failed to remove system flag.' });
    }
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
      setShowCreateRole(false); setNewRole(initialNewRole); load();
      setNotice({ tone: 'success', text: 'Role created.' });
    } catch (e: unknown) { setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Failed to create role' }); }
    finally { setSaving(false); }
  };

  const cloneRole = async (role: Role) => {
    const suffix = Date.now().toString().slice(-4);
    const res = await fetch(`/api/admin/roles/${role.id}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${role.name} Copy`,
        code: `${role.code}_COPY_${suffix}`,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setNotice({ tone: 'error', text: d.error ?? 'Clone failed' });
      return;
    }
    const cloned = await res.json();
    await load();
    setSelectedRole(cloned);
    setRolePermIds(new Set());
    await selectRole(cloned);
    setNotice({ tone: 'success', text: `Cloned ${role.name}.` });
  };

  const compareRoles = async () => {
    if (!selectedRole || !compareRoleId) return;
    const res = await fetch(`/api/admin/roles/compare?leftId=${selectedRole.id}&rightId=${compareRoleId}`);
    const data = await res.json();
    if (!res.ok) { setNotice({ tone: 'error', text: data.error ?? 'Compare failed' }); return; }
    setCompareData(data);
  };

  const rollbackRole = async (version: RoleVersion) => {
    if (!selectedRole) return;
    setConfirmAction({
      title: 'Rollback Role',
      body: `Rollback "${selectedRole.name}" to version ${version.version_number}? This creates a new version with the restored snapshot.`,
      confirmLabel: 'Rollback',
      tone: 'warning',
      onConfirm: async () => performRollbackRole(version),
    });
  };

  const performRollbackRole = async (version: RoleVersion) => {
    if (!selectedRole) return;
    setRollingBack(version.id);
    try {
      const res = await fetch(`/api/admin/roles/${selectedRole.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', versionId: version.id }),
      });
      if (res.status === 428) {
        const d = await res.json().catch(() => ({}));
        setNotice({ tone: 'info', text: `Rollback queued for approval: ${d.approvalRequest?.id ?? 'pending request'}. Approve it in Admin Approvals, then retry rollback.` });
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setNotice({ tone: 'error', text: d.error ?? 'Rollback failed' });
        return;
      }
      const data = await res.json();
      await load();
      await selectRole(data.role);
      setSaveMsg('Rollback applied');
      setNotice({ tone: 'success', text: `Rollback applied for ${data.role?.name ?? selectedRole.name}.` });
    } finally {
      setRollingBack(null);
    }
  };

  const deleteRole = async (role: Role) => {
    const msg = role.isSystem
      ? `"${role.name}" is a system role. Deleting it is permanent and cannot be undone.`
      : `Delete role "${role.name}"?`;
    setConfirmAction({
      title: 'Delete Role',
      body: msg,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => performDeleteRole(role),
    });
  };

  const performDeleteRole = async (role: Role) => {
    const res = await fetch(`/api/admin/roles/${role.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-confirm-action': 'role.delete' },
    });
    const d = await res.json().catch(()=>({}));
    if (res.status === 428) {
      setNotice({ tone: 'info', text: `Delete queued for approval: ${d.approvalRequest?.id ?? 'pending request'}.` });
      return;
    }
    if (!res.ok) { setNotice({ tone: 'error', text: d.error ?? 'Delete failed' }); return; }
    if (selectedRole?.id === role.id) setSelectedRole(null);
    setNotice({ tone: 'success', text: `Deleted role ${role.name}.` });
    load();
  };

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
      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
          notice.tone === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : notice.tone === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : 'bg-blue-500/10 border-blue-500/30 text-blue-200'
        }`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs opacity-80 hover:opacity-100">Dismiss</button>
        </div>
      )}

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
                  <button
                    onClick={() => cloneRole(selectedRole)}
                    className="px-4 py-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-sm font-medium hover:bg-cyan-500/20 transition-all">
                    Clone Role
                  </button>
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

              {dirty && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-amber-100">Permission Change Preview</h3>
                      <p className="text-xs text-amber-200/80 mt-1">
                        {previewLoading
                          ? 'Calculating affected users and permission delta...'
                          : permissionPreview
                            ? `${permissionPreview.affectedUsers} assigned user(s) will receive ${permissionPreview.proposedPermissionCount} permission(s).`
                            : 'Preview unavailable. Save will still validate on the server.'}
                      </p>
                    </div>
                    {permissionPreview && (
                      <div className="text-right text-xs text-amber-100">
                        <div className={`font-semibold ${
                          permissionPreview.riskLevel === 'high'
                            ? 'text-rose-200'
                            : permissionPreview.riskLevel === 'medium'
                              ? 'text-amber-100'
                              : 'text-emerald-200'
                        }`}>
                          {permissionPreview.riskLevel.toUpperCase()} risk
                        </div>
                        <div><span className="font-semibold">{permissionPreview.added.length}</span> added</div>
                        <div><span className="font-semibold">{permissionPreview.removed.length}</span> removed</div>
                      </div>
                    )}
                  </div>
                  {permissionPreview && permissionPreview.riskReasons.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {permissionPreview.riskReasons.map(reason => (
                        <div key={reason} className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-100">
                          {reason}
                        </div>
                      ))}
                    </div>
                  )}
                  {permissionPreview && permissionPreview.moduleDelta.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {permissionPreview.moduleDelta.map(delta => (
                        <span key={delta.module} className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-slate-200">
                          {MODULE_LABELS[delta.module] ?? delta.module}: <span className="text-emerald-300">+{delta.added}</span> <span className="text-rose-300">-{delta.removed}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {permissionPreview && (permissionPreview.added.length > 0 || permissionPreview.removed.length > 0) && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-emerald-200 mb-1">Added</div>
                        <div className="flex flex-wrap gap-1">
                          {permissionPreview.added.slice(0, 8).map(p => (
                            <span key={p.id} className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-1 text-emerald-100">
                              {p.module}:{p.action}:{p.resource ?? '*'}
                            </span>
                          ))}
                          {permissionPreview.added.length === 0 && <span className="text-amber-200/60">None</span>}
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold text-rose-200 mb-1">Removed</div>
                        <div className="flex flex-wrap gap-1">
                          {permissionPreview.removed.slice(0, 8).map(p => (
                            <span key={p.id} className="rounded bg-rose-500/15 border border-rose-500/30 px-2 py-1 text-rose-100">
                              {p.module}:{p.action}:{p.resource ?? '*'}
                            </span>
                          ))}
                          {permissionPreview.removed.length === 0 && <span className="text-amber-200/60">None</span>}
                        </div>
                      </div>
                    </div>
                  )}
                  {permissionPreview && permissionPreview.affectedUserSample.length > 0 && (
                    <div className="mt-3 rounded-xl bg-slate-950/40 border border-white/10 p-3">
                      <div className="text-xs font-semibold text-amber-100 mb-2">Affected user sample</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {permissionPreview.affectedUserSample.map(user => (
                          <div key={user.id} className="rounded-lg bg-slate-900/80 border border-white/10 px-3 py-2">
                            <div className="text-xs font-semibold text-white">{user.name}</div>
                            <div className="text-[11px] text-slate-400">{user.email}</div>
                            {user.department && <div className="text-[11px] text-slate-500">{user.department}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Module Access Presets</h3>
                    <p className="text-xs text-slate-500">
                      These are the Admin / Manager / Operator / Viewer presets used in User Management. They now expand into real RBAC permission keys.
                    </p>
                  </div>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/30">
                    USER MODULE ACCESS
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
                  {MODULE_ACCESS_PRESETS.map(preset => {
                    const moduleKey = filterModule === 'all' ? selectedRole.permissions?.[0]?.permission?.module ?? 'fleet' : filterModule;
                    const covered = presetCoverage(moduleKey, preset.key, permissions);
                    return (
                      <div key={preset.key} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                        <div className="text-sm font-semibold text-white">{preset.label}</div>
                        <div className="text-[11px] text-slate-500 mt-1 min-h-[42px]">{preset.description}</div>
                        <div className="mt-3 text-[11px] text-slate-400">
                          <span className="text-blue-300">{covered.length}</span> permission(s) in {MODULE_LABELS[moduleKey] ?? moduleKey}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {preset.actions.map(action => (
                            <span key={action} className={`text-[10px] ${ACTION_COLORS[action]} bg-slate-800 border border-white/10 rounded px-1.5 py-0.5`}>
                              {action}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-4 flex flex-col md:flex-row md:items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs uppercase tracking-wide text-slate-500">Compare selected role against</label>
                  <select
                    value={compareRoleId}
                    onChange={e => { setCompareRoleId(e.target.value); setCompareData(null); }}
                    className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
                    <option value="">Choose a role</option>
                    {roles.filter(r => r.id !== selectedRole.id).map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                    ))}
                  </select>
                </div>
                <button
                  disabled={!compareRoleId}
                  onClick={compareRoles}
                  className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm text-white">
                  Compare
                </button>
                {compareData && (
                  <div className="text-xs text-slate-300 md:min-w-[280px]">
                    <div><span className="text-emerald-300">{compareData.added.length}</span> permissions added in {compareData.right.code}</div>
                    <div><span className="text-rose-300">{compareData.removed.length}</span> permissions missing from {compareData.right.code}</div>
                    <div><span className="text-amber-300">{compareData.affectedUsers.rightRoleUsers}</span> users currently assigned to compared role</div>
                  </div>
                )}
              </div>

              <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Role History</h3>
                    <p className="text-xs text-slate-500">Immutable snapshots. Rollback creates a new version.</p>
                  </div>
                  <button
                    onClick={() => loadVersions(selectedRole.id)}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-white">
                    {versionsLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {versions.map(v => (
                    <div key={v.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-blue-300">v{v.version_number}</span>
                          <span className="text-xs text-slate-300">{v.change_type}</span>
                          <span className="text-xs text-slate-600">{new Date(v.created_at).toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">
                          {v.summary ?? `${v.snapshot_json?.code ?? 'role'} - ${v.snapshot_json?.permissions?.length ?? 0} permissions`}
                        </div>
                      </div>
                      <button
                        disabled={rollingBack === v.id || versions[0]?.id === v.id}
                        onClick={() => rollbackRole(v)}
                        className="px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-300 text-xs hover:bg-amber-500/10 disabled:opacity-40">
                        {versions[0]?.id === v.id ? 'Current' : rollingBack === v.id ? 'Working...' : 'Rollback'}
                      </button>
                    </div>
                  ))}
                  {!versionsLoading && versions.length === 0 && (
                    <div className="text-center text-slate-500 text-sm py-6">No versions captured yet.</div>
                  )}
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
              {ROLE_FORM_FIELDS.map(({ l, k, ph, req }) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-slate-300 mb-2">{l}</label>
                  <input type="text" value={newRole[k]} onChange={e => setNewRole(p => ({ ...p, [k]: e.target.value }))}
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
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">{confirmAction.title}</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">{confirmAction.body}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-lg border border-white/10 text-sm text-white hover:bg-white/5">
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = confirmAction;
                  setConfirmAction(null);
                  await action.onConfirm();
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${
                  confirmAction.tone === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}>
                {confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
