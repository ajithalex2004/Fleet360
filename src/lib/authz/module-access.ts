/**
 * Module permission check for the few shared endpoints whose module is only
 * known from the request itself (a query parameter, a body field or the row
 * being changed), which the path-based matrix cannot see:
 *
 *   /api/branch-staff          LEASING | RENTAL | BOTH staff
 *   /api/leasing/documents/upload   the leasing documents page and the RAC counter
 *
 * The matrix lets these through for any signed-in member (SELF); the handler
 * then checks, through loadModuleAccess, the modules the request touches. It
 * follows AUTHZ_MODE like the middleware: `report` logs a would-deny and
 * lets the request continue, `enforce` answers 403, `off` skips the check.
 *
 * Permissions come from the user's effective role in the tenant, as signed
 * into sessions (session-permissions.ts), so tenant custom roles and
 * overrides count, not only the built-in roles.
 */
import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { authzMode, POLICY_VERSION } from '@/lib/authz/policy';
import { sessionPermissionsFor } from '@/lib/authz/session-permissions';

type Action = 'view' | 'create' | 'edit' | 'delete';

function holds(perms: readonly string[], module: string, action: Action): boolean {
  return hasPermission([...perms], module, action)
    || perms.some((p) => p.startsWith(`${module}:${action}:`) || p === `${module}:*:*`);
}

export type ModuleAccessCheck = (
  modules: readonly string[],
  action: Action,
  path: string,
) => NextResponse | null;

/**
 * Loads the caller's permissions (call it before opening the request's tenant
 * transaction: it runs its own platform-context read) and returns a check:
 * null when the caller may perform `action` on at least one of `modules`, or
 * the mode lets the request through; otherwise the 403 response.
 */
export async function loadModuleAccess(headers: Headers, tenantId: string): Promise<ModuleAccessCheck> {
  const mode = authzMode();
  const role = headers.get('x-user-role') ?? '';
  if (mode === 'off' || role === 'SUPER_ADMIN') return () => null;
  const userId = headers.get('x-user-id');
  const perms = userId ? await sessionPermissionsFor(userId, tenantId) : [];

  return (modules, action, path) => {
    if (modules.some((m) => holds(perms, m, action))) return null;
    const required = modules.map((m) => `${m}:${action}:*`).join(' | ');
    console.warn(JSON.stringify({
      authz: mode === 'enforce' ? 'deny' : 'would-deny',
      policy: POLICY_VERSION,
      path,
      reason: 'missing-permission',
      required,
      role,
      tenantId,
    }));
    if (mode !== 'enforce') return null;
    return NextResponse.json(
      { error: 'You do not have permission for this action', reason: 'missing-permission', required },
      { status: 403 },
    );
  };
}

/** Permission modules for a branch-staff `module` value (LEASING | RENTAL | BOTH). */
export function branchStaffModules(value: unknown): string[] {
  switch (String(value ?? '').toUpperCase()) {
    case 'LEASING': return ['leasing'];
    case 'RENTAL': return ['rental'];
    default: return ['leasing', 'rental'];
  }
}
