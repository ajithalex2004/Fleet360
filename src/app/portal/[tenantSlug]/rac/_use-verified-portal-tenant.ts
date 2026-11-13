'use client';

import { useEffect, useState } from 'react';

export interface VerifiedTenantInfo {
  id: string;
  name: string;
  slug: string | null;
  code: string | null;
  maxVehicles?: number;
}

export type TenantGuardState =
  | { status: 'checking'; tenant: null; expectedSlug: null }
  | { status: 'verified'; tenant: VerifiedTenantInfo; expectedSlug: string | null }
  | { status: 'mismatch'; tenant: VerifiedTenantInfo; expectedSlug: string | null }
  | { status: 'unauthorized'; tenant: null; expectedSlug: null };

export function slugifyTenant(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const slug = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || null;
}

export function useVerifiedPortalTenant(tenantSlug: string): TenantGuardState {
  const [state, setState] = useState<TenantGuardState>({
    status: 'checking',
    tenant: null,
    expectedSlug: null,
  });

  useEffect(() => {
    let cancelled = false;
    const slugLower = tenantSlug.trim().toLowerCase();
    if (!slugLower) {
      setState({ status: 'unauthorized', tenant: null, expectedSlug: null });
      return;
    }

    (async () => {
      try {
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (meRes.status === 401 || meRes.status === 403) {
          if (!cancelled) setState({ status: 'unauthorized', tenant: null, expectedSlug: null });
          return;
        }

        let tenantId: string | null = null;
        let tenantName = '';
        let tenantCode: string | null = null;
        let isSuperAdmin = false;

        if (meRes.ok) {
          const me = (await meRes.json()) as Record<string, unknown>;
          tenantId = typeof me.tenantId === 'string' && me.tenantId.trim() ? me.tenantId.trim() : null;
          tenantName = typeof me.tenantName === 'string' ? me.tenantName.trim() : '';
          tenantCode = typeof me.tenantCode === 'string' && me.tenantCode.trim() ? me.tenantCode.trim() : null;
          isSuperAdmin = Boolean(me.isSuperAdmin || me.role === 'SUPER_ADMIN');
        }

        // Fallback to /api/admin/session if /api/auth/me did not populate tenant details
        if (!tenantId || (!tenantCode && !tenantName)) {
          const sessionRes = await fetch('/api/admin/session', { cache: 'no-store' }).catch(() => null);
          if (sessionRes?.ok) {
            const session = (await sessionRes.json()) as {
              user?: { role?: string };
              tenant?: { id?: string; name?: string; code?: string | null };
            };
            tenantId = tenantId ?? (session.tenant?.id?.trim() || null);
            tenantName = tenantName || (session.tenant?.name?.trim() ?? '');
            tenantCode = tenantCode ?? (session.tenant?.code?.trim() || null);
            if (session.user?.role === 'SUPER_ADMIN') isSuperAdmin = true;
          }
        }

        if (!tenantId) {
          if (!cancelled) setState({ status: 'unauthorized', tenant: null, expectedSlug: null });
          return;
        }

        const candidates = new Set(
          [
            tenantCode?.toLowerCase(),
            slugifyTenant(tenantCode),
            slugifyTenant(tenantName),
            tenantName ? tenantName.toLowerCase().replace(/\s+/g, '-') : null,
            tenantId.toLowerCase(),
          ].filter((v): v is string => Boolean(v)),
        );

        const expectedSlug =
          tenantCode?.toLowerCase() ||
          slugifyTenant(tenantCode) ||
          slugifyTenant(tenantName) ||
          tenantId.toLowerCase();

        if (candidates.has(slugLower)) {
          if (!cancelled) {
            setState({
              status: 'verified',
              tenant: {
                id: tenantId,
                name: tenantName || tenantCode || tenantId,
                slug: expectedSlug,
                code: tenantCode,
              },
              expectedSlug,
            });
          }
          return;
        }

        // Allow platform SUPER_ADMIN to inspect another valid tenant via /api/admin/tenants
        if (isSuperAdmin) {
          const tenantsRes = await fetch('/api/admin/tenants', { cache: 'no-store' }).catch(() => null);
          if (tenantsRes?.ok) {
            const rawTenants = await tenantsRes.json();
            const list: Array<Record<string, unknown>> = Array.isArray(rawTenants)
              ? rawTenants
              : Array.isArray(rawTenants?.tenants)
              ? rawTenants.tenants
              : Array.isArray(rawTenants?.data)
              ? rawTenants.data
              : [];
            const matched = list.find((t) => {
              const tId = typeof t.id === 'string' ? t.id.trim() : '';
              const tCode = typeof t.code === 'string' ? t.code.trim() : '';
              const tName = typeof t.name === 'string' ? t.name.trim() : '';
              const tCandidates = [
                tCode.toLowerCase(),
                slugifyTenant(tCode),
                slugifyTenant(tName),
                tName.toLowerCase().replace(/\s+/g, '-'),
                tId.toLowerCase(),
              ].filter(Boolean);
              return tCandidates.includes(slugLower);
            });
            if (matched && typeof matched.id === 'string') {
              const mCode = typeof matched.code === 'string' ? matched.code : null;
              const mName = typeof matched.name === 'string' ? matched.name : matched.id;
              const mSlug = mCode?.toLowerCase() || slugifyTenant(mName) || matched.id.toLowerCase();
              if (!cancelled) {
                setState({
                  status: 'verified',
                  tenant: {
                    id: matched.id,
                    name: mName,
                    slug: mSlug,
                    code: mCode,
                    maxVehicles: typeof matched.maxVehicles === 'number' ? matched.maxVehicles : undefined,
                  },
                  expectedSlug: mSlug,
                });
              }
              return;
            }
          }
        }

        if (!cancelled) {
          setState({
            status: 'mismatch',
            tenant: {
              id: tenantId,
              name: tenantName || tenantCode || tenantId,
              slug: expectedSlug,
              code: tenantCode,
            },
            expectedSlug,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ status: 'unauthorized', tenant: null, expectedSlug: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  return state;
}
