/**
 * /api/leasing/telematics — list + upsert LeaseTelematics rows.
 *
 * Tenant scoping: requires x-tenant-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const items = await tx.leaseTelematics.findMany({
          where: { tenantId },
          orderBy: { lastUpdateAt: 'desc' },
        });
        return NextResponse.json(items);
      } catch (e) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);

    // The schema doesn't define a compound unique on (tenantId, vehicleId),
    // so we look up the existing row for this (tenant, vehicle) and either
    // patch it or create a new one. Keeps the endpoint idempotent without
    // requiring a Prisma @@unique migration.
    const existing = await prisma.leaseTelematics.findFirst({
      where: { tenantId, vehicleId: body.vehicleId },
      select: { id: true },
    });

    if (existing) {
      const updated = await withTenantRls(prisma, tenantId, async (tx) =>
        tx.leaseTelematics.update({
        where: { id: existing.id },
        data: {
          lastOdometer: body.lastOdometer,
          lastUpdateAt: new Date(),
          lastLat: body.lastLat,
          lastLng: body.lastLng,
        },
      }),
      );
      return NextResponse.json(updated, { status: 200 });
    }

    const created = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseTelematics.create({
      data: { ...body, tenantId },
    }),
    );
    return NextResponse.json(created, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
