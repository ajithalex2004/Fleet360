/**
 * /api/leasing/receivables/dunning — list + create dunning activity rows.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * stamp the new row with the caller's tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const activities = await prisma.leaseDunningActivity.findMany({
      where: {
        tenantId,
        ...(contractId
          ? { contract: { id: contractId, tenantId } }
          : {}),
      },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(activities);
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
    const activity = await prisma.leaseDunningActivity.create({
      data: { ...body, tenantId },
    });
    return NextResponse.json(activity, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
