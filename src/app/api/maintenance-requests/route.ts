import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    attachTenantToEntity,
    ensureOperationalTenantColumn,
    recordOperationalChange,
    requireOperationalContext,
    tenantScopedIds,
} from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

export async function GET(request: NextRequest) {
    try {
        const ctx = requireOperationalContext(request, 'maintenance', { requestedTenantId: request.nextUrl.searchParams.get('tenantId') });
        if (ctx instanceof NextResponse) return ctx;
        await ensureOperationalTenantColumn('maintenance_requests');
        const ids = await tenantScopedIds('maintenance_requests', ctx.tenantId, { activeOnly: true });
        if (ids.length === 0) return NextResponse.json([]);

        const requests = await prisma.maintenanceRequest.findMany({
            where: { id: { in: ids }, deletedAt: null },
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
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(JSON.parse(JSON.stringify(requests)));
    } catch (error) {
        console.error('Failed to fetch maintenance requests:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const ctx = requireOperationalContext(request, 'maintenance', { write: true });
        if (ctx instanceof NextResponse) return ctx;
        await ensureOperationalTenantColumn('maintenance_requests');
        const body = await request.json();

        const req = await prisma.maintenanceRequest.create({
            data: {
                vehicleId: body.vehicleId || body.vehicle_id,
                driverId: body.driverId || body.driver_id,
                description: body.description,
                status: body.status || 'Open',
                priority: body.priority || 'Medium',
                maintenanceType: body.maintenanceType || body.maintenance_type,
                workOrderNo: body.workOrderNo || body.work_order_no,
                odometer: body.odometer ? BigInt(body.odometer) : null,
                garageId: body.garageId || body.garage_id,
                estimatedCost: body.estimatedCost,
                requestDate: body.requestDate ? new Date(body.requestDate) : new Date(),
                expectedEndDate: body.expectedEndDate ? new Date(body.expectedEndDate) : null,
                maintenanceJobs: body.maintenanceJobs || body.maintenance_jobs || [],
            }
        });
        await attachTenantToEntity('maintenance_requests', req.id, ctx.tenantId);
        await recordOperationalChange({
            req: request,
            ctx,
            entityType: 'MaintenanceRequest',
            entityId: req.id,
            action: 'CREATE',
            after: req,
            summary: `Created maintenance request ${req.id}`,
        });

        const workflow = await triggerServiceWorkflow({
            req: request,
            ctx,
            serviceTypeKey: 'MAINTENANCE_REQUEST_APPROVAL',
            referenceType: 'MaintenanceRequest',
            referenceId: req.id,
            referenceNumber: req.workOrderNo ?? req.id,
            contextData: {
                requestId: req.id,
                vehicleId: req.vehicleId,
                driverId: req.driverId,
                maintenanceType: req.maintenanceType,
                priority: req.priority,
                estimatedCost: req.estimatedCost,
            },
        });

        return NextResponse.json(JSON.parse(JSON.stringify({ ...req, workflow })), { status: 201 });
    } catch (error) {
        console.error('Failed to create maintenance request:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}
