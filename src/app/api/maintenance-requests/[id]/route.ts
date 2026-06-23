import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    ensureOperationalTenantColumn,
    recordOperationalChange,
    requireOperationalContext,
} from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

async function requestBelongsToTenant(id: string, tenantId: string) {
    await ensureOperationalTenantColumn('maintenance_requests');
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM maintenance_requests WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
        id,
        tenantId,
    ).catch(() => []);
    return rows.length > 0;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const ctx = requireOperationalContext(request, 'maintenance');
        if (ctx instanceof NextResponse) return ctx;
        if (!(await requestBelongsToTenant(params.id, ctx.tenantId))) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }
        const req = await prisma.maintenanceRequest.findFirst({
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
    } catch (error) {
        console.error('Failed to fetch maintenance request:', error);
        return NextResponse.json({ error: 'Failed to fetch request' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const ctx = requireOperationalContext(request, 'maintenance', { write: true });
        if (ctx instanceof NextResponse) return ctx;
        if (!(await requestBelongsToTenant(params.id, ctx.tenantId))) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }
        const body = await request.json();
        const before = await prisma.maintenanceRequest.findFirst({
            where: { id: params.id, deletedAt: null },
        });
        if (!before) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

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

        const updated = await prisma.maintenanceRequest.update({
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

        await recordOperationalChange({
            req: request,
            ctx,
            entityType: 'MaintenanceRequest',
            entityId: params.id,
            action: body.status !== undefined && body.status !== before.status ? 'STATUS_CHANGE' : 'UPDATE',
            before,
            after: updated,
            summary: `Updated maintenance request ${updated.workOrderNo ?? updated.id}`,
        });

        const workflowEvents = [];
        const estimateTouched =
            body.estimatedCost !== undefined
            || body.estimateApproval !== undefined
            || body.candidateGarageIds !== undefined;
        if (estimateTouched) {
            workflowEvents.push(await triggerServiceWorkflow({
                req: request,
                ctx,
                serviceTypeKey: 'MAINTENANCE_ESTIMATE_APPROVAL',
                referenceType: 'MaintenanceRequest',
                referenceId: updated.id,
                referenceNumber: updated.workOrderNo ?? updated.id,
                contextData: {
                    requestId: updated.id,
                    estimatedCost: updated.estimatedCost,
                    estimateApproval: updated.estimateApproval,
                    candidateGarageIds: updated.candidateGarageIds,
                },
            }));
        }

        const workOrderTouched =
            body.workOrderNo !== undefined
            || body.work_order_no !== undefined
            || body.maintenanceJobs !== undefined
            || body.maintenance_jobs !== undefined;
        if (workOrderTouched) {
            workflowEvents.push(await triggerServiceWorkflow({
                req: request,
                ctx,
                serviceTypeKey: 'MAINTENANCE_WORK_ORDER',
                referenceType: 'MaintenanceRequest',
                referenceId: updated.id,
                referenceNumber: updated.workOrderNo ?? updated.id,
                contextData: {
                    requestId: updated.id,
                    workOrderNo: updated.workOrderNo,
                    maintenanceJobs: updated.maintenanceJobs,
                },
            }));
        }

        const vendorTouched = body.garageId !== undefined || body.garage_id !== undefined;
        if (vendorTouched) {
            workflowEvents.push(await triggerServiceWorkflow({
                req: request,
                ctx,
                serviceTypeKey: 'MAINTENANCE_VENDOR_ASSIGNMENT',
                referenceType: 'MaintenanceRequest',
                referenceId: updated.id,
                referenceNumber: updated.workOrderNo ?? updated.id,
                contextData: {
                    requestId: updated.id,
                    garageId: updated.garageId,
                    candidateGarageIds: updated.candidateGarageIds,
                },
            }));
        }

        const completed =
            (body.status !== undefined && String(body.status).toLowerCase() === 'completed')
            || body.completionDate !== undefined;
        if (completed) {
            workflowEvents.push(await triggerServiceWorkflow({
                req: request,
                ctx,
                serviceTypeKey: 'MAINTENANCE_COMPLETION_REVIEW',
                referenceType: 'MaintenanceRequest',
                referenceId: updated.id,
                referenceNumber: updated.workOrderNo ?? updated.id,
                contextData: {
                    requestId: updated.id,
                    status: updated.status,
                    completionDate: updated.completionDate,
                    actualCost: updated.actualCost,
                },
            }));
        }

        return NextResponse.json(JSON.parse(JSON.stringify({ ...updated, workflowEvents })));
    } catch (error) {
        console.error('Failed to update maintenance request:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const ctx = requireOperationalContext(request, 'maintenance', { write: true });
        if (ctx instanceof NextResponse) return ctx;
        if (!(await requestBelongsToTenant(params.id, ctx.tenantId))) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }
        const before = await prisma.maintenanceRequest.findFirst({ where: { id: params.id, deletedAt: null } });
        const updated = await prisma.maintenanceRequest.update({
            where: { id: params.id },
            data: { deletedAt: new Date() },
        });
        await recordOperationalChange({
            req: request,
            ctx,
            entityType: 'MaintenanceRequest',
            entityId: params.id,
            action: 'DELETE',
            before,
            after: updated,
            summary: `Deleted maintenance request ${updated.workOrderNo ?? updated.id}`,
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete maintenance request:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
