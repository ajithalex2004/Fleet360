export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

/**
 * Lease receipt list (GET) + record (POST).
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the receipts
 * surface. The schema-side tenantId column is set by the migration
 * `20260627000001_add_tenant_id_to_leasing_tables`.
 */
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const contractId = searchParams.get('contractId');

        const receipts = await tx.leaseReceipt.findMany({
          where: {
            tenantId,
            ...(contractId ? { contractId } : {}),
          },
          include: { contract: { select: { contractNumber: true } } },
          orderBy: { receivedDate: 'desc' },
        });
        return NextResponse.json(receipts);
      } catch (e) {
        console.error('GET /api/leasing/receipts error:', e);
        return NextResponse.json({ error: 'Internal server e' }, { status: 500 });
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

    // Verify the referenced contract belongs to this tenant before
    // creating the receipt. Otherwise a cross-tenant contract id would
    // leak data into our tenant.
    if (body.contractId) {
      const contract = await prisma.leaseContract2.findFirst({
        where: { id: body.contractId, tenantId },
        select: { id: true },
      });
      if (!contract) {
        return NextResponse.json({ error: 'Contract not found in this tenant' }, { status: 404 });
      }
    }

    const receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;
    const amount = Number(body.amount ?? 0);

    const receipt = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseReceipt.create({
      data: {
        tenantId,
        contractId: body.contractId,
        receiptNumber,
        paymentType: body.paymentType ?? 'MONTHLY',
        amount,
        currency: body.currency ?? 'AED',
        receivedDate: body.receivedDate ? new Date(body.receivedDate) : new Date(),
        paymentMethod: body.paymentMethod ?? null,
        chequeNo: body.chequeNo ?? null,
        bankRef: body.bankRef ?? null,
        receivedBy: body.receivedBy ?? null,
        branchId: body.branchId ?? null,
        notes: body.notes ?? null,
      },
    }),
    );
    return NextResponse.json(receipt, { status: 201 });
    } catch (e) {
    console.error('POST /api/leasing/receipts error:', e);
    return NextResponse.json({ error: 'Internal server e' }, { status: 500 });
  }
}
