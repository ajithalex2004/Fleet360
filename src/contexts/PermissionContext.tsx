'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { hasPermission, canView, canCreate, canEdit, canDelete, canApprove, canExport } from '@/lib/permissions';
import { fetchWithTimeout } from '@/lib/fetch-timeout';

interface TenantInfo {
  id: string;
  name: string;
  code?: string;
  plan?: string;
  defaultLanguage?: string;
  enabledModules: string[];
  navPermissions?: Record<string, boolean>;
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
  impersonatedBy: string | null;
  isSuperAdminOrImpersonating: boolean;
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
  impersonatedBy?: string | null;
  ts: number;            // epoch ms when cached
}

interface AuthMeResponse {
  userId?: string;
  tenantId?: string;
  impersonatedBy?: string | null;
}

interface SessionResponse {
  user: UserInfo;
  tenant: TenantInfo;
  permissions?: string[];
  impersonatedBy?: string | null;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let _cache: SessionCache | null = null;

function getCached(): SessionCache | null {
  if (!_cache) return null;
  if (Date.now() - _cache.ts > CACHE_TTL) { _cache = null; return null; }
  return _cache;
}

function setCache(user: UserInfo, tenant: TenantInfo, permissions: string[], impersonatedBy: string | null = null) {
  _cache = { user, tenant, permissions, impersonatedBy, ts: Date.now() };
}

function clearCache() { _cache = null; }

// ── localStorage-persisted snapshot (stale-while-revalidate across reloads) ───
// The in-memory _cache is wiped on every full page reload, which forced a
// blocking session fetch (spinner) before the app could render anything.
// Persisting the last good session lets a reload paint instantly from the
// snapshot while we revalidate in the background. The server still authorises
// every API call, so a briefly-stale client snapshot is safe.
const SESSION_KEY = 'xl_mobility_session';
const SNAPSHOT_KEY = 'xl_mobility_session_snapshot_v2';
const LEGACY_SNAPSHOT_KEY = 'xl_mobility_session_snapshot';

function hasStoredSession(): boolean {
  try {
    return typeof window !== 'undefined' && !!localStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}

function getPersistedSnapshot(): SessionCache | null {
  try {
    if (typeof window === 'undefined' || !hasStoredSession()) return null;
    const raw = localStorage.getItem(SNAPSHOT_KEY) || localStorage.getItem(LEGACY_SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as SessionCache;
    return snap?.user && snap?.tenant ? snap : null;
  } catch { return null; }
}
function setPersistedSnapshot(user: UserInfo, tenant: TenantInfo, permissions: string[], impersonatedBy: string | null = null) {
  try {
    const serialized = JSON.stringify({ user, tenant, permissions, impersonatedBy, ts: Date.now() });
    localStorage.setItem(SNAPSHOT_KEY, serialized);
    localStorage.setItem(LEGACY_SNAPSHOT_KEY, serialized);
  } catch { /* ignore */ }
}
function clearPersistedSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
    localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
  } catch { /* ignore */ }
}
// ─────────────────────────────────────────────────────────────────────────────

const PermissionContext = createContext<PermissionContextType | null>(null);

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  // ── SSR-safe initial state ────────────────────────────────────────────────
  // The previous version of this provider read from localStorage on the very
  // first render. That produced two nasty failure modes:
  //
  //   1. SSR HTML had `isLoading=true, user=null` because there's no
  //      localStorage on the server. The client first render produced
  //      `isLoading=false, user=…` because localStorage DID have a snapshot.
  //      Result: a hydration mismatch on every page that reads
  //      `usePermissions()` — PlatformSessionSlot, PlatformHomeBar, Sidebar,
  //      ModuleGuard, etc. React then throws away the server tree and
  //      re-renders client-side, adding real latency to every menu nav.
  //
  //   2. ModuleGuard has been showing "Session required" server-side and the
  //      real page client-side, regenerating entire module subtrees on every
  //      navigation.
  //
  // Fix: always start with the SAME state on server and client first render
  // (`isLoading=true, user=null`). Then on `useEffect` (which only runs on
  // the client), read localStorage and apply the cached snapshot + kick off
  // the network revalidation. The (app)/loading.tsx boundary already shows
  // a skeleton during that brief post-mount window, so users see a spinner
  // for <100ms before the cached session paints in.
  const [user, setUser]               = useState<UserInfo | null>(null);
  const [tenant, setTenant]           = useState<TenantInfo | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [impersonatedBy, setImpersonatedBy] = useState<string | null>(null);
  const [isLoading, setIsLoading]     = useState(true);

