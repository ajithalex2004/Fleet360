'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useFetchedData, fetchOnce, invalidate, invalidatePrefix } from '@/hooks/useFetchedData';

interface Role {
  id: string; name: string; code: string; description?: string;
  isSystem?: boolean; tenantId?: string; permissions?: Permission[];
  _count?: { permissions: number; userTenants: number };
}
interface Permission { id: string; module: string; action: string; resource: string; label?: string; }

// ── Module keys must match src/lib/permissions.ts#MODULES exactly so that
//    p.module === mod filters the permission matrix UI against the seeded
//    canonical-keyed DB rows.
const MODULES = ['leasing','rental','bus-ops','fleet','maintenance','finance','driver-mgmt','compliance','reports','admin'];
const ACTIONS = ['view','create','edit','delete','approve','export'];
const MODULE_LABELS: Record<string,string> = {
  leasing:'Leasing', rental:'Rent-a-Car', 'bus-ops':'Staff Transport', fleet:'Fleet',
  maintenance:'Maintenance', finance:'Finance', 'driver-mgmt':'Drivers',
  compliance:'Compliance', reports:'Reports', admin:'Admin',
};
const ACTION_COLORS: Record<string,string> = {
  view:'text-blue-400', create:'text-emerald-400', edit:'text-amber-400',
  delete:'text-rose-400', approve:'text-violet-400', export:'text-cyan-400',
};
const NEW_ROLE_FIELDS = [
  { l:'Role Name *',  k:'name',        ph:'e.g. Senior Leasing Officer',          req:true  },
  { l:'Code *',       k:'code',        ph:'e.g. SENIOR_LEASING_OFFICER',          req:true  },
  { l:'Description',  k:'description', ph:'Brief description of responsibilities', req:false },
] as const;

