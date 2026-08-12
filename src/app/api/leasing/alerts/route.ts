/**
 * /api/leasing/alerts — list + create LeaseAlert rows.
 *
 * Tenant scoping: requires x-tenant-id.
 *
 * Note: the Prisma `LeaseAlert` model has no `deletedAt` column (only
 * `status` with values OPEN/ACKNOWLEDGED/RESOLVED). The original route's
 * `where: { deletedAt: null }` filter was a pre-existing type error
 * (KNOWN-TS-001); this rewrite drops the broken filter.
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
    const severity = searchParams.get('severity');
    const status = searchParams.get('status');
    const contractId = searchParams.get('contractId');

    const alerts = await prisma.leaseAlert.findMany({
      where: {
        tenantId,
        ...(severity ? { severity } : {}),
        ...(status ? { status } : {}),
        ...(contractId
          ? { contract: { id: contractId, tenantId } }
          : {}),
      },
      include: { contract: { select: { contractNumber: true, lesseeId: true } } },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(alerts);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const alert = await prisma.leaseAlert.create({ data: { ...body, tenantId } });
    return NextResponse.json(alert, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
