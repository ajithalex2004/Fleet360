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

// All modules in the platform — used for moduleAccess validation
const ALL_MODULES = [
  'fleet', 'maintenance', 'booking', 'logistics',
  'staff', 'school_bus', 'incident', 'rental', 'leasing',
  'finance', 'admin', 'reports',
] as const;
type ModuleName = typeof ALL_MODULES[number];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId   = searchParams.get('tenantId');
    const isActive   = searchParams.get('isActive');
    const module     = searchParams.get('module') as ModuleName | null;
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
            roleId:       ut.roleId,
            roleName:     ut.role.name,
            roleCode:     ut.role.code,
            userTenantId: ut.id,
            isTenantActive: ut.isActive,
          }))
      );
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { username: 'asc' },
    });

    // Filter by module access if requested
    const filtered = module
      ? users.filter(u => {
          const ma = u.moduleAccess as Record<string, boolean> | null;
          return !ma || ma[module] !== false; // null = full access (backward compat)
        })
      : users;

    return NextResponse.json(filtered);
  } catch (e) {
    console.error('[Admin Hub] GET /api/admin/users error:', e);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
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

    if (!username?.trim()) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Quota: count active members in the target tenant against maxUsers.
    if (tenantId) {
      const tenantPlan = (req.headers.get('x-tenant-plan') ?? 'TRIAL') as PlanCode;
      const current = await prisma.userTenant.count({ where: { tenantId, isActive: true } });
      const gate = requireUnderQuota({ plan: tenantPlan, resource: 'maxUsers', current });
      if (gate) return gate;
    }

    // Validate moduleAccess keys if provided
    if (moduleAccess) {
      const invalidKeys = Object.keys(moduleAccess).filter(
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
        moduleAccess: moduleAccess ?? null,
        updatedAt:    new Date(),
      },
    });

    // If tenantId + roleId provided, create the UserTenant membership
    let userTenant = null;
    if (tenantId && roleId) {
      userTenant = await prisma.userTenant.create({
        data: {
          userId,
          tenantId,
          roleId,
          isActive: true,
        },
        include: { role: true },
      });
    }

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