  const applySessionData = useCallback((data: SessionResponse) => {
    const perms = data.permissions ?? [];
    const imp = data.impersonatedBy ?? null;
    setUser(data.user);
    setTenant(data.tenant);
    setPermissions(perms);
    setImpersonatedBy(imp);
    setCache(data.user, data.tenant, perms, imp);
    setPersistedSnapshot(data.user, data.tenant, perms, imp);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: data.user.id, tenantId: data.tenant.id }));
    } catch { /* ignore */ }
  }, []);

  // In-flight network round-trip, shared across concurrent callers.
  // Prevents the "every render fires loadSession → N parallel fetches" storm
  // that previously pinned the dev server (we saw 70+ redundant auth probes
  // per minute when PermissionProvider kept unmounting). All concurrent
  // callers awaiting loadSession ride the same promise.
  const inflightRef = useRef<Promise<void> | null>(null);

  /**
   * Pure network phase — no React state mutation, no localStorage dance.
   * Writes via applySessionData() / setCache() etc. as before.
   * Memoised on applySessionData, so identity is stable across renders.
   */
  const fetchFreshSession = useCallback(async (): Promise<void> => {
    // 3. Cookie-based session — server has the source of truth, no
    //    userId/tenantId query string needed.
    const cookieSessionRes = await fetchWithTimeout('/api/admin/session', { cache: 'no-store' }, 12_000).catch(() => null);
    if (cookieSessionRes?.ok) {
      const data = await cookieSessionRes.json() as SessionResponse;
      applySessionData(data);
      return;
    }

    let stored = localStorage.getItem(SESSION_KEY);
    if (!stored) {
      const meRes = await fetchWithTimeout('/api/auth/me', { cache: 'no-store' }, 15_000).catch(() => null);
      if (meRes?.ok) {
        const me = await meRes.json().catch(() => null) as AuthMeResponse | null;
        if (me?.userId && me.tenantId) {
          stored = JSON.stringify({ userId: me.userId, tenantId: me.tenantId });
          localStorage.setItem(SESSION_KEY, stored);
        }
      }
    }
    if (!stored) return;
    const { userId, tenantId } = JSON.parse(stored);
    if (!userId || !tenantId) return;

    // Guard the session load with a timeout. Neon (serverless) drops idle
    // connections, and a hung DB query here would otherwise leave the whole
    // app stuck on a loading spinner forever. On timeout we abort and fall
    // through to the unauthenticated state instead.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    let res: Response;
    try {
      res = await fetch(`/api/admin/session?userId=${userId}&tenantId=${tenantId}`, { signal: ac.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      if (res.status >= 500) {
        // Server error: keep the snapshot we already painted from
        // (no-op if we didn't have one), and don't clear auth.
        return;
      }
      localStorage.removeItem(SESSION_KEY); localStorage.removeItem('xl_backend_token'); clearCache(); clearPersistedSnapshot();
      // Also drop what was painted from the snapshot: it belongs to a
      // session the server no longer accepts (e.g. another user signed in
      // in this browser), and must not keep showing that user's menus.
      setUser(null); setTenant(null); setPermissions([]);
      return;
    }
    const data = await res.json();

    const perms = data.permissions ?? [];
    const imp = data.impersonatedBy ?? null;
    setUser(data.user);
    setTenant(data.tenant);
    setPermissions(perms);
    setImpersonatedBy(imp);
    setCache(data.user, data.tenant, perms, imp);  // ← save to module-level cache
    setPersistedSnapshot(data.user, data.tenant, perms, imp);  // ← persist for instant reloads
  }, [applySessionData]);

  const loadSession = useCallback(async (forceRefresh = false, silent = false) => {
    // 1. In-memory cache — fastest path, no I/O. Returns immediately if we
    //    resolved the session earlier in this tab's lifetime.
    if (!forceRefresh) {
      const hit = getCached();
      if (hit) {
        setUser(hit.user);
        setTenant(hit.tenant);
        setPermissions(hit.permissions);
        setImpersonatedBy(hit.impersonatedBy ?? null);
        setIsLoading(false);
        return;
      }
    }

    // 2. Persisted snapshot from localStorage — second-fastest path, no
    //    network. This is the most common case for returning users on a
    //    full page reload. We paint instantly from the snapshot and then
    //    revalidate against the server in the background.
    const snap = getPersistedSnapshot();
    if (snap) {
      setUser(snap.user);
      setTenant(snap.tenant);
      setPermissions(snap.permissions);
      setImpersonatedBy(snap.impersonatedBy ?? null);
      setCache(snap.user, snap.tenant, snap.permissions, snap.impersonatedBy ?? null);
      setIsLoading(false);
    } else if (!silent) {
      setIsLoading(true);
    }

    try {
      // 3. Network — one-flight dedupe. If a request is already in flight
      //    (e.g. multiple useEffect calls firing on the same tick), every
      //    caller rides the same promise instead of stacking N parallel
      //    fetches against the dev server.
      if (!inflightRef.current) {
        inflightRef.current = fetchFreshSession();
      }
      await inflightRef.current;
    } catch { /* silently fail - unauthenticated state */ }
    finally {
      setIsLoading(false);
      // Only clear the ref once the promise we waited on has actually settled
      // and there are no other awaiters. Microscopic edge case: a caller
      // arriving a tick later would start a fresh fetch — that's fine and
      // arguably correct (e.g. after a network blip we WANT a retry).
      inflightRef.current = null;
    }
  }, [applySessionData, fetchFreshSession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSessionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<SessionResponse>).detail;
      if (!detail?.user || !detail.tenant) return;
      applySessionData(detail);
      setIsLoading(false);
    };
    const onSessionCleared = () => {
      clearCache();
      clearPersistedSnapshot();
      setUser(null);
      setTenant(null);
      setPermissions([]);
      setImpersonatedBy(null);
      setIsLoading(false);
    };

    window.addEventListener('fleet360:session-updated', onSessionUpdated);
    window.addEventListener('fleet360:session-cleared', onSessionCleared);
    return () => {
      window.removeEventListener('fleet360:session-updated', onSessionUpdated);
      window.removeEventListener('fleet360:session-cleared', onSessionCleared);
    };
  }, [applySessionData]);

  // First mount — context never unmounts during navigation.
  //
  // loadSession() now does the snapshot-first dance itself (paint from
  // localStorage, then revalidate in the background), so the first-mount
  // effect is just a thin "kick it off" wrapper. The `silent` flag means
  // we don't toggle isLoading=true while a snapshot is already on screen.
  useEffect(() => {
    void loadSession(false, true);
  }, [loadSession]);

  // Re-check the session when the tab comes back into view: signing in as
  // someone else in another tab (e.g. accepting an invitation) replaces the
  // shared cookie, and this tab must not keep showing the previous user.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 15_000) return;
      last = Date.now();
      void loadSession(true, true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadSession]);

  // setCurrentUser / switchTenant / refreshPermissions are exposed via the
  // context value. They MUST have stable identities across renders — anything
  // else causes every consumer's useEffect with [setCurrentUser] etc. as a dep
  // to re-fire on every render, which is what produced the original polling
  // storm. We capture `loadSession` (already stable) and `getCached` (module-
  // level stable) instead of reading the React `user` state directly.
  const setCurrentUser = useCallback(async (userId: string, tenantId: string) => {
    clearCache(); clearPersistedSnapshot();  // force fresh fetch for the new user
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
  }, [loadSession]);

  const switchTenant = useCallback(async (tenantId: string) => {
    const cached = getCached();
    const isSuperOrImpersonating =
      cached?.user?.roleCode === 'SUPER_ADMIN' || Boolean(cached?.impersonatedBy);
    if (!isSuperOrImpersonating) return;

    try {
      let currentHomeTenantId = cached?.impersonatedBy ? null : cached?.tenant?.id ?? null;
      if (cached?.impersonatedBy) {
        const stopRes = await fetch('/api/admin/impersonate/stop', { method: 'POST' });
        if (!stopRes.ok) {
          const stopErr = await stopRes.json().catch(() => ({}));
          throw new Error(stopErr?.error ?? 'Failed to restore Super Admin session');
        }
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (meRes.ok) {
          const me = (await meRes.json().catch(() => null)) as AuthMeResponse | null;
          currentHomeTenantId = me?.tenantId ?? null;
        }
      }

      if (tenantId && tenantId !== currentHomeTenantId) {
        const impRes = await fetch('/api/admin/impersonate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });
        if (!impRes.ok) {
          const impErr = await impRes.json().catch(() => ({}));
          throw new Error(impErr?.error ?? 'Could not switch tenant');
        }
      }
    } catch (err) {
      console.warn('[PermissionContext] Tenant switch failed', err);
      throw err;
    }

    clearCache();
    clearPersistedSnapshot();
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    await loadSession(true);
  }, [loadSession]);

  const refreshPermissions = useCallback(() => loadSession(true), [loadSession]);

  const isSuperAdminOrImpersonating =
    user?.roleCode === 'SUPER_ADMIN' || Boolean(impersonatedBy);

  const ctx: PermissionContextType = {
    user, tenant, permissions,
    impersonatedBy,
    isSuperAdminOrImpersonating,
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

export function usePermissions(): PermissionContextType {
  const ctx = useContext(PermissionContext);
  if (!ctx) {
    return {
      user: null,
      tenant: null,
      permissions: [],
      impersonatedBy: null,
      isSuperAdminOrImpersonating: false,
      isLoading: false,
      isAuthenticated: false,
      can: () => false,
      canView: () => false,
      canCreate: () => false,
      canEdit: () => false,
      canDelete: () => false,
      canApprove: () => false,
      canExport: () => false,
      hasModule: () => true,
      switchTenant: async () => {},
      refreshPermissions: async () => {},
      setCurrentUser: async () => {},
    };
  }
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
