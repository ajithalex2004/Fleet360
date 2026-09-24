/**
 * Tenant-ownership checks for admin endpoints that tenant admins may call
 * (level 'admin' in src/lib/admin-access.ts). Middleware has already
 * checked the caller's role; these keep a TENANT_ADMIN inside their own
 * tenant. SUPER_ADMIN passes every check.
 */

import { NextResponse } from 'next/server';
import { isSuperAdmin, SUPER_ADMIN } from '@/lib/admin-access';
import { getStepWorkflowOwner, getWorkflowOwner } from '@/lib/workflow-db';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });
const forbidden = (message: string) =>
  NextResponse.json({ error: 'Forbidden', message }, { status: 403 });

/**
 * Decide whether the caller may act on a record owned by `owner`
 * (a tenant id, or null for a platform-level record).
 *   read  — own tenant's records and platform records
 *   write — own tenant's records only
 * Returns a response to send back, or null when access is allowed.
 */
export function checkOwnership(
  headers: Headers,
  callerTenantId: string,
  owner: string | null | undefined,
  mode: 'read' | 'write',
): NextResponse | null {
  if (owner === undefined) return notFound();
  if (isSuperAdmin(headers)) return null;
  if (owner === callerTenantId) return null;
  if (owner === null && mode === 'read') return null;
  if (owner === null) {
    return forbidden('Platform-level records can only be changed by a platform administrator.');
  }
  // Another tenant's record: answer as if it doesn't exist.
  return notFound();
}

export async function checkWorkflowAccess(
  headers: Headers,
  callerTenantId: string,
  workflowId: string,
  mode: 'read' | 'write',
): Promise<NextResponse | null> {
  return checkOwnership(headers, callerTenantId, await getWorkflowOwner(workflowId), mode);
}

export async function checkWorkflowStepAccess(
  headers: Headers,
  callerTenantId: string,
  stepId: string,
): Promise<NextResponse | null> {
  return checkOwnership(headers, callerTenantId, await getStepWorkflowOwner(stepId), 'write');
}

/**
 * Whether the caller may give `role` to a member of `targetTenantId`
 * (membership, invitation or SSO default role). Only a platform admin may
 * grant SUPER_ADMIN, and nobody may grant another tenant's role. Returns a
 * response to send back, or null when allowed.
 */
export function checkGrantableRole(
  headers: Headers,
  targetTenantId: string,
  role: { code: string; tenantId: string | null },
): NextResponse | null {
  if (role.code === SUPER_ADMIN && !isSuperAdmin(headers)) {
    return forbidden('Only a platform administrator can grant the SUPER_ADMIN role.');
  }
  if (role.tenantId !== null && role.tenantId !== targetTenantId) {
    return NextResponse.json({ error: 'Role belongs to another tenant' }, { status: 400 });
  }
  return null;
}

/** Tenant that owns a role: tenant id, null for a platform role, undefined if missing. */
async function getRoleOwner(roleId: string): Promise<string | null | undefined> {
  const role = await withPlatformAdmin(prisma, (tx) =>
    tx.role.findUnique({ where: { id: roleId }, select: { tenantId: true } }),
  );
  return role ? role.tenantId : undefined;
}

/**
 * Tenant admins may read platform roles and their own tenant's roles, and
 * change only their own tenant's roles. See checkOwnership().
 */
export async function checkRoleAccess(
  headers: Headers,
  callerTenantId: string,
  roleId: string,
  mode: 'read' | 'write',
): Promise<{ denied: NextResponse } | { denied: null; owner: string | null }> {
  const owner = await getRoleOwner(roleId);
  const denied = checkOwnership(headers, callerTenantId, owner, mode);
  if (denied) return { denied };
  return { denied: null, owner: owner as string | null };
}
