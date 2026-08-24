import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

/**
 * Receipt list for a single contract (GET) + record a receipt against
 * that contract (POST).
 *
 * Multi-tenant: the contract lookup uses `findFirst` with both id and
 * tenantId, then both the receipt list query and the create carry
 * tenantId explicitly. A request for a contract id from another tenant
 * returns 404 (not 403) to avoid leaking row existence.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        // Verify the contract belongs to this tenant before listing its
        // receipts — otherwise a cross-tenant contract id would expose
        // receipts to the wrong tenant.
        const contract = await tx.leaseContract2.findFirst({
          where: { id: params.id, tenantId },
          select: { id: true },
        });
        if (!contract) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const receipts = await tx.leaseReceipt.findMany({
          where: { tenantId, contractId: params.id },
          orderBy: { receivedDate: 'desc' },
        });
        return NextResponse.json(receipts);
      } catch (e) {
        console.error('GET /api/leasing/contracts-v2/[id]/receipts error:', e);
        return NextResponse.json({ error: 'Internal server e' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;
    const amount = Number(body.amount ?? 0);

    const receipt = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseReceipt.create({
      data: {
        tenantId,
        contractId: params.id,
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
    console.error('POST /api/leasing/contracts-v2/[id]/receipts error:', e);
    return NextResponse.json({ error: 'Internal server e' }, { status: 500 });
  }
}
