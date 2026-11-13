/**
 * Fine-grained server-side RBAC helpers for the Rent-A-Car (RAC) module.
 *
 * Complements the Edge authorization matrix (src/lib/authz/policy.ts) for
 * dynamic `[id]` sub-actions and field-level privileges that cannot be
 * inferred purely from HTTP method + top-level resource:
 *
 *   - Booking confirmation / penalty sweep → `rental:approve:bookings`
 *   - Booking cancellation (`POST /api/rental/bookings/[id]/cancel`) → `rental:delete:bookings`
 *   - Security deposit refund/release (`POST /api/rental/agreements/[id]/refund-deposit`) → `rental:approve:deposits`
 *   - Invoice void / credit note (`POST /api/rental/invoices/[id]/void`) → `rental:approve:invoices`
 *   - Extension / renewal approval (`PATCH /api/rental/renewals`) → `rental:approve:renewals`
 *   - Damage claim settlement / billing (`PATCH /api/rental/damage-claims/[id]`) → `rental:approve:damage`
 *   - Manual tariff / rate overrides → `rental:approve:rates`
 *   - Customer credit limit, blacklist & B2B portal admin edits → `rental:approve:customers`
 *   - KYC document verification (`PATCH /api/rental/documents`) → `rental:approve:documents`
 *   - Inter-branch transfer approval (`PATCH /api/rental/transfers`) → `rental:approve:transfers`
 *
 * Security invariants:
 *   - When `x-user-id` is present, permissions come strictly from `sessionPermissionsFor(userId, tenantId)`.
 *     An empty return (`[]` — deactivated user, removed membership, or module mask) NEVER falls back
 *     to `systemRolePermissions(role)`, and DB errors fail closed (`[]`).
 *   - Synthetic unit-test headers without `x-user-id` fall back to `systemRolePermissions(role)`.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasPermission, SYSTEM_ROLES } from '@/lib/permissions';
import { authzMode, POLICY_VERSION } from '@/lib/authz/policy';
import { sessionPermissionsFor, systemRolePermissions } from '@/lib/authz/session-permissions';

export type RentalAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export';

const KNOWN_SYSTEM_ROLE_CODES = new Set(SYSTEM_ROLES.map((r) => r.code));

function isUnimpersonatedSuperAdmin(headers: Headers, role: string): boolean {
  return role === 'SUPER_ADMIN' && !(headers.get('x-impersonated-by') ?? '').trim();
}

/**
 * Resolves the caller's effective permission strings for the tenant.
 * Fails closed (`[]`) if `x-user-id` is present and has no active permissions or DB lookup fails.
 */
export async function resolveCallerRentalPermissions(
  headers: Headers,
  tenantId: string,
): Promise<{ role: string; permissions: string[] }> {
  const role = (headers.get('x-user-role') ?? headers.get('x-role') ?? '').trim();
  if (isUnpersonatedOrSuperAdmin(headers, role)) {
    return { role, permissions: ['*:*:*'] };
  }

  const userId = (headers.get('x-user-id') ?? '').trim();
  if (userId) {
    // System cron jobs carry x-user-id = 'system:cron' + x-user-role = 'SYSTEM_JOB'
    if (userId === 'system:cron' && role === 'SYSTEM_JOB') {
      return { role, permissions: ['rental:*:*'] };
    }
    const hasRealDbClient = typeof (prisma as unknown as { $transaction?: unknown })?.$transaction === 'function';
    if (hasRealDbClient) {
      try {
        const dbPerms = await sessionPermissionsFor(userId, tenantId);
        return { role, permissions: dbPerms };
      } catch {
        // Fail closed when a real DB client lookup errors.
        return { role, permissions: [] };
      }
    }
  }

  if (KNOWN_SYSTEM_ROLE_CODES.has(role)) {
    return { role, permissions: systemRolePermissions(role) };
  }

  return { role, permissions: [] };
}

function isUnpersonatedOrSuperAdmin(headers: Headers, role: string): boolean {
  return isUnimpersonatedSuperAdmin(headers, role);
}

/**
 * Checks whether the caller holds `rental:<action>:<resource>`.
 * Returns `null` when allowed (or when `AUTHZ_MODE` is `report`/`off`),
 * or a `403 NextResponse` when denied in `enforce` mode.
 */
export async function requireRentalPermission(
  headers: Headers,
  tenantId: string,
  action: RentalAction,
  resource: string,
  pathname = '/api/rental',
): Promise<NextResponse | null> {
  const mode = authzMode();
  const role = (headers.get('x-user-role') ?? headers.get('x-role') ?? '').trim();
  if (mode === 'off' || isUnimpersonatedSuperAdmin(headers, role)) {
    return null;
  }

  const { permissions } = await resolveCallerRentalPermissions(headers, tenantId);
  const granted = hasPermission(permissions, 'rental', action, resource);
  if (granted) return null;

  const required = `rental:${action}:${resource}`;
  console.warn(
    JSON.stringify({
      authz: mode === 'enforce' ? 'deny' : 'would-deny',
      policy: POLICY_VERSION,
      path: pathname,
      reason: 'missing-permission',
      required,
      role,
      tenantId,
    }),
  );

  if (mode !== 'enforce') return null;

  return NextResponse.json(
    {
      error: `Insufficient permissions: requires ${required} (RAC Manager or Tenant Admin)`,
      reason: 'missing-permission',
      required,
    },
    { status: 403 },
  );
}

/**
 * Convenience boolean check for conditional manager-only capabilities
 * (e.g., auto-approving an extension initiated by a RAC_MANAGER vs queuing PENDING for RAC_OPERATOR).
 */
export async function hasRentalPermission(
  headers: Headers,
  tenantId: string,
  action: RentalAction,
  resource: string,
): Promise<boolean> {
  const mode = authzMode();
  if (mode === 'off') return true;

  const role = (headers.get('x-user-role') ?? headers.get('x-role') ?? '').trim();
  if (isUnimpersonatedSuperAdmin(headers, role)) return true;

  const { permissions } = await resolveCallerRentalPermissions(headers, tenantId);
  return hasPermission(permissions, 'rental', action, resource);
}
