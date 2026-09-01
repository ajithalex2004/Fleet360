export const dynamic = 'force-dynamic';

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
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { randomUUID } from 'crypto';
import { requireUnderQuota } from '@/lib/plan-limits';
import { cacheRead, publicCacheControl, revalidateCache } from '@/lib/server-cache';
import type { PlanCode } from '@/lib/billing';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const CACHE_TAG = 'users:list';

// Platform admin dashboard's stat card calls this on every page load.
// Must be self-contained (cacheRead's own contract - no closures over
// request state): the previous version closed over a per-request `tx`
// (from the outer withPlatformAdmin transaction, already closed by the
// time any cache revalidation could re-run this) and a per-request
// `where` built from search/isActive query params, while taking zero
// arguments itself - so unstable_cache had nothing to key on besides the
// static tag, and every combination of search/isActive filters collided
// into the same one cache entry, serving whichever combination happened
// to run first to every other combination. Taking the filter inputs as
// real arguments lets unstable_cache key on them correctly, and opening
// withPlatformAdmin here instead of reusing an outer tx keeps the
// function's own transaction scoped to its own execution.
const getUsers = cacheRead(
  async (isActive: string | null, search: string | null) => withPlatformAdmin(prisma, (tx) => {
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
    return tx.user.findMany({ where, orderBy: { username: 'asc' } });
  }),
  [CACHE_TAG],
);

// All modules in the platform — used for moduleAccess validation
const ALL_MODULES = [
  'fleet', 'maintenance', 'booking', 'logistics',
  'staff', 'school_bus', 'incident', 'rental', 'leasing',
  'finance', 'admin', 'reports',
] as const;
type ModuleName = typeof ALL_MODULES[number];

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

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

    // User is a global table (no RLS) but UserTenant has RLS. We use
    // withPlatformAdmin so the UserTenant lookup is allowed even when
    // ?tenantId= refers to a tenant the admin's session is not in.
    return await withPlatformAdmin(prisma, async (tx) => {
      if (tenantId) {
        // Return users for a specific tenant with their roles — tenant-scoped,
        // not cached (data shape varies by tenant, low call frequency).
        const uts = await tx.userTenant.findMany({
          where: { tenantId },
          include: { role: true },
        });
        const userIds = uts.map(ut => ut.userId);
        const users   = await tx.user.findMany({ where: { ...where, id: { in: userIds } } });
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
            })),
          { headers: { 'Cache-Control': publicCacheControl(30) } }
        );
      }

      // Cached: the platform admin dashboard's stat card calls this on
      // every page load. Data Cache + s-maxage makes 1st hit sub-100ms,
      // 2nd hit is microseconds. Stale-while-revalidate hides the origin
      // latency for cold CDN edges. getUsers is module-scoped and
      // self-contained (see its definition) so unstable_cache keys
      // correctly on isActive/search instead of every filter combination
      // colliding into one shared entry.
      const users = await getUsers(isActive, search);

      // Filter by module access if requested (in-memory, post-fetch)
      const filtered = module
        ? users.filter(u => {
            const ma = u.moduleAccess as Record<string, boolean> | null;
            return !ma || ma[module] !== false; // null = full access (backward compat)
          })
        : users;

      return NextResponse.json(filtered, {
        headers: { 'Cache-Control': publicCacheControl(60) },
      });
    });
    } catch (e) {
    console.error('[Admin Hub] GET /api/admin/users error:', e);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);

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
      const current = await withPlatformAdmin(prisma, (tx) =>
        tx.userTenant.count({ where: { tenantId, isActive: true } })
      );
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

    // Use withPlatformAdmin — User is global but the optional UserTenant
    // membership write is tenant-scoped. We need '*' so the UserTenant
    // create can land on the target tenant.
    return await withPlatformAdmin(prisma, async (tx) => {
      const user = await tx.user.create({
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
        userTenant = await tx.userTenant.create({
          data: {
            userId,
            tenantId,
            roleId,
            isActive: true,
          },
          include: { role: true },
        });
      }

      // Invalidate cached list so the platform dashboard's stat card
      // and the user list page see the new user on next request.
      revalidateCache([CACHE_TAG]);

      return NextResponse.json({ ...user, userTenant }, { status: 201 });
    });
    } catch (e) {
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
