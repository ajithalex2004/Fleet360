'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';

interface TenantUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  roleCode?: string;
  roleName?: string;
  isActive?: boolean;
}

export default function UserSwitcher() {
  const { user, tenant, permissions, setCurrentUser, isAuthenticated } = usePermissions();
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Only Tenant Admins and Super Admins can switch users
  const canSwitch = permissions.includes('*:*:*') ||
    permissions.includes('admin:view:users') ||
    (user?.roleCode === 'TENANT_ADMIN') ||
    (user?.roleCode === 'SUPER_ADMIN');

  const loadTenantUsers = useCallback(async () => {
    if (!tenant?.id || !canSwitch) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?tenantId=${tenant.id}`);
      const data = await res.json();
      setTenantUsers(Array.isArray(data) ? data : []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [tenant?.id, canSwitch]);

  useEffect(() => {
    if (open) loadTenantUsers();
  }, [open, loadTenantUsers]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const switchToUser = async (targetUser: TenantUser) => {
    if (!tenant?.id || targetUser.id === user?.id) { setOpen(false); return; }
    setSwitching(true);
    try {
      await setCurrentUser(targetUser.id, tenant.id);
      setOpen(false);
    } catch { /* silently fail */ }
    finally { setSwitching(false); }
  };

  const signOut = async () => {
    localStorage.removeItem('xl_mobility_session');
    // Clear the httpOnly xl-session cookie via the server
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    window.location.href = '/login';
  };

  if (!isAuthenticated || !user) return null;

  const initials = ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? user.username[0])).toUpperCase();
  const displayName = user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : user.username;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-full bg-slate-800 border border-white/10 hover:border-white/20 transition-all group"
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="text-left hidden sm:block">
          <div className="text-white text-xs font-medium leading-tight">{displayName}</div>
          <div className="text-slate-400 text-xs leading-tight">{user.roleName}</div>
        </div>
        {canSwitch && (
          <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden z-50">
          {/* Current user info */}
          <div className="px-4 py-3 border-b border-white/10 bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-white font-medium text-sm truncate">{displayName}</div>
                <div className="text-slate-400 text-xs truncate">{user.email ?? user.username}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">{user.roleName}</span>
                  {tenant && <span className="text-xs text-slate-500 truncate">@ {tenant.name}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Switch user section - only for admins */}
          {canSwitch && (
            <>
              <div className="px-4 py-2 border-b border-white/10">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Switch User {loading && <span className="ml-1 text-slate-600">(loading...)</span>}
                </p>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {tenantUsers.length === 0 && !loading && (
                  <div className="px-4 py-3 text-xs text-slate-500">No other users in this tenant</div>
                )}
                {tenantUsers.map(u => {
                  const isCurrent = u.id === user.id;
                  const uInitials = ((u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? u.username[0])).toUpperCase();
                  const uName = u.firstName ? `${u.firstName} ${u.lastName ?? ''}`.trim() : u.username;
                  return (
                    <button
                      key={u.id}
                      onClick={() => switchToUser(u)}
                      disabled={isCurrent || switching || !u.isActive}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-50 ${
                        isCurrent
                          ? 'bg-blue-500/10 cursor-default'
                          : 'hover:bg-white/5 cursor-pointer'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${isCurrent ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                        {uInitials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-white truncate">{uName}</span>
                          {isCurrent && <span className="text-xs text-blue-400 flex-shrink-0">(you)</span>}
                          {!u.isActive && <span className="text-xs text-slate-600 flex-shrink-0">(inactive)</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-400 truncate">{u.roleName ?? u.roleCode}</span>
                        </div>
                      </div>
                      {switching && !isCurrent && (
                        <div className="w-4 h-4 border border-slate-500 border-t-white rounded-full animate-spin flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Actions */}
          <div className="border-t border-white/10 p-2">
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
              </svg>
              Sign out / Switch Tenant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
