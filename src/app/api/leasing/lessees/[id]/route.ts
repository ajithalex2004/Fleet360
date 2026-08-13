import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Single-lessee GET/PATCH/DELETE.
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware, plus the explicit id, so a cross-tenant id probe returns
 * 404 (treated as "not found" rather than 403, to avoid leaking the
 * existence of rows belonging to other tenants).
 *
 * Note: `leaseContracts` (V1) was removed by the V1/V2 cleanup
 * (see docs/AUDIT_SCHEMA_V1_V2.md). V2 relations live on
 * LeaseContract2; we surface a small contract preview by joining via
 * the lessee's quotations → contracts2 chain.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const lessee = await prisma.lessee.findFirst({
      where: { id: params.id, tenantId },
      include: {
        quotations: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { contracts: { take: 1, orderBy: { createdAt: 'desc' } } },
        },
        creditAssessments: { orderBy: { assessmentDate: 'desc' }, take: 1 },
        invoices: { where: { status: { in: ['SENT', 'OVERDUE'] } }, take: 5 },
        directDebits: { where: { status: 'ACTIVE' } },
      },
    });
    if (!lessee) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(lessee);
  } catch (e) {
    console.error('GET /api/leasing/lessees/[id] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const { quotations, creditAssessments, invoices, directDebits, ...data } = await req.json();
    // Verify tenant ownership before update (defense-in-depth — findUnique
    // bypasses RLS-like scoping so we explicitly enforce here).
    const existing = await prisma.lessee.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const lessee = await prisma.lessee.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    return NextResponse.json(lessee);
  } catch (e) {
    console.error('PATCH /api/leasing/lessees/[id] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const existing = await prisma.lessee.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await prisma.lessee.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/leasing/lessees/[id] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
