export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';

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

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const quotations = await tx.leaseQuotation.findMany({
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
      } catch (e) {
        console.error('GET /api/leasing/quotations error:', e);
        return NextResponse.json({ error: 'Failed to fetch quotations' }, { status: 500 });
      }
  });
}


export async function POST(request: NextRequest) {
  const authz = requireAuthorizedTenant(request);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await request.json();

    // Strip relational/extra fields that aren't on the LeaseQuotation model
    const {
      vehicles, lineItems, lessee, inquiry,
      approvalSteps, contracts, ...quotationData
    } = body;

    // No UI today submits itemized lineItems directly — it collects one
    // aggregate cost per category instead (accessoriesCost, servicesCost,
    // etc., which map straight to LeaseQuotation's own columns). When the
    // caller doesn't supply explicit lineItems, derive one LeaseQuotationItem
    // per non-zero category from those aggregates so the itemized breakdown
    // the schema was built for is actually populated with real data, rather
    // than staying permanently empty. Explicit lineItems (if a future caller
    // sends granular entries) always take precedence.
    const autoLineItems: Array<{ itemType: string; description: string; amount: number }> = [];
    if (Number(quotationData.accessoriesCost) > 0) {
      autoLineItems.push({ itemType: 'ACCESSORY', description: 'Accessories', amount: Number(quotationData.accessoriesCost) });
    }
    if (Number(quotationData.servicesCost) > 0) {
      autoLineItems.push({ itemType: 'SERVICE', description: 'Additional services', amount: Number(quotationData.servicesCost) });
    }
    if (quotationData.insuranceIncluded && Number(quotationData.insuranceCost) > 0) {
      autoLineItems.push({ itemType: 'INSURANCE', description: 'Insurance', amount: Number(quotationData.insuranceCost) });
    }
    if (quotationData.maintenanceIncluded && Number(quotationData.maintenanceCost) > 0) {
      autoLineItems.push({ itemType: 'MAINTENANCE', description: 'Maintenance', amount: Number(quotationData.maintenanceCost) });
    }
    if (quotationData.driverIncluded && Number(quotationData.driverCost) > 0) {
      autoLineItems.push({ itemType: 'DRIVER', description: 'Driver services', amount: Number(quotationData.driverCost) });
    }
    const durationMonths = Number(quotationData.durationMonths) || null;

    const quotation = await withTenantRls(prisma, tenantId, async (tx) => {
      // G13: serialize quotation-number generation per tenant so two
      // concurrent creates can't compute the same count()+1.
      await lockSerialSeries(tx, tenantId, 'quotation');
      const countExisting = await tx.leaseQuotation.count({ where: { tenantId } });
      const quotationNumber = `QUO-${String(countExisting + 1).padStart(4, '0')}`;
      return tx.leaseQuotation.create({
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
              tenantId,
            })),
          },
        } : {}),
        ...(Array.isArray(lineItems) && lineItems.length > 0 ? {
          lineItems: {
            create: lineItems.map((li: any) => ({
              itemType:      li.itemType ?? 'OTHER',
              description:   li.description || li.itemType || 'Item',
              quantity:      Number(li.quantity) || 1,
              unitRate:      li.unitRate      != null ? Number(li.unitRate)      : null,
              monthlyAmount: li.monthlyAmount != null ? Number(li.monthlyAmount) : null,
              totalAmount:   li.totalAmount   != null ? Number(li.totalAmount)   : null,
              currency:      li.currency ?? quotationData.currency ?? 'AED',
              notes:         li.notes ?? null,
              tenantId,
            })),
          },
        } : autoLineItems.length > 0 ? {
          lineItems: {
            create: autoLineItems.map(it => ({
              itemType:      it.itemType,
              description:   it.description,
              quantity:      1,
              unitRate:      it.amount,
              monthlyAmount: it.amount,
              totalAmount:   durationMonths ? it.amount * durationMonths : null,
              currency:      quotationData.currency ?? 'AED',
              tenantId,
            })),
          },
        } : {}),
      },
      // lessee: true so the row the frontend adds to its list immediately
      // after create has a real lessee.name — without it, the create
      // response's `lessee` field is missing (not just null), and every
      // subsequent optimistic status update in the wizard spreads that same
      // object forward, so the row shows blank/'-' for lessee until a full
      // page reload re-fetches from GET (which already included it).
      include: { lineItems: true, vehicles: true, lessee: true },
    });
    });

    return NextResponse.json({
      ...quotation,
      vehicles:  Array.isArray(quotation.vehicles)  ? quotation.vehicles  : [],
      lineItems: Array.isArray(quotation.lineItems) ? quotation.lineItems : [],
    }, { status: 201 });
    } catch (e) {
    console.error('POST /api/leasing/quotations error:', e?.message);
    return NextResponse.json(
      { error: e?.message ?? 'Failed to create quotation' },
      { status: 500 }
    );
  }
}
