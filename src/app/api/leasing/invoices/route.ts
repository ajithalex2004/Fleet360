import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';

/**
 * Lease invoice list (GET) + issue (POST).
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the invoicing
 * surface. The schema-side tenantId column is set by the migration
 * `20260627000001_add_tenant_id_to_leasing_tables`.
 */
export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const status   = searchParams.get('status');
    const invoices = await prisma.leaseInvoice.findMany({
      where: {
        tenantId,
        ...(lesseeId ? { lesseeId } : {}),
        ...(status ? { status } : {}),
      },
      include: { lessee: { select: { name: true } }, lines: true },
      orderBy: { issueDate: 'desc' },
    });
    return NextResponse.json(invoices);
  } catch (e) {
    console.error('GET /api/leasing/invoices error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export const POST = withAudit(
  async (req: NextRequest) => {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    try {
      const body = await req.json();
      const { lines = [], ...invoiceData } = body;
      // Per-tenant invoice number (not global — tenant A and tenant B
      // can each have INV-000001).
      const count = await prisma.leaseInvoice.count({ where: { tenantId } });
      const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
      const subTotal = lines.reduce((s: number, l: any) => s + parseFloat(l.totalAmount || '0'), 0);
      const vatPct   = parseFloat(invoiceData.vatPct ?? '5');
      const vatAmount = subTotal * (vatPct / 100);
      const totalAmount = subTotal + vatAmount;
      const invoice = await prisma.leaseInvoice.create({
        data: {
          ...invoiceData,
          tenantId,
          invoiceNo,
          subTotal,
          vatAmount,
          totalAmount,
          lines: { create: lines },
        },
        include: { lines: true, lessee: { select: { name: true } } },
      });
      return NextResponse.json(invoice, { status: 201 });
    } catch (e) {
      console.error('POST /api/leasing/invoices error:', e);
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
  },
  {
    entityType: 'LeaseInvoice',
    action: 'CREATE',
    extractEntity: (body) => ({ id: body?.id, name: body?.invoiceNo }),
    describe: (_req, body) =>
      body?.invoiceNo
        ? `Issued invoice ${body.invoiceNo} for ${body.totalAmount ?? 0} ${body.currency ?? 'AED'} (lessee: ${body.lessee?.name ?? body.lesseeId ?? 'unknown'})`
        : undefined,
  },
);
