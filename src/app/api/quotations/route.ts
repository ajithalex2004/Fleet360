import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const quotations = await tx.quotation.findMany({
                where: { deletedAt: null },
                include: {
                    MaintenanceRequest: true,
                    Garage: true,
                    quotationLabors: true,
                    quotationParts: true,
                    attachments: true,
                },
                orderBy: { createdAt: 'desc' }
            });
            return NextResponse.json(JSON.parse(JSON.stringify(quotations)));
        } catch (e) {
            console.error('Failed to fetch quotations:', e);
            return NextResponse.json({ error: 'Internal Server Error', details: String(e) }, { status: 500 });
        }
  });
}


export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const quotation = await tx.quotation.create({
                data: {
                    // TODO: read tenantId from request headers via getTenantContext()
                    tenantId: '',
                    maintenanceRequestId: body.maintenanceRequestId || body.maintenance_request_id,
                    garageId: body.garageId || body.garage_id,
                    status: body.status || 'PENDING',
                    quotationDate: body.quotationDate ? new Date(body.quotationDate) : new Date(),
                    validUntil: body.validUntil ? new Date(body.validUntil) : null,
                    laborCost: body.laborCost ?? null,
                    partsCost: body.partsCost ?? null,
                    consumablesCost: body.consumablesCost ?? null,
                    vatAmount: body.vatAmount ?? null,
                    totalCost: body.totalCost ?? null,
                    grandTotal: body.grandTotal ?? null,
                    currency: body.currency || 'AED',
                    estimatedDuration: body.estimatedDuration ? BigInt(body.estimatedDuration) : null,
                    estimatedCompletionDate: body.estimatedCompletionDate ? new Date(body.estimatedCompletionDate) : null,
                    submittedBy: body.submittedBy || body.submitted_by,
                    notes: body.notes,
                }
            });

            return NextResponse.json(JSON.parse(JSON.stringify(quotation)), { status: 201 });
            } catch (e) {
            console.error('Failed to create quotation:', e);
            return NextResponse.json({ error: 'Internal Server Error', details: String(e) }, { status: 500 });
        }
  });
}

