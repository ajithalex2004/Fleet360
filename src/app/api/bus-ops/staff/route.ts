export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const CACHE_TAG = 'bus-ops:staff';

const getStaff = cacheRead(
  async (
    tenantId: string | null,
    department: string | null,
    routeId: string | null,
    active: string | null,
  ) => {
    // Post-Task-3: routeId + shiftType live on TransportEnrollment now
    // (child of the employee). Filter through the relation instead of
    // the deprecated defaultRouteId column on the parent. `active` gates
    // on person-level isActive plus, when routeId is provided, on the
    // enrollment's isActive too.
    return prisma.staffMember.findMany({
      where: {
        deletedAt: null,
        ...(tenantId   ? { tenantId }              : {}),
        ...(department ? { department }            : {}),
        ...(active === 'true' ? { isActive: true } : {}),
        ...(routeId ? {
          transportEnrollments: {
            some: { defaultRouteId: routeId, deletedAt: null,
                    ...(active === 'true' ? { isActive: true } : {}) },
          },
        } : {}),
      },
      include: {
        transportEnrollments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,   // one active enrollment per employee (partial unique)
        },
      },
      orderBy: { name: 'asc' },
    });
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    const department = searchParams.get('department');
    const routeId    = searchParams.get('routeId');
    const active     = searchParams.get('active');

    const staff = await getStaff(tenantId, department, routeId, active);
    return NextResponse.json(staff, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
    } catch (e) {
    console.error('Error fetching staff:', e);
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        if (!body?.name?.toString().trim())       return NextResponse.json({ error: 'name is required' },       { status: 400 });
        if (!body?.employeeId?.toString().trim()) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });

        // Body wins for fields we accept, but tenantId is always stamped from the
        // session header — never trust body-supplied tenantId.
        const staffMember = await tx.staffMember.create({
          data: { ...body, tenantId },
        });
        revalidateCache([CACHE_TAG]);
        return NextResponse.json(staffMember, { status: 201 });
        } catch (e) {
        // Prisma P2002 = unique-constraint violation. StaffMember.employeeId is
        // globally unique — most likely cause of this e in practice — so
        // give ops a clear message instead of a generic 500.
        const code = (e as { code?: string } | null)?.code;
        if (code === 'P2002') {
          return NextResponse.json({
            error: 'An employee with this Employee ID already exists. Pick a different Employee ID.',
          }, { status: 409 });
        }
        console.error('Error creating staff member:', e);
        return NextResponse.json({
          error: e instanceof Error ? e.message : 'Failed to create staff member',
        }, { status: 500 });
      }
  });
}

