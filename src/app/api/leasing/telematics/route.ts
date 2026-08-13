/**
 * /api/leasing/telematics — list + upsert LeaseTelematics rows.
 *
 * Tenant scoping: requires x-tenant-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const items = await prisma.leaseTelematics.findMany({
      where: { tenantId },
      orderBy: { lastUpdateAt: 'desc' },
    });
    return NextResponse.json(items);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();

    // The schema doesn't define a compound unique on (tenantId, vehicleId),
    // so we look up the existing row for this (tenant, vehicle) and either
    // patch it or create a new one. Keeps the endpoint idempotent without
    // requiring a Prisma @@unique migration.
    const existing = await prisma.leaseTelematics.findFirst({
      where: { tenantId, vehicleId: body.vehicleId },
      select: { id: true },
    });

    if (existing) {
      const updated = await prisma.leaseTelematics.update({
        where: { id: existing.id },
        data: {
          lastOdometer: body.lastOdometer,
          lastUpdateAt: new Date(),
          lastLat: body.lastLat,
          lastLng: body.lastLng,
        },
      });
      return NextResponse.json(updated, { status: 200 });
    }

    const created = await prisma.leaseTelematics.create({
      data: { ...body, tenantId },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
