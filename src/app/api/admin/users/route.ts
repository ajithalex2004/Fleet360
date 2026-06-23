/**
 * Admin Hub — /api/admin/users
 *
 * The Admin Hub owns all user accounts, roles, and module access permissions.
 * No other module maintains its own user table.
 *
 * GET  — list users (filterable by tenantId, role, module, status)
 * POST — create a new user with role assignment and module access
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { requireUnderQuota } from '@/lib/plan-limits';
import type { PlanCode } from '@/lib/billing';
import { requireAdminRole } from '@/lib/admin-auth';
import { recordAdminChange } from '@/lib/admin-change-history';
import { MODULES } from '@/lib/permissions';
import { normalizeModuleAccessRecord, normalizeModuleKey } from '@/lib/module-access-presets';
import { canonicalRoleCode, canonicalRoleLabel } from '@/lib/role-canonicalization';

// All modules in the platform — used for moduleAccess validation
const ALL_MODULES = MODULES;
type ModuleName = typeof MODULES[number];

export async function GET(req: NextRequest) {
  try {
    const auth = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const requestedTenantId = searchParams.get('tenantId');
    const tenantId = auth.isSuperAdmin ? requestedTenantId : auth.tenantId;
    const isActive   = searchParams.get('isActive');
    const moduleParam = searchParams.get('module');
    const module = moduleParam ? normalizeModuleKey(moduleParam) as ModuleName : null;
    const search     = searchParams.get('search');

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (isActive !== null) where.isActive = isActive !== 'false';
    if (search) {
      where.OR = [
        { username:  { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { department:{ contains: search, mode: 'insensitive' } },
      ];
    }

    if (tenantId) {
      // Return users for a specific tenant with their roles
      const uts = await prisma.userTenant.findMany({
        where: { tenantId },
        include: { role: true },
      });
      const userIds = uts.map(ut => ut.userId);
      const users   = await prisma.user.findMany({ where: { ...where, id: { in: userIds } } });
      const userMap = Object.fromEntries(users.map(u => [u.id, u]));
      return NextResponse.json(
        uts
          .filter(ut => userMap[ut.userId])
          .map(ut => ({
            ...userMap[ut.userId],
            tenants: [{
              tenantId,
              tenantName: '',
              roleId: ut.roleId,
              roleName: canonicalRoleLabel(ut.role.code, ut.role.name),
              roleCode: canonicalRoleCode(ut.role) ?? ut.role.code,
              isActive: ut.isActive,
            }],
            roleId:       ut.roleId,
            roleName:     canonicalRoleLabel(ut.role.code, ut.role.name),
            roleCode:     canonicalRoleCode(ut.role) ?? ut.role.code,
            userTenantId: ut.id,
            isTenantActive: ut.isActive,
          }))
      );
    }

    const users = await prisma.user.findMany({
      where,
      include: {
        userTenants: {
          include: {
            tenant: { select: { id: true, name: true, code: true } },
            role: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: { username: 'asc' },
    });

    // Filter by module access if requested
    const filtered = module
      ? users.filter(u => {
          const ma = normalizeModuleAccessRecord(u.moduleAccess) as Record<string, unknown> | null;
          return !!ma?.[module];
        })
      : users;

    return NextResponse.json(filtered.map(u => ({
      ...u,
      tenants: u.userTenants?.map(ut => ({
        tenantId: ut.tenant.id,
        tenantName: ut.tenant.name,
        tenantCode: ut.tenant.code,
        roleId: ut.role.id,
        roleName: canonicalRoleLabel(ut.role.code, ut.role.name),
        roleCode: canonicalRoleCode(ut.role) ?? ut.role.code,
        isActive: ut.isActive,
      })) ?? [],
      userTenants: undefined,
    })));
  } catch (e) {
    console.error('[Admin Hub] GET /api/admin/users error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Failed to fetch users', detail: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
    if (auth instanceof NextResponse) return auth;

    const body = await req.json();

    const {
      id, username, email,
      firstName, lastName, department, position,
      mobileNumber, hierarchy, userType, employeeId,
      // New hub fields
      isActive = true,
      moduleAccess,   // e.g. { fleet: true, maintenance: true, rental: false }
      // Role assignment
      tenantId, roleId,
    } = body;

    const effectiveTenantId = auth.isSuperAdmin ? tenantId : auth.tenantId;
    if (!auth.isSuperAdmin && tenantId && tenantId !== auth.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!username?.trim()) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Quota: count active members in the target tenant against maxUsers.
    if (effectiveTenantId) {
      const tenantPlan = (req.headers.get('x-tenant-plan') ?? 'TRIAL') as PlanCode;
      const current = await prisma.userTenant.count({ where: { tenantId: effectiveTenantId, isActive: true } });
      const gate = requireUnderQuota({ plan: tenantPlan, resource: 'maxUsers', current });
      if (gate) return gate;
    }

    const normalizedModuleAccess = normalizeModuleAccessRecord(moduleAccess);

    // Validate moduleAccess keys if provided
    if (normalizedModuleAccess) {
      const invalidKeys = Object.keys(normalizedModuleAccess as Record<string, unknown>).filter(
        k => !(ALL_MODULES as readonly string[]).includes(k)
      );
      if (invalidKeys.length) {
        return NextResponse.json(
          { error: `Invalid module keys: ${invalidKeys.join(', ')}. Valid modules: ${ALL_MODULES.join(', ')}` },
          { status: 400 }
        );
      }
    }

    const userId = id?.trim() || randomUUID();

    const user = await prisma.user.create({
      data: {
        id:           userId,
        username:     username.trim(),
        email:        email.trim(),
        firstName:    firstName?.trim()    || null,
        lastName:     lastName?.trim()     || null,
        department:   department?.trim()   || null,
        position:     position?.trim()     || null,
        mobileNumber: mobileNumber?.trim() || null,
        hierarchy:    hierarchy?.trim()    || null,
        userType:     userType?.trim()     || 'STAFF',
        employeeId:   employeeId?.trim()   || null,
        isActive:     isActive,
        moduleAccess: normalizedModuleAccess == null ? undefined : normalizedModuleAccess as any,
        updatedAt:    new Date(),
      },
    });

    // If tenantId + roleId provided, create the UserTenant membership
    let userTenant = null;
    if (effectiveTenantId && roleId) {
      const role = await prisma.role.findFirst({
        where: { id: roleId, OR: [{ tenantId: effectiveTenantId }, { tenantId: null, isSystem: true }] },
        select: { id: true },
      });
      if (!role) return NextResponse.json({ error: 'Role is not available for this tenant' }, { status: 400 });

      userTenant = await prisma.userTenant.create({
        data: {
          userId,
          tenantId: effectiveTenantId,
          roleId,
          isActive: true,
        },
        include: { role: true },
      });
    }

    await recordAdminChange({
      req,
      ctx: auth,
      tenantId: effectiveTenantId ?? auth.tenantId,
      entityType: 'User',
      entityId: user.id,
      entityName: user.email,
      action: 'CREATE',
      after: { user, userTenant },
      summary: `Created user ${user.email}.`,
    });
    return NextResponse.json({ ...user, userTenant }, { status: 201 });
  } catch (e: unknown) {
    console.error('[Admin Hub] POST /api/admin/users error:', e);
    const err = e as { code?: string; meta?: { target?: string[] } };
    if (err?.code === 'P2002') {
      const field = err?.meta?.target?.[0] ?? 'field';
      return NextResponse.json(
        { error: `A user with that ${field} already exists` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
