'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/contexts/PermissionContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { clearClientSession, requestServerLogout } from '@/lib/client-session';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import { Building2, Users, Check, RotateCcw, Search, ChevronDown } from 'lucide-react';

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

export interface SwitchableTenant {
  id: string;
  name: string;
  code?: string | null;
  plan?: string | null;
  isActive?: boolean;
}

const USER_CACHE_TTL = 5 * 60 * 1000;
const tenantUserCache = new Map<string, { users: TenantUser[]; ts: number }>();
let allTenantsCache: { tenants: SwitchableTenant[]; ts: number } | null = null;

/**
 * Shared helper for Super Admin tenant switching:
 * 1. If currently impersonating a tenant, stops impersonation first to restore SUPER_ADMIN cookie.
 * 2. If targetTenantId differs from the Super Admin's own home tenant, starts impersonation for targetTenantId.
 * 3. Clears stale localStorage session snapshots so PermissionContext loads the new tenant immediately.
 */
export async function performSuperAdminTenantSwitch(
  targetTenantId: string | null,
  currentlyImpersonating: boolean,
  currentPathname?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    let homeTenantId: string | null = null;

    if (currentlyImpersonating) {
      const stopRes = await fetch('/api/admin/impersonate/stop', { method: 'POST' });
      if (!stopRes.ok) {
        const stopData = await stopRes.json().catch(() => null);
        return { ok: false, error: stopData?.error ?? 'Could not restore Super Admin session.' };
      }
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' }).catch(() => null);
      if (meRes?.ok) {
        const me = await meRes.json().catch(() => null);
        homeTenantId = me?.tenantId ?? null;
      }
    }

    // If targetTenantId is null, caller explicitly wants to return to Super Admin home tenant
    if (targetTenantId && targetTenantId !== homeTenantId) {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: targetTenantId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return { ok: false, error: data?.error ?? 'Could not switch to selected tenant.' };
      }
    }

    clearClientSession();
    // If switching into a tenant while on a platform-admin-only route (/admin/tenants),
    // land on /platform so the Super Admin sees the tenant's modules and pages without a 403.
    const nextUrl =
      targetTenantId && currentPathname?.startsWith('/admin')
        ? '/platform'
        : currentPathname || '/platform';
    window.location.href = nextUrl;
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error — could not switch tenant.' };
  }
}

