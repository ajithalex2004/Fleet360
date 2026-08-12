/**
 * /api/leasing/documents — list + create LeaseDocument rows.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant (joined
 * through entity ownership when relevant); creates stamp the new row with
 * the same tenantId.
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
    const entityType = searchParams.get('entityType');
    const entityId   = searchParams.get('entityId');
    const docs = await prisma.leaseDocument.findMany({
      where: {
        tenantId,
        ...(entityType ? { entityType } : {}),
        ...(entityId   ? { entityId   } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(docs);
  } catch {
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
    const doc = await prisma.leaseDocument.create({
      data: { ...body, tenantId },
    });
    return NextResponse.json(doc, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
