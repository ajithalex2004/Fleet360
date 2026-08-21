/**
 * Shared server-side gate for bus-ops features restricted to Tenant Admin /
 * Super Admin: Planning Core, Route Consolidation, Planning Constraints
 * (PCE), Vehicle/Resource Optimization. Checked against the bus-ops:admin:*
 * permission rows in permissions.ts — a distinct action (not 'view'/'edit')
 * so it's never satisfied by the pre-existing bus-ops:view:* wildcard grant
 * held by Transport Manager/Operator. middleware.ts sets x-user-role from
 * the session; we map that role to its granted permission strings via
 * SYSTEM_ROLES rather than trusting a client-sent permissions list, same
 * pattern as requireScoringPolicyEditPermission in
 * route-consolidation/scoring-policy/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { hasPermission, buildPermissionKey, SYSTEM_ROLES } from '@/lib/permissions';

export function requireBusOpsAdminAccess(req: NextRequest, resource: string): NextResponse | null {
  const roleCode = req.headers.get('x-user-role') ?? '';
  const perms = (SYSTEM_ROLES.find(r => r.code === roleCode)?.permissions ?? [])
    .map(p => buildPermissionKey(p.module, p.action, p.resource));
  if (!hasPermission(perms, 'bus-ops', 'admin', resource)) {
    return NextResponse.json(
      { error: 'This feature is restricted to Tenant Administrators.' },
      { status: 403 },
    );
  }
  return null;
}
