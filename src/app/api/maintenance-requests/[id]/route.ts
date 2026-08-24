import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma }       from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  publishMaintenanceApproved,
  publishMaintenanceRejected,
  publishQuotationRequested,
  publishQuotationReceived,
  publishEstimationApproved,
  publishWorkOrderCreated,
  publishWorkOrderStarted,
  publishRepairCompleted,
  publishWorkOrderCompleted,
  publishMaintenanceClosed,
} from '@/lib/maintenance/publish-event';

export async function GET(request: Request, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const req = await tx.maintenanceRequest.findFirst({
                where: { id: params.id, deletedAt: null },
                include: {
                    Vehicle: true,
                    Garage: true,
                    Driver: true,
                    quotations: true,
                    WorkOrder: true,
                    attachments: true,
                    comments: true,
                    histories: true,
                },
            });

            if (!req) {
                return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            }

            return NextResponse.json(JSON.parse(JSON.stringify(req)));
        } catch (e) {
            console.error('Failed to fetch maintenance request:', e);
            return NextResponse.json({ error: 'Failed to fetch request' }, { status: 500 });
        }
  });
}


export async function PATCH(request: Request, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const data: Record<string, unknown> = {};
            if (body.vehicleId !== undefined) data.vehicleId = body.vehicleId;
            if (body.vehicle_id !== undefined) data.vehicleId = body.vehicle_id;
            if (body.driverId !== undefined) data.driverId = body.driverId;
            if (body.driver_id !== undefined) data.driverId = body.driver_id;
            if (body.description !== undefined) data.description = body.description;
            if (body.status !== undefined) data.status = body.status;
            if (body.priority !== undefined) data.priority = body.priority;
            if (body.maintenanceType !== undefined) data.maintenanceType = body.maintenanceType;
            if (body.maintenance_type !== undefined) data.maintenanceType = body.maintenance_type;
            if (body.workOrderNo !== undefined) data.workOrderNo = body.workOrderNo;
            if (body.work_order_no !== undefined) data.workOrderNo = body.work_order_no;
            if (body.odometer !== undefined) data.odometer = body.odometer ? BigInt(body.odometer) : null;
            if (body.garageId !== undefined) data.garageId = body.garageId;
            if (body.garage_id !== undefined) data.garageId = body.garage_id;
            if (body.estimatedCost !== undefined) data.estimatedCost = body.estimatedCost;
            if (body.actualCost !== undefined) data.actualCost = body.actualCost;
            if (body.requestDate !== undefined) data.requestDate = body.requestDate ? new Date(body.requestDate) : null;
            if (body.expectedEndDate !== undefined) data.expectedEndDate = body.expectedEndDate ? new Date(body.expectedEndDate) : null;
            if (body.completionDate !== undefined) data.completionDate = body.completionDate ? new Date(body.completionDate) : null;
            if (body.maintenanceJobs !== undefined) data.maintenanceJobs = body.maintenanceJobs;
            if (body.maintenance_jobs !== undefined) data.maintenanceJobs = body.maintenance_jobs;
            if (body.estimateApproval !== undefined) data.estimateApproval = body.estimateApproval;
            if (body.candidateGarageIds !== undefined) data.candidateGarageIds = body.candidateGarageIds;

            const updated = await tx.maintenanceRequest.update({
                where: { id: params.id },
                data,
                include: {
                    Vehicle: true,
                    Garage: true,
                    Driver: true,
                    quotations: true,
                    WorkOrder: true,
                    attachments: true,
                    comments: true,
                    histories: true,
                },
            });

            // ── Publish domain events via outbox (Phase D lifecycle) ──────────────
            const newStatus = (updated as any).status as string | undefined;
            const tenantId  = (updated as any).tenantId as string | null;
            if (tenantId && newStatus) {
                const req  = updated as any;
                const now  = new Date().toISOString();
                const base = {
                    requestId:  params.id,
                    vehicleId:  req.vehicleId       ?? '',
                    tenantId,
                    garageId:   req.garageId         ?? null,
                    garageName: req.Garage?.name      ?? null,
                };

                switch (newStatus) {
                    case 'APPROVED':
                        publishMaintenanceApproved(params.id, tenantId, {
                            ...base, approvedBy: req.approvedBy ?? null, approvedAt: now,
                        }).catch(err => console.warn('[maintenance] approved publish failed:', err));
                        break;

                    case 'REJECTED':
                        publishMaintenanceRejected(params.id, tenantId, {
                            ...base, rejectedBy: req.rejectedBy ?? null, rejectedAt: now,
                            reason: req.rejectionReason ?? null,
                        }).catch(err => console.warn('[maintenance] rejected publish failed:', err));
                        break;

                    case 'QUOTATION_REQUESTED':
                        publishQuotationRequested(params.id, tenantId, {
                            ...base, requestedAt: now,
                        }).catch(err => console.warn('[maintenance] quotation_requested publish failed:', err));
                        break;

                    case 'QUOTATION_RECEIVED': {
                        const qid = req.quotations?.[0]?.id ?? params.id;
                        publishQuotationReceived(qid, tenantId, {
                            ...base,
                            quotationId:  qid,
                            amount:       Number(req.estimatedCost ?? 0),
                            currency:     'AED',
                            receivedAt:   now,
                        }).catch(err => console.warn('[maintenance] quotation_received publish failed:', err));
                        break;
                    }

                    case 'ESTIMATION_APPROVED':
                        publishEstimationApproved(params.id, tenantId, {
                            ...base,
                            estimatedCost: Number(req.estimatedCost ?? 0),
                            currency:      'AED',
                            approvedBy:    req.approvedBy ?? null,
                            approvedAt:    now,
                        }).catch(err => console.warn('[maintenance] estimation_approved publish failed:', err));
                        break;

                    case 'WORK_ORDER_CREATED':
                        publishWorkOrderCreated(params.id, tenantId, {
                            ...base,
                            workOrderId:  req.WorkOrder?.id   ?? params.id,
                            workOrderNo:  req.workOrderNo      ?? null,
                            createdAt:    now,
                        }).catch(err => console.warn('[maintenance] work_order_created publish failed:', err));
                        break;

                    case 'IN_PROGRESS':
                        publishWorkOrderStarted(params.id, tenantId, {
                            ...base,
                            workOrderId: req.WorkOrder?.id ?? null,
                            startedAt:   now,
                        }).catch(err => console.warn('[maintenance] work_order_started publish failed:', err));
                        break;

                    case 'REPAIR_COMPLETED':
                        publishRepairCompleted(params.id, tenantId, {
                            requestId:     params.id,
                            vehicleId:     req.vehicleId       ?? '',
                            tenantId,
                            requestNumber: req.workOrderNo     ?? null,
                            garageId:      req.garageId        ?? null,
                            garageName:    req.Garage?.name    ?? null,
                            occurredAt:    now,
                        }).catch(err => console.warn('[maintenance] repair_completed publish failed:', err));
                        break;

                    // INVOICE_SUBMITTED → Finance (AP payable + JE) + Fleet (vehicle available)
                    case 'INVOICE_SUBMITTED':
                        publishWorkOrderCompleted(params.id, tenantId, {
                            requestId:          params.id,
                            vehicleId:          req.vehicleId          ?? '',
                            requestType:        req.maintenanceType     ?? 'SERVICE',
                            invoiceSubmittedAt: now,
                            totalCost:          Number(req.actualCost ?? req.estimatedCost ?? 0),
                            estimatedCost:      req.estimatedCost != null ? Number(req.estimatedCost) : null,
                            currency:           'AED',
                            garageId:           req.garageId            ?? null,
                            garageName:         req.Garage?.name         ?? null,
                            requestNumber:      req.workOrderNo          ?? null,
                            tenantId,
                        }).catch(err => console.warn('[maintenance] work_order_completed publish failed:', err));
                        break;

                    // CLOSED → audit trail, analytics
                    case 'CLOSED':
                        publishMaintenanceClosed(params.id, tenantId, {
                            requestId:     params.id,
                            vehicleId:     req.vehicleId          ?? '',
                            requestType:   req.maintenanceType     ?? 'SERVICE',
                            completedAt:   (req.completionDate ? new Date(req.completionDate).toISOString() : now),
                            totalCost:     Number(req.actualCost ?? req.estimatedCost ?? 0) || null,
                            currency:      'AED',
                            garageId:      req.garageId            ?? null,
                            garageName:    req.Garage?.name         ?? null,
                            requestNumber: req.workOrderNo          ?? null,
                        }).catch(err => console.warn('[maintenance] maintenance.completed publish failed:', err));
                        break;

                    default:
                        // No event for this status transition
                        break;
                }
            } else if (newStatus && ['APPROVED','REJECTED','QUOTATION_REQUESTED','QUOTATION_RECEIVED',
                                      'ESTIMATION_APPROVED','WORK_ORDER_CREATED','IN_PROGRESS',
                                      'REPAIR_COMPLETED','INVOICE_SUBMITTED','CLOSED'].includes(newStatus)) {
                console.warn(`[maintenance] outbox publish skipped: tenantId missing on MR ${params.id}`);
            }

            return NextResponse.json(JSON.parse(JSON.stringify(updated)));
        } catch (e) {
            console.error('Failed to update maintenance request:', e);
            return NextResponse.json({ error: 'Internal Server Error', details: String(e) }, { status: 500 });
        }
  });
}


export async function DELETE(request: Request, { params }: { params: { id: string } }) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            await tx.maintenanceRequest.update({
                where: { id: params.id },
                data: { deletedAt: new Date() },
            });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete maintenance request:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}

