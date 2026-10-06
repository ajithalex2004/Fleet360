export const dynamic = 'force-dynamic';

/**
 * Admin Hub — /api/admin/users/[id]
 *
 * GET   — fetch single user with tenant memberships and role details
 * PATCH — update user identity, isActive, or moduleAccess
 */

import { revokeSessionsSafely } from '@/lib/auth/session-revocation';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { isSuperAdmin } from '@/lib/admin-access';
import { reportingLineValue, userScopeDenied } from '@/lib/admin/user-scope';
const CACHE_TAG = 'users:list';

type Params = { params: Promise<{ id: string }> };

const ALL_MODULES = [
  'fleet', 'maintenance', 'booking', 'logistics',
  'staff', 'school_bus', 'incident', 'rental', 'leasing',
  'finance', 'admin', 'reports',
] as const;

export async function GET(req: NextRequest, { params }: Params) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { id } = await params;
    // User is global but UserTenant has RLS. Use platform-admin so we can
    // see all of the user's tenant memberships in one shot.
    return await withPlatformAdmin(prisma, async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      const denied = await userScopeDenied(tx, req.headers, tenantId, id, 'member');
      if (denied) return denied;

      // A company administrator sees the user's membership in their company only.
      const tenants = await tx.userTenant.findMany({
        where: { userId: id, ...(isSuperAdmin(req.headers) ? {} : { tenantId }) },
        include: { tenant: true, role: true },
      });

      // Reporting lines in the caller's company (Direct Manager / Department
      // Head approvers in Admin > Workflows).
      const here = tenants.find((t) => t.tenantId === tenantId);
      return NextResponse.json({
        ...user, tenants,
        reportingLines: { managerUserId: here?.managerUserId ?? null, departmentHeadUserId: here?.departmentHeadUserId ?? null },
      });
    });
    } catch (e) {
    console.error('[Admin Hub] GET /api/admin/users/[id]:', e);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

async function handlePATCH(req: NextRequest, { params }: Params) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { id } = await params;
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);

    const {
      username, email, firstName, lastName,
      department, position, mobileNumber, hierarchy,
      userType, employeeId,
      isActive, moduleAccess,
      managerUserId, departmentHeadUserId,
    } = body;

    // Validate moduleAccess keys
    if (moduleAccess) {
      const invalid = Object.keys(moduleAccess).filter(
        k => !(ALL_MODULES as readonly string[]).includes(k)
      );
      if (invalid.length) {
        return NextResponse.json(
          { error: `Invalid module keys: ${invalid.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { updatedAt: new Date() };
    if (username     !== undefined) data.username     = username;
    if (email        !== undefined) data.email        = email;
    if (firstName    !== undefined) data.firstName    = firstName;
    if (lastName     !== undefined) data.lastName     = lastName;
    if (department   !== undefined) data.department   = department;
    if (position     !== undefined) data.position     = position;
    if (mobileNumber !== undefined) data.mobileNumber = mobileNumber;
    if (hierarchy    !== undefined) data.hierarchy    = hierarchy;
    if (userType     !== undefined) data.userType     = userType;
    if (employeeId   !== undefined) data.employeeId   = employeeId;
    if (isActive     !== undefined) data.isActive     = isActive;
    if (moduleAccess !== undefined) data.moduleAccess = moduleAccess;

    // Reporting lines are per company: set on the user's membership in the
    // caller's company (Direct Manager / Department Head approvers).
    const lines: { managerUserId?: string | null; departmentHeadUserId?: string | null } = {};
    const accountChange = [username, email, isActive, moduleAccess, userType].some((v) => v !== undefined);
    const result = await withPlatformAdmin(prisma, async (tx) => {
      const denied = await userScopeDenied(tx, req.headers, tenantId, id, accountChange ? 'account' : 'member');
      if (denied) return { denied };
      for (const [key, value, label] of [
        ['managerUserId', managerUserId, 'Manager'],
        ['departmentHeadUserId', departmentHeadUserId, 'Department head'],
      ] as const) {
        if (value === undefined) continue;
        const checked = await reportingLineValue(tx, tenantId, id, value, label);
        if (!checked.ok) return { denied: NextResponse.json({ error: checked.error }, { status: 400 }) };
        lines[key] = checked.value;
      }
      const user = await tx.user.update({ where: { id }, data });
      if (Object.keys(lines).length) {
        await tx.userTenant.updateMany({ where: { userId: id, tenantId }, data: lines });
      }
      return { user };
    });
    if (result.denied) return result.denied;
    const { user } = result;
    // Deactivated, or module access changed: current sessions end within 60 s.
    if (isActive === false || moduleAccess !== undefined) {
      await revokeSessionsSafely({
        userId: id,
        reason: isActive === false ? 'user-deactivated' : 'module-access-changed',
        revokedBy: authz.userId,
      });
    }
    // isActive changed → bust the cached user list so the dashboard
    // count and the user list both reflect the new state immediately.
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(user);
  } catch (e) {
    console.error('[Admin Hub] PATCH /api/admin/users/[id]:', e);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

async function handleDELETE(_req: NextRequest, { params }: Params) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { id } = await params;
    // Soft-delete: deactivate rather than hard-delete
    const result = await withPlatformAdmin(prisma, async (tx) => {
      const denied = await userScopeDenied(tx, _req.headers, tenantId, id, 'account');
      if (denied) return { denied };
      return {
        user: await tx.user.update({
          where: { id },
          data:  { isActive: false, updatedAt: new Date() },
        }),
      };
    });
    if (result.denied) return result.denied;
    const { user } = result;
    await revokeSessionsSafely({ userId: id, reason: 'user-deactivated', revokedBy: authz.userId });
    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ success: true, message: 'User deactivated', user });
    } catch (e) {
    console.error('[Admin Hub] DELETE /api/admin/users/[id]:', e);
    return NextResponse.json({ error: 'Failed to deactivate user' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
