'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { hasPermission, canView, canCreate, canEdit, canDelete, canApprove, canExport } from '@/lib/permissions';
import { fetchWithTimeout } from '@/lib/fetch-timeout';

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

interface AuthMeResponse {
  userId?: string;
  tenantId?: string;
}

interface SessionResponse {
  user: UserInfo;
  tenant: TenantInfo;
  permissions?: string[];
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

// ── localStorage-persisted snapshot (stale-while-revalidate across reloads) ───
// The in-memory _cache is wiped on every full page reload, which forced a
// blocking session fetch (spinner) before the app could render anything.
// Persisting the last good session lets a reload paint instantly from the
// snapshot while we revalidate in the background. The server still authorises
// every API call, so a briefly-stale client snapshot is safe.
const SESSION_KEY = 'xl_mobility_session';
const SNAPSHOT_KEY = 'xl_mobility_session_snapshot';

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
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as SessionCache;
    return snap?.user && snap?.tenant ? snap : null;
  } catch { return null; }
}
function setPersistedSnapshot(user: UserInfo, tenant: TenantInfo, permissions: string[]) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ user, tenant, permissions, ts: Date.now() })); } catch { /* ignore */ }
}
function clearPersistedSnapshot() { try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* ignore */ } }
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
  const [isLoading, setIsLoading]     = useState(true);

  const applySessionData = useCallback((data: SessionResponse) => {
    const perms = data.permissions ?? [];
    setUser(data.user);
    setTenant(data.tenant);
    setPermissions(perms);
    setCache(data.user, data.tenant, perms);
    setPersistedSnapshot(data.user, data.tenant, perms);
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
      const meRes = await fetchWithTimeout('/api/auth/me', { cache: 'no-store' }, 5_000).catch(() => null);
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
      return;
    }
    const data = await res.json();

    const perms = data.permissions ?? [];
    setUser(data.user);
    setTenant(data.tenant);
    setPermissions(perms);
    setCache(data.user, data.tenant, perms);  // ← save to module-level cache
    setPersistedSnapshot(data.user, data.tenant, perms);  // ← persist for instant reloads
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
      setCache(snap.user, snap.tenant, snap.permissions);
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
    // Read user.id from the module-level cache (always-stable) rather than the
    // React `user` state — keeping the React-state dep out makes this closure
    // identity stable across every render.
    const cachedUser = getCached()?.user;
    if (!cachedUser?.id) return;
    clearCache(); clearPersistedSnapshot();  // tenant change must fetch fresh permissions
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: cachedUser.id, tenantId }));
    try {
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: cachedUser.id, tenantId }),
      });
    } catch (err) {
      console.warn('[PermissionContext] Cookie session sync failed on tenant switch', err);
    }
    await loadSession(true);
  }, [loadSession]);

  const refreshPermissions = useCallback(() => loadSession(true), [loadSession]);

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