export default function RolesPage() {
  // Session identity (tenant + role). Drives tenant-context behaviour:
  //   - tenant admins see the platform role catalog + their tenant's overrides
  //   - super admins see the catalog + all overrides when impersonating
  const meRes = useFetchedData<{
    userId: string; tenantId: string; tenantName: string; isSuperAdmin: boolean;
  }>('/api/auth/me');
  const myTenantId   = meRes.data?.tenantId ?? '';
  const myTenantName = meRes.data?.tenantName ?? '';
  const isSuperAdmin = meRes.data?.isSuperAdmin ?? false;

  // Filter the role list to the current tenant's view. The server endpoint
  // returns: (a) every role with tenantId = myTenantId (custom overrides)
  // and (b) every system role (tenantId = null, isSystem = true). The
  // distinction between "platform role" and "tenant override" is purely
  // the `tenantId` field on each row — we just label them in the UI.
  const rolesUrl = myTenantId
    ? `/api/admin/roles?tenantId=${encodeURIComponent(myTenantId)}&lite=true`
    : '/api/admin/roles?lite=true';
  const rolesRes       = useFetchedData<Role[]>(rolesUrl);
  const permissionsRes = useFetchedData<Permission[]>('/api/admin/permissions');

  const roles       = Array.isArray(rolesRes.data)       ? rolesRes.data       : [];
  const permissions = Array.isArray(permissionsRes.data) ? permissionsRes.data : [];
  const loading     = rolesRes.loading || permissionsRes.loading || meRes.loading;

  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [rolePermIds, setRolePermIds]   = useState<Set<string>>(new Set());
  const [filterModule, setFilterModule] = useState('all');
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [saving, setSaving]             = useState(false);
  const [removingFlag, setRemovingFlag] = useState(false);
  const [dirty, setDirty]               = useState(false);
  const [saveMsg, setSaveMsg]           = useState('');
  const [fullscreen, setFullscreen]     = useState(false);
  const [newRole, setNewRole]           = useState({ name:'', code:'', description:'' });

  // Override flow: when a tenant admin clicks a platform role, we either
  // switch to an existing override (silent) or prompt to create one.
  const [overridePrompt, setOverridePrompt] = useState<{
    role: Role;     // the platform role they clicked
    permCount: number;  // how many perms the new copy will have
  } | null>(null);
  const [creatingOverride, setCreatingOverride] = useState(false);

  // is the currently selected role a tenant override (editable in tenant
  // context), a platform role (read-only in tenant context), or neither?
  const isPlatformRole = !!selectedRole && selectedRole.tenantId == null;
  const isTenantOverride = !!selectedRole && selectedRole.tenantId === myTenantId;
  const readOnly = isPlatformRole && !isSuperAdmin;

  // Bust the session cache after any write that changes roles or
  // permissions. The server-side unstable_cache is also invalidated
  // server-side (revalidateTag in the route), but the client cache needs
  // an explicit bust to re-fetch on the next mount.
  const refresh = useCallback(() => {
    invalidate('/api/admin/roles');
    invalidate('/api/admin/permissions');
    rolesRes.refresh();
    permissionsRes.refresh();
  }, [rolesRes, permissionsRes]);

  const selectRole = async (role: Role) => {
    // If the user is in a tenant context and clicked a platform role, check
    // whether an override already exists. If so, switch to it silently —
    // editing the platform role would leak changes to every other tenant.
    // If no override exists, prompt to create one before opening the editor.
    if (
      !isSuperAdmin &&
      myTenantId &&
      role.tenantId == null
    ) {
      const existingOverride = roles.find(
        (r) => r.tenantId === myTenantId && r.code === role.code,
      );
      if (existingOverride) {
        // Silently switch to the existing override.
        await openRoleForEdit(existingOverride);
        return;
      }
      // No override yet — ask the user to create one. The prompt carries
      // the source role + a snapshot of the current permission count so
      // the user knows what they're getting.
      const perms = await fetchOnce<Permission[]>(`/api/admin/roles/${role.id}/permissions`);
      setOverridePrompt({ role, permCount: Array.isArray(perms) ? perms.length : 0 });
      return;
    }

    // Plain case: tenant override, or super admin viewing any role.
    await openRoleForEdit(role);
  };

  // Apply a role as the current selection and load its permission set.
  // Used by both `selectRole` (after the override check) and by the
  // "Create custom version" confirmation handler.
  const openRoleForEdit = async (role: Role) => {
    setSelectedRole(role);
    setDirty(false);
    setSaveMsg('');
    const data = await fetchOnce<Permission[]>(`/api/admin/roles/${role.id}/permissions`);
    setRolePermIds(new Set(Array.isArray(data) ? data.map(p => p.id) : []));
  };

  // Confirm the override prompt → POST /api/admin/roles/override, then
  // refresh the role list and open the new override for editing.
  const confirmCreateOverride = async () => {
    if (!overridePrompt) return;
    setCreatingOverride(true);
    try {
      const res = await fetch('/api/admin/roles/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceRoleId: overridePrompt.role.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        // 409 = an override already exists (race condition: another admin
        // created one while this modal was open). Switch to it.
        if (res.status === 409 && d.existingRoleId) {
          setOverridePrompt(null);
          await refresh();
          // Read the latest roles directly from the hook (the closure-
          // captured `roles` is stale until the next render). If we
          // can't find it, fetch by id as a fallback.
          const fresh = (rolesRes.data ?? []).find((r) => r.id === d.existingRoleId);
          if (fresh) {
            await openRoleForEdit(fresh);
          } else {
            const fetched = await fetchOnce<Role>(`/api/admin/roles/${d.existingRoleId}`);
            if (fetched) await openRoleForEdit(fetched);
          }
          return;
        }
        throw new Error(d.error ?? 'Failed to create override');
      }
      const newRole: Role = await res.json();
      setOverridePrompt(null);
      // Refresh the role list so the new override appears in the left panel
      // (and is selectable on a future click). Then open the new role.
      await refresh();
      await openRoleForEdit(newRole);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create override');
    } finally {
      setCreatingOverride(false);
    }
  };

  // Toggle a single permission  -  blocked for platform roles in tenant context
  const togglePermission = (permId: string) => {
    if (readOnly) return;
    setRolePermIds(prev => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
    setDirty(true);
  };

  // Toggle all permissions for a module  -  blocked for platform roles in tenant context
  const toggleModule = (module: string, grant: boolean) => {
    if (readOnly) return;
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
      // Bust the session cache so the next mount re-fetches. The server
      // already invalidated its tag-based cache, so both layers agree.
      invalidate(`/api/admin/roles/${selectedRole.id}/permissions`);
      refresh();
      // Re-select to refresh permission count
      const updated = roles.find(r => r.id === selectedRole.id);
      if (updated) setSelectedRole({ ...updated, _count: { ...updated._count, permissions: rolePermIds.size, userTenants: updated._count?.userTenants ?? 0 } });
    } catch (e: unknown) {
      setSaveMsg(e instanceof Error ? e.message : 'Failed to save');
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
      refresh();
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
      setShowCreateRole(false); setNewRole({ name:'', code:'', description:'' });
      refresh();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Failed to create role'); }
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
    refresh();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400 animate-pulse">Loading roles...</div>
    </div>
  );

  // fullscreen  → `fixed inset-0` against the viewport (z-40 above AppShell).
  // normal mode  → `absolute inset-0` against the AppShell content area,
  //                which is `relative flex-1 overflow-y-auto`. This makes the
  //                page fill the entire scroll region without relying on
  //                `h-full`. The body/html chain in this app is `display:
  //                block` so a viewport-relative `h-full` doesn't propagate
  //                — fullscreen works because `position:fixed` bypasses the
  //                chain; normal mode now does the same against the
  //                `relative` parent.
  return (
    <div className={fullscreen
      ? 'fixed inset-0 z-40 bg-slate-950 p-6 flex flex-col gap-6 overflow-hidden'
      : 'absolute inset-0 bg-slate-950 p-6 flex flex-col gap-6 overflow-hidden'
    }>
      {!fullscreen && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Roles & Permissions</h1>
            <p className="text-slate-400">Configure granular access control per module, action, and resource</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setFullscreen(true)}
              title="Expand the permission matrix to fill the whole screen"
              className="rounded-xl border border-white/15 bg-slate-800/60 hover:bg-slate-700 px-4 py-3 text-sm font-medium text-slate-200 hover:text-white"
            >
              ⛶ Fullscreen
            </button>
            <button onClick={() => setShowCreateRole(true)}
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">
              + New Role
            </button>
          </div>
        </div>
      )}

      {/*
        Grid is always `grid grid-cols-12 gap-6 flex-1 min-h-0` so the
        `flex-1` chain reaches the matrix card in both modes. The only thing
        that changes is the matrix column's `col-span` (12 in fullscreen
        because the role list is hidden, 9 in normal mode).
      */}
      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* -- Role List (hidden in fullscreen) ------------- */}
        {!fullscreen && (
          <div className="col-span-3 flex flex-col min-h-0">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-white/10">
              <h2 className="text-sm font-semibold text-slate-300">ROLES ({roles.length})</h2>
            </div>
            <div className="divide-y divide-white/5 flex-1 overflow-y-auto">
              {roles.map(role => {
                const isPlatform  = role.tenantId == null;
                const isMyOverride = role.tenantId === myTenantId;
                return (
                  <div key={role.id}
                    className={`w-full text-left p-4 hover:bg-white/5 transition-all cursor-pointer ${selectedRole?.id === role.id ? 'bg-blue-500/10 border-r-2 border-blue-500' : ''}`}
                    onClick={() => selectRole(role)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white truncate">{role.name}</span>
                      {isPlatform && role.isSystem && (
                        <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded flex-shrink-0">
                          SYS
                        </span>
                      )}
                      {isMyOverride && (
                        <span
                          className="text-xs bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 rounded flex-shrink-0"
                          title={`Custom version for ${myTenantName || 'this tenant'}`}
                        >
                          CUSTOM
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-slate-400 mb-1">{role.code}</div>
                    <div className="text-xs text-slate-400">{role._count?.permissions ?? 0} perms</div>
                    {isPlatform && !isSuperAdmin && myTenantId && (
                      <button
                        onClick={e => { e.stopPropagation(); selectRole(role); }}
                        className="mt-2 text-xs text-violet-300 hover:text-violet-200 transition-colors"
                        title="Create a custom version of this role for your tenant"
                      >
                        Customize for {myTenantName || 'tenant'} →
                      </button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); deleteRole(role); }}
                      className="mt-2 text-xs text-rose-400 hover:text-rose-300 transition-colors block">
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        )}

        {/* -- Permission Matrix --------------------------- */}
        <div className={fullscreen
          ? 'col-span-12 flex flex-col min-h-0'
          : 'col-span-9 flex flex-col min-h-0'
        }>
          {/* Compact role picker + Exit button in fullscreen header */}
          {fullscreen && (
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <h1 className="text-2xl font-bold text-white">Roles & Permissions</h1>
                <span className="text-slate-400 text-sm">·</span>
                {selectedRole && (
                  <span className="text-base font-bold text-white truncate">
                    {selectedRole.name}
                    {selectedRole.isSystem && selectedRole.tenantId == null && (
                      <span className="ml-2 text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded">SYSTEM</span>
                    )}
                    {isTenantOverride && (
                      <span className="ml-2 text-xs bg-violet-500/20 text-violet-300 border border-violet-500/30 px-2 py-0.5 rounded">CUSTOM</span>
                    )}
                  </span>
                )}
                {/* Compact role dropdown so you can switch roles without exiting fullscreen */}
                <select
                  value={selectedRole?.id ?? ''}
                  onChange={e => {
                    const r = roles.find(x => x.id === e.target.value);
                    if (r) selectRole(r);
                  }}
                  className="bg-slate-800 border border-white/15 text-white text-sm rounded-lg px-3 py-1.5 ml-2"
                >
                  <option value="">— select role —</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <button
                onClick={() => setFullscreen(false)}
                className="rounded-xl border border-white/15 bg-slate-800/60 hover:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:text-white flex items-center gap-2"
              >
                <span>✕</span> Exit fullscreen
              </button>
            </div>
          )}

          {!selectedRole ? (
            <div className="h-64 flex items-center justify-center bg-slate-800/30 border border-white/5 rounded-2xl text-slate-500">
              Select a role from the left to configure its permissions
            </div>
          ) : (
            // `flex-1 flex flex-col gap-4 min-h-0` (not `space-y-4`) so the
            // matrix card's `flex-1` actually constrains it to a real
            // height. With `space-y-4` (a block container), `flex-1` on the
            // matrix card is a no-op and the card grows to its natural
            // content height — the inner `overflow-y-auto` never triggers
            // and the user can't scroll to see modules below the fold.
            // `flex-1` on this wrapper itself fills the matrix column
            // (the parent is `flex flex-col min-h-0`).
            <div className="flex-1 flex flex-col gap-4 min-h-0">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-white flex items-center gap-3 flex-wrap">
                    {selectedRole.name}
                    {selectedRole.isSystem && selectedRole.tenantId == null && (
                      <span className="text-sm bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded">
                        SYSTEM
                      </span>
                    )}
                    {isTenantOverride && (
                      <span className="text-sm bg-violet-500/20 text-violet-300 border border-violet-500/30 px-2 py-0.5 rounded">
                        CUSTOM FOR {myTenantName?.toUpperCase() || 'TENANT'}
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
                    {readOnly && (
                      <span className="ml-2 text-amber-400">
                        · read-only — use the "Customize" button on the left to create an editable copy
                      </span>
                    )}
                  </p>
                </div>

                {/* Action buttons - available for ALL roles */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selectedRole.isSystem && isSuperAdmin && (
                    <button
                      onClick={() => removeSystemFlag(selectedRole)}
                      disabled={removingFlag}
                      className="px-4 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-400 text-sm font-medium hover:bg-amber-500/20 disabled:opacity-50 transition-all">
                      {removingFlag ? 'Removing...' : 'Remove System Flag'}
                    </button>
                  )}
                  {/* The "Customize" action — only shown in tenant context when
                      viewing a platform role. Hides itself once an override
                      exists (the user clicked the role to get here, so they've
                      already seen the prompt flow). */}
                  {isPlatformRole && !isSuperAdmin && myTenantId && (
                    <button
                      onClick={() => selectRole(selectedRole)}
                      className="px-4 py-2 rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-300 text-sm font-medium hover:bg-violet-500/20 transition-all"
                      title="Create a custom version of this role for your tenant"
                    >
                      Customize for {myTenantName || 'tenant'}
                    </button>
                  )}
                  <button
                    onClick={savePermissions}
                    disabled={saving || !dirty || readOnly}
                    className="px-6 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium hover:opacity-90 disabled:opacity-50 transition-all"
                    title={readOnly ? 'Create a custom version of this role to edit it' : undefined}
                  >
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

              {/* Permission matrix — redesigned: contained scroll, action-grouped sections,
                  sticky module headers, compact permission chips. flex-1 makes it fill
                  the remaining column height; min-h-0 is the flexbox hack that lets a
                  child with overflow-y-auto actually scroll. */}
              <div className="bg-slate-800/50 border border-white/10 rounded-2xl flex-1 flex flex-col min-h-0">
                <div
                  className="flex-1 overflow-y-auto overflow-x-auto p-2"
                  style={{ minHeight: '320px' }}
                >
                  {(filterModule === 'all' ? MODULES : [filterModule]).map(mod => {
                    const modPerms     = permissions.filter(p => p.module === mod);
                    const grantedInMod = modPerms.filter(p => rolePermIds.has(p.id)).length;
                    const allGranted   = grantedInMod === modPerms.length && modPerms.length > 0;
                    return (
                      <div key={mod} className="mb-3 last:mb-0 bg-slate-900/70 rounded-xl border border-white/10">
                        {/* Sticky module header — high contrast so the label reads
                            clearly even on dim screens / over busy content. */}
                        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-900 border-b border-white/15 rounded-t-xl shadow-md">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-base font-bold text-white tracking-tight">{MODULE_LABELS[mod]}</span>
                            <span className="text-xs text-slate-300 font-mono font-semibold">
                              {grantedInMod}/{modPerms.length} granted
                            </span>
                          </div>
                          <button
                            onClick={() => toggleModule(mod, !allGranted)}
                            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              allGranted
                                ? 'bg-emerald-500 text-white border-emerald-400 hover:bg-emerald-400'
                                : 'bg-blue-600 text-white border-blue-500 hover:bg-blue-500 shadow-sm'
                            }`}>
                            {allGranted ? '✓ All granted' : 'Grant all'}
                          </button>
                        </div>

                        {/* Action-grouped permission chips, stacked vertically.
                            Each action is a row: action label on the left, chips wrapping on the right. */}
                        <div className="p-3 space-y-3">
                          {ACTIONS.map(action => {
                            const actionPerms = permissions.filter(p => p.module === mod && p.action === action);
                            if (actionPerms.length === 0) return null;
                            const grantedInAction = actionPerms.filter(p => rolePermIds.has(p.id)).length;
                            return (
                              <div key={action} className="flex items-start gap-3">
                                <div className="w-20 flex-shrink-0 pt-1">
                                  <div className={`text-[12px] font-bold tracking-wider ${ACTION_COLORS[action]}`}>
                                    {action.toUpperCase()}
                                  </div>
                                  <div className="text-[11px] text-slate-300 font-mono font-semibold">
                                    {grantedInAction}/{actionPerms.length}
                                  </div>
                                </div>
                                <div className="flex-1 flex flex-wrap gap-1.5">
                                  {actionPerms.map(perm => {
                                    const granted = rolePermIds.has(perm.id);
                                    const label = perm.label ?? perm.resource;
                                    return (
                                      <button
                                        key={perm.id}
                                        onClick={() => togglePermission(perm.id)}
                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-all cursor-pointer ${
                                          granted
                                            ? 'bg-emerald-500/25 border-emerald-400/70 hover:bg-emerald-500/40 text-emerald-100'
                                            : 'bg-slate-800/70 border-slate-500/60 hover:bg-slate-700 hover:border-slate-400 text-slate-200'
                                        }`}
                                        title={`${mod} · ${action} · ${label}`}
                                      >
                                        <span className={`flex-shrink-0 w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center ${
                                          granted ? 'bg-emerald-500 text-white' : 'bg-slate-500 text-slate-200'
                                        }`}>
                                          {granted ? 'Y' : ''}
                                        </span>
                                        <span>{label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Legend (always visible below the scroll area) */}
                <div className="flex items-center gap-5 text-sm text-slate-200 flex-wrap px-4 py-3 border-t border-white/15 bg-slate-900/40">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold">Y</span>
                    <span className="font-medium">= Granted</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded bg-slate-500 flex items-center justify-center text-[10px]"></span>
                    <span className="font-medium">= Not granted</span>
                  </div>
                  <div className="ml-auto text-slate-300 italic">Click any chip to toggle · scroll within the matrix for more</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Role Modal */}
      {showCreateRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-800 border-2 border-white/20 rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">New Role</h3>
              <button
                onClick={() => setShowCreateRole(false)}
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 text-2xl leading-none"
              >
                ✕
              </button>
            </div>
            <form onSubmit={createRole} className="space-y-4">
              {NEW_ROLE_FIELDS.map(({ l, k, ph, req }) => (
                <div key={k}>
                  <label className="block text-sm font-semibold text-white mb-2">{l}</label>
                  <input type="text" value={newRole[k]} onChange={e => setNewRole(p => ({ ...p, [k]: e.target.value }))}
                    required={req} placeholder={ph}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/20 text-white placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:bg-slate-600"/>
                </div>
              ))}
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowCreateRole(false)}
                  className="px-5 py-2 rounded-lg border border-white/30 text-white font-medium hover:bg-white/10">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Creating...' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Override Prompt — appears when a tenant admin clicks a platform role
          that has no override yet. Confirms before creating a tenant-specific
          copy. The copy gets the same name, code, and permissions; subsequent
          edits only affect that tenant. */}
      {overridePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-800 border-2 border-violet-500/40 rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">Customize for {myTenantName || 'your tenant'}?</h3>
              <button
                onClick={() => setOverridePrompt(null)}
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 text-2xl leading-none">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-slate-200 text-sm leading-relaxed">
              <p>
                <span className="font-semibold text-white">{overridePrompt.role.name}</span> is a
                platform-wide role. Editing it would change it for every tenant.
              </p>
              <p>
                We'll create a <span className="font-semibold text-violet-300">custom version</span> just
                for <span className="font-semibold text-white">{myTenantName || 'your tenant'}</span> with
                the same {overridePrompt.permCount} permission{overridePrompt.permCount === 1 ? '' : 's'}.
                The platform role stays untouched.
              </p>
              <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3 text-xs font-mono">
                <div className="text-slate-400">Code: <span className="text-white">{overridePrompt.role.code}</span></div>
                <div className="text-slate-400">Description: <span className="text-white">{overridePrompt.role.description ?? '—'}</span></div>
              </div>
              <p className="text-amber-300/90 text-xs">
                Tip: you can also delete the custom version later to revert this tenant to the
                platform default.
              </p>
            </div>

            <div className="flex gap-3 justify-end pt-5">
              <button
                onClick={() => setOverridePrompt(null)}
                className="px-5 py-2 rounded-lg border border-white/30 text-white font-medium hover:bg-white/10">
                Cancel
              </button>
              <button
                onClick={confirmCreateOverride}
                disabled={creatingOverride}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold hover:opacity-90 disabled:opacity-50">
                {creatingOverride ? 'Creating...' : 'Create custom version'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
