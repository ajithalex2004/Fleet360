'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import UserSwitcher from '@/components/UserSwitcher';

interface User   { id: string; username: string; firstName?: string; lastName?: string; }
interface Tenant { id: string; name: string; code?: string; }

export default function TenantSessionBar() {
  const { isAuthenticated, setCurrentUser, isLoading } = usePermissions();
  const [users, setUsers]         = useState<User[]>([]);
  const [tenants, setTenants]     = useState<Tenant[]>([]);
  const [selUser, setSelUser]     = useState('');
  const [selTenant, setSelTenant] = useState('');
  const [loading, setLoading]     = useState(false);
  const [bridging, setBridging]   = useState(false);
  const [error, setError]         = useState('');

  /**
   * Attempt to auto-bridge a cookie-based xl-session into PermissionContext.
   * Called once on mount when isAuthenticated is false.
   * If /api/auth/me returns a valid userId+tenantId, we call setCurrentUser
   * which populates PermissionContext from /api/admin/session and shows UserSwitcher.
   */
  const autoBridgeCookieSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return;
      const me = await res.json();
      if (me.userId && me.tenantId) {
        setBridging(true);
        await setCurrentUser(me.userId, me.tenantId);
      }
    } catch {
      /* no cookie session — fall through to dropdown UI */
    } finally {
      setBridging(false);
    }
  }, [setCurrentUser]);

  useEffect(() => {
    if (isAuthenticated || isLoading) return;
    autoBridgeCookieSession();
  }, [isAuthenticated, isLoading, autoBridgeCookieSession]);

  useEffect(() => {
    if (isAuthenticated) return; // no need to load if already signed in
    Promise.all([
      fetch('/api/admin/users').then(r => r.json()),
      fetch('/api/admin/tenants').then(r => r.json()),
    ])
      .then(async ([u, t]) => {
        const userList:   User[]   = Array.isArray(u) ? u : [];
        const tenantList: Tenant[] = Array.isArray(t) ? t : [];
        setUsers(userList);
        setTenants(tenantList);

        // Pre-select the current cookie session user & tenant in the dropdowns
        try {
          const meRes = await fetch('/api/auth/me');
          if (meRes.ok) {
            const me = await meRes.json();
            if (me.userId   && userList.some(x => x.id === me.userId))     setSelUser(me.userId);
            if (me.tenantId && tenantList.some(x => x.id === me.tenantId)) setSelTenant(me.tenantId);
          }
        } catch { /* ignore — dropdowns stay blank */ }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  const handleLogin = async () => {
    if (!selUser || !selTenant) { setError('Select both a user and tenant'); return; }
    setLoading(true); setError('');
    try { await setCurrentUser(selUser, selTenant); }
    catch { setError('Failed to set session - check user has a role in this tenant'); }
    finally { setLoading(false); }
  };

  if (isLoading || bridging) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-white/10">
        <div className="w-3.5 h-3.5 border border-slate-500 border-t-blue-400 rounded-full animate-spin" />
        <span className="text-slate-400 text-xs">Loading session…</span>
      </div>
    );
  }

  // When signed in: show the full UserSwitcher dropdown
  if (isAuthenticated) {
    return <UserSwitcher />;
  }

  // Not signed in: show login selectors (dropdowns pre-filled from cookie session)
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div>
        <label className="block text-xs text-slate-400 mb-1">User</label>
        <select
          value={selUser}
          onChange={e => setSelUser(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none min-w-36"
        >
          <option value="">Select user</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>
              {u.firstName ?? ''} {u.lastName ?? ''} ({u.username})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Tenant</label>
        <select
          value={selTenant}
          onChange={e => setSelTenant(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-white text-sm focus:border-blue-500 focus:outline-none min-w-36"
        >
          <option value="">Select tenant</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <button
        onClick={handleLogin}
        disabled={loading || !selUser || !selTenant}
        className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
      {error && <span className="text-rose-400 text-xs max-w-48">{error}</span>}
    </div>
  );
}
