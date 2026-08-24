/**
 * POST /api/admin/roles/override
 *
 * Create a tenant-specific override of a platform role.
 *
 * Why this exists:
 *   The platform ships a default role catalog (e.g. "Finance Manager") with a
 *   default permission set. A tenant may need to grant/revoke a few permissions
 *   for their own use case (e.g. allow their Finance Manager to delete
 *   contracts but not insurance policies). Editing the platform role would
 *   leak that change to every other tenant — the whole point of multi-tenancy
 *   is isolation.
 *
 *   This endpoint creates a sibling `Role` row with the same `code`, scoped
 *   to the requesting tenant. The new role is NOT a system role and is fully
 *   editable in the standard Roles & Permissions page.
 *
 * Permission resolution at runtime (separate work):
 *   When a user logs in and is assigned a role, the system should prefer the
 *   tenant override (if it exists) over the platform role. Today, UserTenant
 *   stores a specific roleId — the assignment flow is the natural place to
 *   substitute the override. This endpoint only creates the override; the
 *   assignment migration is a follow-up.
 *
 * Behavior:
 *   - Source role must exist and be a platform/system role (tenantId is NULL
 *     or isSystem=true). Cannot override a tenant override.
 *   - tenantId must be present in the request body and must be the caller's
 *     tenant (the middleware's x-tenant-id header is the source of truth).
 *   - 409 if an override already exists for (tenantId, code) — caller should
 *     use the existing one.
 *   - Copies every RolePermission row from the source role to the new role.
 *
 * Response: 201 with the new role including its permission count.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const ROLES_TAG = 'roles:all';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    // Tenant identity comes from the middleware-injected header — never
    // trust a body-supplied tenantId for a tenant admin. Super admins can
    // pass an explicit `tenantId` in the body to override a specific
    // tenant (used by the platform admin "Edit tenant X" flow).
    const headerTenantId = req.headers.get('x-tenant-id') ?? '';
    const role = req.headers.get('x-user-role') ?? 'TENANT_ADMIN';
    const isSuperAdmin = role === 'SUPER_ADMIN';

    const body = await req.json();
    const { sourceRoleId, tenantId: bodyTenantId } = body as {
      sourceRoleId?: string;
      tenantId?: string;
    };

    if (!sourceRoleId) {
      return NextResponse.json({ error: 'sourceRoleId is required' }, { status: 400 });
    }

    // Tenant resolution:
    //   - Super admin: must supply tenantId in body (headerTenantId may be
    //     a different context if they're impersonating).
    //   - Tenant admin: headerTenantId is authoritative.
    const tenantId = isSuperAdmin ? (bodyTenantId ?? headerTenantId) : headerTenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    // All DB work goes through withPlatformAdmin — Role is multi-tenant via
    // RLS and we need to look up the source role across the platform catalog
    // plus create a sibling role scoped to the target tenant.
    const result = await withPlatformAdmin(prisma, async (tx) => {
      // 1. Load source role + its permissions
      const source = await tx.role.findUnique({
        where: { id: sourceRoleId },
        include: { permissions: { select: { permissionId: true } } },
      });
      if (!source) return { error: 'Source role not found', status: 404 as const };

      // Cannot override a tenant override — overrides only target platform
      // roles. A chain of overrides would complicate the runtime resolution.
      if (source.tenantId !== null) {
        return {
          error: 'Cannot create an override of a tenant-specific role. Source must be a platform role.',
          status: 400 as const,
        };
      }

      // 2. Check if an override already exists for (tenantId, code)
      const existing = await tx.role.findUnique({
        where: { tenantId_code: { tenantId, code: source.code } },
      });
      if (existing) {
        return {
          error: `A custom version of "${source.name}" already exists for this tenant.`,
          status: 409 as const,
          existingRoleId: existing.id,
        };
      }

      // 3. Create the override + copy permissions in a single transaction
      const newRole = await tx.role.create({
        data: {
          tenantId,
          name:        source.name,
          code:        source.code,
          description: source.description,
          isSystem:    false, // overrides are never system roles
          permissions: source.permissions.length > 0
            ? {
                create: source.permissions.map((p) => ({ permissionId: p.permissionId })),
              }
            : undefined,
        },
        include: { _count: { select: { permissions: true, userTenants: true } } },
      });

      return { ok: true as const, role: newRole };
    });

    if ('error' in result) {
      return NextResponse.json(
        { error: result.error, ...(('existingRoleId' in result) ? { existingRoleId: result.existingRoleId } : {}) },
        { status: result.status },
      );
    }

    // New override means the cached role list (per tenant) is stale.
    await revalidateCache(ROLES_TAG);
    return NextResponse.json(result.role, { status: 201 });
  } catch (e: unknown) {
    console.error('[POST /api/admin/roles/override]', e);
    const message = e instanceof Error ? e.message : 'Failed to create override';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
