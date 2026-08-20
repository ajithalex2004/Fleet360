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

export default function RequireTenantAdmin({ resource, children }: { resource: string; children: React.ReactNode }) {
  const { data, loading } = useFetchedData<{ role?: string }>('/api/auth/me');

  if (loading) {
    return <div className="p-10 text-center text-slate-500 text-sm">Checking access…</div>;
  }

  const roleCode = data?.role ?? '';
  const perms = (SYSTEM_ROLES.find(r => r.code === roleCode)?.permissions ?? [])
    .map(p => buildPermissionKey(p.module, p.action, p.resource));
  const allowed = hasPermission(perms, 'bus-ops', 'admin', resource);

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
