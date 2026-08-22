/**
 * Client-side gate for bus-ops pages restricted by the bus-ops:admin:<resource>
 * permission — Planning Core, Route Consolidation, Planning Constraints
 * (PCE), Vehicle/Resource Optimization. Reads the same SYSTEM_ROLES /
 * hasPermission logic as the server-side requireBusOpsAdminAccess (see
 * src/lib/bus-ops/require-admin-access.ts), so a role granted access there
 * (e.g. via a role's `permissions` array in permissions.ts) sees the page
 * here too, with no separate UI-side allowlist to keep in sync. UI-level
 * convenience only — the API routes are the actual enforcement boundary
 * and can't be bypassed by skipping this check.
 */

'use client';

import { ShieldAlert } from 'lucide-react';
import { useFetchedData } from '@/hooks/useFetchedData';
import { hasPermission, buildPermissionKey, SYSTEM_ROLES } from '@/lib/permissions';

/**
 * Same check as the component below, but returned rather than rendered.
 *
 * Needed where access decides what to *offer* instead of whether to show
 * a page at all — the Planning Engine uses it to omit the "Edit PCE
 * Rules" button for users who lack bus-ops:admin:planning-constraints,
 * since rendering it would walk them into a 403 from the drawer's first
 * fetch.
 *
 * `loading` is surfaced so callers can avoid flashing an affordance on
 * and then off again while /api/auth/me is in flight.
 */
export function useBusOpsAdminAccess(resource: string): { allowed: boolean; loading: boolean } {
  const { data, loading } = useFetchedData<{ role?: string }>('/api/auth/me');
  const roleCode = data?.role ?? '';
  const perms = (SYSTEM_ROLES.find(r => r.code === roleCode)?.permissions ?? [])
    .map(p => buildPermissionKey(p.module, p.action, p.resource));
  return { allowed: hasPermission(perms, 'bus-ops', 'admin', resource), loading };
}

export default function RequireTenantAdmin({ resource, children }: { resource: string; children: React.ReactNode }) {
  const { allowed, loading } = useBusOpsAdminAccess(resource);

  if (loading) {
    return <div className="p-10 text-center text-slate-500 text-sm">Checking access…</div>;
  }

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-12 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-slate-600 mb-3" />
        <p className="text-slate-300">This feature is restricted to Tenant Administrators.</p>
        <p className="mt-1 text-xs text-slate-500">Contact your tenant admin if you need access.</p>
      </div>
    );
  }

  return <>{children}</>;
}
