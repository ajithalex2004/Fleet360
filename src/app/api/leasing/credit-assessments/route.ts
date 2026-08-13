/**
 * /api/leasing/credit-assessments — list + create LeaseCreditAssessment.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * stamp the new row with the same tenantId.
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
    const lesseeId = searchParams.get('lesseeId');
    const items = await prisma.leaseCreditAssessment.findMany({
      where: {
        tenantId,
        ...(lesseeId
          ? { lessee: { id: lesseeId, tenantId } }
          : {}),
      },
      include: { lessee: { select: { name: true, type: true } } },
      orderBy: { assessmentDate: 'desc' },
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
    const lessee = await prisma.lessee.findFirst({
      where: { id: body.lesseeId, tenantId },
      select: { id: true },
    });
    if (!lessee) {
      return NextResponse.json({ error: 'Lessee not found' }, { status: 404 });
    }
    const item = await prisma.leaseCreditAssessment.create({
      data: { ...body, tenantId },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
