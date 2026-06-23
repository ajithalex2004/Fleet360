'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { hasPermission, canView, canCreate, canEdit, canDelete, canApprove, canExport } from '@/lib/permissions';
import { clearClientMeCache } from '@/lib/client-session';

interface TenantInfo {
  id: string;
  name: string;
  code?: string;
  plan?: string;
  enabledModules: string[];
}

interface UserInfo {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roleCode: string;
  roleName: string;
}

interface PermissionContextType {
  user: UserInfo | null;
  tenant: TenantInfo | null;
  permissions: string[];
  isLoading: boolean;
  isAuthenticated: boolean;
  // Permission checks
  can: (module: string, action: string, resource?: string) => boolean;
  canView: (module: string) => boolean;
  canCreate: (module: string, resource?: string) => boolean;
  canEdit: (module: string, resource?: string) => boolean;
  canDelete: (module: string, resource?: string) => boolean;
  canApprove: (module: string, resource?: string) => boolean;
  canExport: (module: string) => boolean;
  hasModule: (module: string) => boolean;
  // Session management
  switchTenant: (tenantId: string) => Promise<void>;
  refreshPermissions: () => Promise<void>;
  setCurrentUser: (userId: string, tenantId: string) => Promise<void>;
}

// ── Module-level in-memory session cache ──────────────────────────────────────
// Survives React re-renders and route changes (component never unmounts at root).
// Invalidated after CACHE_TTL or on explicit login/logout/tenant-switch.
interface SessionCache {
  user: UserInfo;
  tenant: TenantInfo;
  permissions: string[];
  ts: number;            // epoch ms when cached
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let _cache: SessionCache | null = null;

function getCached(): SessionCache | null {
  if (!_cache) return null;
  if (Date.now() - _cache.ts > CACHE_TTL) { _cache = null; return null; }
  return _cache;
}

function setCache(user: UserInfo, tenant: TenantInfo, permissions: string[]) {
  _cache = { user, tenant, permissions, ts: Date.now() };
}

function clearCache() { _cache = null; }
// ─────────────────────────────────────────────────────────────────────────────

const PermissionContext = createContext<PermissionContextType | null>(null);

const SESSION_KEY = 'xl_mobility_session';

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  // Initialise from cache so the very first render already has auth data
  // (no loading flash for returning users within the TTL window)
  const cached = getCached();
  const [user, setUser]               = useState<UserInfo | null>(cached?.user ?? null);
  const [tenant, setTenant]           = useState<TenantInfo | null>(cached?.tenant ?? null);
  const [permissions, setPermissions] = useState<string[]>(cached?.permissions ?? []);
  const [isLoading, setIsLoading]     = useState(!cached); // false when cache hit

  const loadSession = useCallback(async (forceRefresh = false) => {
    // Use cache if fresh and not forced to refresh
    if (!forceRefresh) {
      const hit = getCached();
      if (hit) {
        setUser(hit.user);
        setTenant(hit.tenant);
        setPermissions(hit.permissions);
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (!stored) { setIsLoading(false); return; }
      const { userId, tenantId } = JSON.parse(stored);
      if (!userId || !tenantId) { setIsLoading(false); return; }

      // Retry transient failures (cold/slow DB returning 5xx, or a dropped
      // connection) before giving up. Critically: NEVER delete the stored
      // session except on a definitive 401. A flaky DB call or a per-module
      // access error (403) must not log the user out of the entire app —
      // that was the cause of "clicking Logistics signs me out".
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(`/api/admin/session?userId=${userId}&tenantId=${tenantId}`);
        } catch {
          res = null; // network error — treat as transient
        }
        // Stop retrying on a conclusive response; keep retrying on 5xx/network.
        if (res && (res.ok || res.status === 401 || res.status === 403)) break;
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }

      if (!res) { setIsLoading(false); return; }      // network failure — keep session, retry next mount
      if (res.status === 401) {                       // genuine auth failure — clear and log out
        localStorage.removeItem(SESSION_KEY);
        clearCache();
        setIsLoading(false);
        return;
      }
      if (!res.ok) { setIsLoading(false); return; }   // 403 / persistent 5xx — keep session, just unauth'd this load

      const data = await res.json();

      const perms = data.permissions ?? [];
      setUser(data.user);
      setTenant(data.tenant);
      setPermissions(perms);
      setCache(data.user, data.tenant, perms);  // ← save to module-level cache
    } catch { /* silently fail - keep current state, do NOT clear session */ }
    finally { setIsLoading(false); }
  }, []);

  // Only fetch on first mount (cache miss) — context never unmounts during navigation
  useEffect(() => { loadSession(); }, [loadSession]);

  const setCurrentUser = async (userId: string, tenantId: string) => {
    clearCache();  // force fresh fetch for the new user
    clearClientMeCache();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, tenantId }));
    try {
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, tenantId }),
      });
    } catch (err) {
      console.warn('[PermissionContext] Cookie session sync failed, using localStorage fallback', err);
    }
    await loadSession(true);
  };

  const switchTenant = async (tenantId: string) => {
    if (!user) return;
    clearCache();  // tenant change must fetch fresh permissions
    clearClientMeCache();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, tenantId }));
    try {
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, tenantId }),
      });
    } catch (err) {
      console.warn('[PermissionContext] Cookie session sync failed on tenant switch', err);
    }
    await loadSession(true);
  };

  const refreshPermissions = () => loadSession(true);

  const ctx: PermissionContextType = {
    user, tenant, permissions,
    isLoading,
    isAuthenticated: !!user && !!tenant,
    can:        (m, a, r) => hasPermission(permissions, m, a, r),
    canView:    (m)       => canView(permissions, m),
    canCreate:  (m, r)    => canCreate(permissions, m, r),
    canEdit:    (m, r)    => canEdit(permissions, m, r),
    canDelete:  (m, r)    => canDelete(permissions, m, r),
    canApprove: (m, r)    => canApprove(permissions, m, r),
    canExport:  (m)       => canExport(permissions, m),
    hasModule:  (m)       => !tenant || tenant.enabledModules.includes(m),
    switchTenant, refreshPermissions, setCurrentUser,
  };

  return <PermissionContext.Provider value={ctx}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionProvider');
  return ctx;
}

// HOC guard component
export function PermissionGuard({
  module, action = 'view', resource = '*',
  children, fallback = null,
}: {
  module: string; action?: string; resource?: string;
  children: React.ReactNode; fallback?: React.ReactNode;
}) {
  const { can, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!can(module, action, resource)) return <>{fallback}</>;
  return <>{children}</>;
}