export default function UserSwitcher() {
  const pathname = usePathname();
  const { user, tenant, impersonatedBy, isSuperAdminOrImpersonating, isAuthenticated } = usePermissions();
  const { tLabel } = useLanguage();
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [allTenants, setAllTenants] = useState<SwitchableTenant[]>([]);
  const [activeTab, setActiveTab] = useState<'tenants' | 'users'>('tenants');
  const [tenantSearch, setTenantSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const tenantDropdownRef = useRef<HTMLDivElement>(null);

  // Provisioned ONLY for Super Admin (including when Super Admin is viewing a tenant via impersonation)
  const canSwitch = isSuperAdminOrImpersonating;

  const loadAllTenants = useCallback(async () => {
    if (!canSwitch) return;
    if (allTenantsCache && Date.now() - allTenantsCache.ts < USER_CACHE_TTL) {
      setAllTenants(allTenantsCache.tenants);
      setLoadingTenants(false);
      return;
    }

    setLoadingTenants(true);
    try {
      const res = await fetchWithTimeout('/api/admin/tenants?limit=200', { cache: 'no-store' }, 6_000);
      const data = await res.json();
      const list = (Array.isArray(data) ? data : []).filter((t: SwitchableTenant) => t.isActive !== false);
      allTenantsCache = { tenants: list, ts: Date.now() };
      setAllTenants(list);
    } catch {
      if (allTenantsCache?.tenants) setAllTenants(allTenantsCache.tenants);
    } finally {
      setLoadingTenants(false);
    }
  }, [canSwitch]);

  const loadTenantUsers = useCallback(async () => {
    if (!tenant?.id || !canSwitch) return;
    const cached = tenantUserCache.get(tenant.id);
    if (cached && Date.now() - cached.ts < USER_CACHE_TTL) {
      setTenantUsers(cached.users);
      setLoadingUsers(false);
      return;
    }

    setLoadingUsers(true);
    try {
      const res = await fetchWithTimeout(`/api/admin/users?tenantId=${tenant.id}`, { cache: 'no-store' }, 5_000);
      const data = await res.json();
      const users = Array.isArray(data) ? data : [];
      tenantUserCache.set(tenant.id, { users, ts: Date.now() });
      setTenantUsers(users);
    } catch {
      const fallback = tenantUserCache.get(tenant.id)?.users;
      if (fallback) setTenantUsers(fallback);
    } finally {
      setLoadingUsers(false);
    }
  }, [tenant?.id, canSwitch]);

  useEffect(() => {
    if ((!open && !tenantMenuOpen) || !canSwitch) return;
    if (allTenants.length === 0) void loadAllTenants();
    if (open && activeTab === 'users' && tenantUsers.length === 0) void loadTenantUsers();
  }, [open, tenantMenuOpen, canSwitch, activeTab, allTenants.length, tenantUsers.length, loadAllTenants, loadTenantUsers]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
      if (tenantDropdownRef.current && !tenantDropdownRef.current.contains(e.target as Node)) {
        setTenantMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSwitchTenant = async (targetTenant: SwitchableTenant) => {
    if (targetTenant.id === tenant?.id) {
      setOpen(false);
      setTenantMenuOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const result = await performSuperAdminTenantSwitch(
        targetTenant.id,
        Boolean(impersonatedBy),
        pathname,
      );
      if (!result.ok) {
        alert(result.error ?? 'Could not switch tenant.');
      } else {
        setOpen(false);
        setTenantMenuOpen(false);
      }
    } finally {
      setSwitching(false);
    }
  };

  const handleReturnToSuperAdmin = async () => {
    setSwitching(true);
    try {
      const result = await performSuperAdminTenantSwitch(null, true, pathname);
      if (!result.ok) {
        alert(result.error ?? 'Could not return to Super Admin session.');
      } else {
        setOpen(false);
        setTenantMenuOpen(false);
      }
    } finally {
      setSwitching(false);
    }
  };

  const switchToUser = async (targetUser: TenantUser) => {
    if (!tenant?.id || targetUser.id === user?.id) { setOpen(false); return; }
    setSwitching(true);
    try {
      if (impersonatedBy) {
        await fetch('/api/admin/impersonate/stop', { method: 'POST' });
      }
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, userId: targetUser.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? 'Could not switch user.');
        return;
      }
      setOpen(false);
      clearClientSession();
      window.location.href = '/platform';
    } catch {
      alert('Network error — could not switch user.');
    } finally {
      setSwitching(false);
    }
  };

  const signOut = () => {
    setOpen(false);
    clearClientSession();
    requestServerLogout();
    window.location.assign('/login');
  };

  if (!isAuthenticated || !user) return null;

  const initials = ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? user.username[0])).toUpperCase();
  const displayName = user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : user.username;

  const filteredTenants = allTenants.filter(t => {
    if (!tenantSearch.trim()) return true;
    const q = tenantSearch.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      (t.code && t.code.toLowerCase().includes(q)) ||
      (t.plan && t.plan.toLowerCase().includes(q))
    );
  });

  const renderTenantPickerContent = () => (
    <div>
      {impersonatedBy && (
        <div className="p-2 border-b border-[var(--border-subtle)] bg-amber-500/10">
          <button
            type="button"
            onClick={handleReturnToSuperAdmin}
            disabled={switching}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {tLabel('Return to Super Admin (Platform)')}
          </button>
        </div>
      )}
      <div className="p-2 border-b border-[var(--border-subtle)]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--text-faint)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={tenantSearch}
            onChange={e => setTenantSearch(e.target.value)}
            placeholder={tLabel('Search tenant name or code...')}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border-subtle)]/40">
        {loadingTenants && (
          <div className="px-4 py-3 text-xs text-[var(--text-faint)]">{tLabel('Loading tenants…')}</div>
        )}
        {!loadingTenants && filteredTenants.length === 0 && (
          <div className="px-4 py-3 text-xs text-[var(--text-faint)]">{tLabel('No matching tenants found')}</div>
        )}
        {filteredTenants.map(t => {
          const isCurrentTenant = t.id === tenant?.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSwitchTenant(t)}
              disabled={isCurrentTenant || switching}
              className={`w-full flex items-center justify-between gap-2.5 px-4 py-2.5 text-left rtl:text-right transition-colors disabled:opacity-75 ${
                isCurrentTenant
                  ? 'bg-blue-500/10 cursor-default'
                  : 'hover:bg-[var(--bg-surface-hover)] cursor-pointer'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-[var(--text-main)] truncate">
                    {t.name}
                  </span>
                  {isCurrentTenant && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold flex-shrink-0">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {t.code && (
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      {t.code}
                    </span>
                  )}
                  {t.plan && (
                    <span className="text-[10px] text-[var(--text-faint)] uppercase">
                      • {t.plan}
                    </span>
                  )}
                </div>
              </div>
              {isCurrentTenant ? (
                <Check className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : switching ? (
                <div className="w-3.5 h-3.5 border border-[var(--border-strong)] border-t-[var(--text-main)] rounded-full animate-spin flex-shrink-0" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-2">
      {/* Super Admin Only: Dedicated Quick Tenant Switcher Pill in Header */}
      {canSwitch && (
        <div className="relative" ref={tenantDropdownRef}>
          <button
            type="button"
            onClick={() => {
              setTenantMenuOpen(v => !v);
              setOpen(false);
            }}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer select-none ${
              impersonatedBy
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                : tenantMenuOpen
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-400 shadow-sm'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/80 text-[var(--text-main)] hover:border-blue-500/40 hover:bg-[var(--bg-surface-hover)]'
            }`}
            title={tLabel('Super Admin: Switch Tenant to view Tenant Pages')}
          >
            <Building2 className={`w-3.5 h-3.5 flex-shrink-0 ${impersonatedBy ? 'text-amber-400' : 'text-blue-400'}`} />
            <span className="truncate max-w-[140px]">
              {tenant?.name ?? tLabel('Select Tenant')}
            </span>
            <span className="hidden md:inline text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-bold uppercase tracking-wider">
              {tLabel('Switch Tenant')}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 opacity-70 transition-transform ${tenantMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {tenantMenuOpen && (
            <div className="absolute right-0 rtl:right-auto rtl:left-0 top-full mt-2 w-80 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl shadow-black/40 overflow-hidden z-50">
              <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-bold text-[var(--text-main)] uppercase tracking-wider">
                    {tLabel('Switch Tenant (Super Admin)')}
                  </span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)] font-mono">
                  {allTenants.length} {tLabel('Tenants')}
                </span>
              </div>
              {renderTenantPickerContent()}
            </div>
          )}
        </div>
      )}

      {/* User Profile & Switcher Capsule */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => {
            setOpen(o => !o);
            setTenantMenuOpen(false);
          }}
          className={`flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl border transition-all duration-200 group cursor-pointer select-none ${
            open
              ? 'border-[var(--border-strong)] bg-[var(--bg-surface-elevated)] shadow-sm'
              : 'border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/70 hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)]'
          }`}
          title={`${displayName} (${tLabel(user.roleName ?? '')})`}
        >
          {/* Avatar with Active Online Status Dot */}
          <div className="relative flex-shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center text-white text-[11px] font-bold shadow-sm tracking-tight">
              {initials}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 rtl:-right-auto rtl:-left-0.5 w-2 h-2 bg-emerald-500 rounded-full ring-2 ring-[var(--bg-surface)]" />
          </div>

          {/* User details with refined typography hierarchy */}
          <div className="text-left rtl:text-right hidden sm:flex flex-col min-w-0 pr-0.5">
            <div className="text-[var(--text-main)] text-xs font-semibold leading-tight truncate max-w-[130px] group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
              {displayName}
            </div>
            <div className="text-[var(--text-muted)] text-[11px] leading-tight truncate max-w-[130px] mt-0.5">
              {impersonatedBy ? `${tenant?.name ?? tLabel(user.roleName ?? '')}` : tLabel(user.roleName ?? '')}
            </div>
          </div>

          {/* Smooth animated chevron */}
          <svg
            className={`w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-transform duration-200 flex-shrink-0 ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute right-0 rtl:right-auto rtl:left-0 top-full mt-2 w-80 bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl shadow-black/40 overflow-hidden z-50">
            {/* Current user info */}
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[var(--text-main)] font-medium text-sm truncate">{displayName}</div>
                  <div className="text-[var(--text-muted)] text-xs truncate">{user.email ?? user.username}</div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium">
                      {tLabel(user.roleName ?? '')}
                    </span>
                    {impersonatedBy && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold">
                        SUPER ADMIN VIEW
                      </span>
                    )}
                    {tenant && <span className="text-xs text-[var(--text-faint)] truncate">@ {tenant.name}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Super Admin Only: Switch Tenant / Switch User Tabs */}
            {canSwitch && (
              <>
                <div className="grid grid-cols-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('tenants')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === 'tenants'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    {tLabel('Switch Tenant')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('users')}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === 'users'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    {tLabel('Switch User')}
                  </button>
                </div>

                {activeTab === 'tenants' ? (
                  renderTenantPickerContent()
                ) : (
                  <div className="max-h-56 overflow-y-auto">
                    {loadingUsers && (
                      <div className="px-4 py-3 text-xs text-[var(--text-faint)]">{tLabel('Loading users…')}</div>
                    )}
                    {tenantUsers.length === 0 && !loadingUsers && (
                      <div className="px-4 py-3 text-xs text-[var(--text-faint)]">{tLabel('No other users in this tenant')}</div>
                    )}
                    {tenantUsers.map(u => {
                      const isCurrent = u.id === user.id;
                      const uInitials = ((u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? u.username[0])).toUpperCase();
                      const uName = u.firstName ? `${u.firstName} ${u.lastName ?? ''}`.trim() : u.username;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => switchToUser(u)}
                          disabled={isCurrent || switching || !u.isActive}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left rtl:text-right transition-colors disabled:opacity-50 ${
                            isCurrent
                              ? 'bg-blue-500/10 cursor-default'
                              : 'hover:bg-[var(--bg-surface-hover)] cursor-pointer'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${isCurrent ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                            {uInitials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-[var(--text-main)] truncate">{uName}</span>
                              {isCurrent && <span className="text-xs text-blue-400 flex-shrink-0">{tLabel('(you)')}</span>}
                              {!u.isActive && <span className="text-xs text-[var(--text-faint)] flex-shrink-0">{tLabel('(inactive)')}</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-[var(--text-muted)] truncate">{tLabel(u.roleName ?? u.roleCode ?? '')}</span>
                            </div>
                          </div>
                          {switching && !isCurrent && (
                            <div className="w-4 h-4 border border-[var(--border-strong)] border-t-[var(--text-main)] rounded-full animate-spin flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Actions */}
            <div className="border-t border-[var(--border-subtle)] p-2">
              <button
                onClick={signOut}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
                </svg>
                {tLabel('Sign out')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
