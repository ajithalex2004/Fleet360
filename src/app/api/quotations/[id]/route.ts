export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { getEventBus }        from '@/events/event-bus';
import { QUOTATION_APPROVED } from '@/events/registry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;
        try {
            const quotation = await tx.quotation.findFirst({
                where: { tenantId, id, deletedAt: null },
                include: {
                    MaintenanceRequest: true,
                    Garage: true,
                    quotationLabors: true,
                    quotationParts: true,
                    attachments: true,
                },
            });

            if (!quotation) {
                return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
            }

            return NextResponse.json(JSON.parse(JSON.stringify(quotation)));
        } catch (e) {
            console.error('Failed to fetch quotation:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}


export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;
        try {
            const body = stripTenantOwnershipFields(await request.json());

            const data: Record<string, unknown> = {};
            if (body.status !== undefined) data.status = body.status;
            if (body.garageId !== undefined) data.garageId = body.garageId;
            if (body.garage_id !== undefined) data.garageId = body.garage_id;
            if (body.maintenanceRequestId !== undefined) data.maintenanceRequestId = body.maintenanceRequestId;
            if (body.maintenance_request_id !== undefined) data.maintenanceRequestId = body.maintenance_request_id;
            if (body.quotationDate !== undefined) data.quotationDate = body.quotationDate ? new Date(body.quotationDate as string) : null;
            if (body.validUntil !== undefined) data.validUntil = body.validUntil ? new Date(body.validUntil as string) : null;
            if (body.laborCost !== undefined) data.laborCost = body.laborCost;
            if (body.partsCost !== undefined) data.partsCost = body.partsCost;
            if (body.consumablesCost !== undefined) data.consumablesCost = body.consumablesCost;
            if (body.vatAmount !== undefined) data.vatAmount = body.vatAmount;
            if (body.totalCost !== undefined) data.totalCost = body.totalCost;
            if (body.grandTotal !== undefined) data.grandTotal = body.grandTotal;
            if (body.currency !== undefined) data.currency = body.currency;
            if (body.estimatedDuration !== undefined) data.estimatedDuration = body.estimatedDuration ? BigInt(body.estimatedDuration as number | string) : null;
            if (body.estimatedCompletionDate !== undefined) data.estimatedCompletionDate = body.estimatedCompletionDate ? new Date(body.estimatedCompletionDate as string) : null;
            if (body.submittedBy !== undefined) data.submittedBy = body.submittedBy;
            if (body.submitted_by !== undefined) data.submittedBy = body.submitted_by;
            if (body.notes !== undefined) data.notes = body.notes;

            const updated = await tx.quotation.update({
                where: { id },
                data,
                include: {
                    MaintenanceRequest: true,
                    Garage: true,
                    quotationLabors: true,
                    quotationParts: true,
                    attachments: true,
                },
            });

            // ── Finance: quotation APPROVED → transactional outbox ────────────
            // FinanceQuotationConsumer handles AP payable + DRAFT JE asynchronously.
            // mirrorMaintenanceToFinance() will idempotently skip the JE on completion.
            const newStatus = updated.status;
            if (newStatus === 'APPROVED') {
                const amount = Number(updated.grandTotal ?? updated.totalCost ?? 0);
                const outboxTenantId = updated.tenantId;
                if (amount > 0 && outboxTenantId) {
                    await getEventBus().publish({
                        eventType:     QUOTATION_APPROVED,
                        aggregateType: 'Quotation',
                        aggregateId:   id,
                        sourceModule:  'maintenance',
                        tenantId:      outboxTenantId,
                        actor:         'system',
                        payload: {
                            quotationId:          id,
                            maintenanceRequestId: updated.maintenanceRequestId ?? null,
                            garageId:             updated.Garage?.id            ?? null,
                            garageName:           updated.Garage?.name          ?? null,
                            amount,
                            currency:             updated.currency ?? 'AED',
                            approvedAt:           new Date().toISOString(),
                        },
                    }).catch(err => console.warn('[quotation approve] outbox publish failed:', err));
                }
            }

            return NextResponse.json(JSON.parse(JSON.stringify(updated)));
        } catch (e) {
            console.error('Failed to update quotation:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}


export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }

    return PUT(request, { params });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;
        try {
            await tx.quotation.update({
                where: { id },
                data: { deletedAt: new Date() },
            });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete quotation:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}

