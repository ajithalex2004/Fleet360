import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

/**
 * Quotation list (GET) + create (POST).
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the quotation
 * surface. The schema-side tenantId column is set by the migration
 * `20260627000001_add_tenant_id_to_leasing_tables`.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const quotations = await prisma.leaseQuotation.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        lineItems: true,
        vehicles:  true,
        lessee:    true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const safe = (quotations as any[]).map(q => ({
      ...q,
      vehicles:  Array.isArray(q.vehicles)  ? q.vehicles  : [],
      lineItems: Array.isArray(q.lineItems) ? q.lineItems : [],
    }));

    return NextResponse.json(safe);
  } catch (error) {
    console.error('GET /api/leasing/quotations error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await request.json();
    // Generate serial quotation number scoped to this tenant
    const countExisting = await prisma.leaseQuotation.count({ where: { tenantId } });
    const quotationNumber = `QUO-${String(countExisting + 1).padStart(4, '0')}`;

    // Strip relational/extra fields that aren't on the LeaseQuotation model
    const {
      vehicles, lineItems, lessee, inquiry,
      approvalSteps, contracts, ...quotationData
    } = body;

    const quotation = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseQuotation.create({
      data: {
        ...quotationData,
        tenantId,
        quotationNumber,
        status: quotationData.status ?? 'NEW',
        ...(Array.isArray(vehicles) && vehicles.length > 0 ? {
          vehicles: {
            create: vehicles.map((v: any) => ({
              vehicleType: v.vehicleType ?? 'SEDAN',
              make:        v.make        ?? null,
              model:       v.model       ?? null,
              year:        v.year        ?? new Date().getFullYear(),
              quantity:    Number(v.quantity)    || 1,
              monthlyRate: Number(v.monthlyRate) || 0,
            })),
          },
        } : {}),
      },
      include: { lineItems: true, vehicles: true },
    }),
    );

    return NextResponse.json({
      ...quotation,
      vehicles:  Array.isArray(quotation.vehicles)  ? quotation.vehicles  : [],
      lineItems: Array.isArray(quotation.lineItems) ? quotation.lineItems : [],
    }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/leasing/quotations error:', error?.message);
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create quotation' },
      { status: 500 }
    );
  }
}
