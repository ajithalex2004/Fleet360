/**
 * Admin Hub — /api/admin/users/[id]
 *
 * GET   — fetch single user with tenant memberships and role details
 * PATCH — update user identity, isActive, or moduleAccess
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertUserInTenant, requireAdminRole } from '@/lib/admin-auth';
import { recordAdminChange } from '@/lib/admin-change-history';
import { MODULES } from '@/lib/permissions';
import { normalizeModuleAccessRecord } from '@/lib/module-access-presets';

type Params = { params: Promise<{ id: string }> };

const ALL_MODULES = MODULES;

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    if (!auth.isSuperAdmin && !(await assertUserInTenant(id, auth.tenantId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const tenants = await prisma.userTenant.findMany({
      where: { userId: id },
      include: { tenant: true, role: true },
    });

    return NextResponse.json({ ...user, tenants });
  } catch (e) {
    console.error('[Admin Hub] GET /api/admin/users/[id]:', e);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const auth = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    if (!auth.isSuperAdmin && !(await assertUserInTenant(id, auth.tenantId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body    = await req.json();
    const before = await prisma.user.findUnique({ where: { id } });

    const {
      username, email, firstName, lastName,
      department, position, mobileNumber, hierarchy,
      userType, employeeId,
      isActive, moduleAccess,
    } = body;

    const normalizedModuleAccess = normalizeModuleAccessRecord(moduleAccess);

    // Validate moduleAccess keys
    if (normalizedModuleAccess) {
      const invalid = Object.keys(normalizedModuleAccess as Record<string, unknown>).filter(
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
    if (moduleAccess !== undefined) data.moduleAccess = normalizedModuleAccess;

    const user = await prisma.user.update({ where: { id }, data });
    await recordAdminChange({
      req,
      ctx: auth,
      tenantId: auth.tenantId,
      entityType: 'User',
      entityId: user.id,
      entityName: user.email,
      action: 'UPDATE',
      before,
      after: user,
      summary: `Updated user ${user.email}.`,
    });
    return NextResponse.json(user);
  } catch (e) {
    console.error('[Admin Hub] PATCH /api/admin/users/[id]:', e);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const auth = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    if (!auth.isSuperAdmin && !(await assertUserInTenant(id, auth.tenantId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Soft-delete: deactivate rather than hard-delete
    const user = await prisma.user.update({
      where: { id },
      data:  { isActive: false, updatedAt: new Date() },
    });
    await recordAdminChange({
      req,
      ctx: auth,
      tenantId: auth.tenantId,
      entityType: 'User',
      entityId: user.id,
      entityName: user.email,
      action: 'DELETE',
      after: user,
      summary: `Deactivated user ${user.email}.`,
    });
    return NextResponse.json({ success: true, message: 'User deactivated', user });
  } catch (e) {
    console.error('[Admin Hub] DELETE /api/admin/users/[id]:', e);
    return NextResponse.json({ error: 'Failed to deactivate user' }, { status: 500 });
  }
}
