import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

/**
 * Traffic fines list (GET) + record (POST).
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the fines
 * surface.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const billingStatus = searchParams.get('billingStatus');
    const fines = await prisma.leaseTrafficFine.findMany({
      where: {
        tenantId,
        ...(contractId ? { contractId } : {}),
        ...(billingStatus ? { billingStatus } : {}),
      },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { violationDate: 'desc' },
    });
    return NextResponse.json(fines);
  } catch (e) {
    console.error('GET /api/leasing/traffic-fines error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await req.json();

    // Cross-tenant guard: if a contractId is supplied, it must belong
    // to this tenant.
    if (body.contractId) {
      const contract = await prisma.leaseContract2.findFirst({
        where: { id: body.contractId, tenantId },
        select: { id: true },
      });
      if (!contract) {
        return NextResponse.json({ error: 'Contract not found in this tenant' }, { status: 404 });
      }
    }

    const count = await prisma.leaseTrafficFine.count({ where: { tenantId } });
    const fineNo = body.fineNo ?? `TF-${String(count + 1).padStart(6, '0')}`;
    const finalAmount = body.finalAmount ?? (parseFloat(body.fineAmount) - parseFloat(body.discountAmount || '0'));
    const fine = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseTrafficFine.create({
      data: { ...body, tenantId, fineNo, finalAmount },
    }),
    );
    return NextResponse.json(fine, { status: 201 });
  } catch (e) {
    console.error('POST /api/leasing/traffic-fines error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
