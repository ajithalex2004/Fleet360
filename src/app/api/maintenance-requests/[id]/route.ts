import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
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

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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

        return NextResponse.json(JSON.parse(JSON.stringify(updated)));
    } catch (error) {
        console.error('Failed to update maintenance request:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        await prisma.maintenanceRequest.update({
            where: { id: params.id },
            data: { deletedAt: new Date() },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete maintenance request:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
