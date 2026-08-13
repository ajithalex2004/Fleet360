import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Single-lease-invoice GET / PATCH.
 *
 * Multi-tenant: `findFirst` enforces x-tenant-id from the middleware.
 * Returns 404 (not 403) on cross-tenant probes to avoid leaking
 * row existence.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const inv = await prisma.leaseInvoice.findFirst({
    where: { id: params.id, tenantId },
    include: { lines: true, lessee: true },
  });
  return inv
    ? NextResponse.json(inv)
    : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    // Verify tenant ownership before update.
    const existing = await prisma.leaseInvoice.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { lines, lessee, ...data } = await req.json();
    if (data.status === 'SENT' && !data.sentAt) data.sentAt = new Date();
    if (data.status === 'PAID' && !data.paidAt) data.paidAt = new Date();
    const inv = await prisma.leaseInvoice.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    return NextResponse.json(inv);
  } catch (e) {
    console.error('PATCH /api/leasing/invoices/[id] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
