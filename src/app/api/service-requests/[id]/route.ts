import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const serviceRequest = await prisma.serviceRequest.findFirst({
            where: { id: params.id, deletedAt: null },
            include: {
                attachments: true,
                histories: true,
            },
        });

        if (!serviceRequest) {
            return NextResponse.json({ error: 'Service request not found' }, { status: 404 });
        }

        return NextResponse.json(JSON.parse(JSON.stringify(serviceRequest)));
    } catch (error) {
        console.error('Failed to fetch service request:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const body = await request.json();

        const data: Record<string, unknown> = {};
        if (body.requestorId !== undefined) data.requestorId = body.requestorId;
        if (body.requestor_id !== undefined) data.requestorId = body.requestor_id;
        if (body.serviceType !== undefined) data.serviceType = body.serviceType;
        if (body.service_type !== undefined) data.serviceType = body.service_type;
        if (body.vehicleId !== undefined) data.vehicleId = body.vehicleId;
        if (body.vehicle_id !== undefined) data.vehicleId = body.vehicle_id;
        if (body.priority !== undefined) data.priority = body.priority;
        if (body.description !== undefined) data.description = body.description;
        if (body.date !== undefined) data.date = body.date ? new Date(body.date) : null;
        if (body.status !== undefined) data.status = body.status;
        if (body.maintenanceRequestId !== undefined) data.maintenanceRequestId = body.maintenanceRequestId;
        if (body.maintenance_request_id !== undefined) data.maintenanceRequestId = body.maintenance_request_id;
        if (body.assignedTo !== undefined) data.assignedTo = body.assignedTo;
        if (body.assigned_to !== undefined) data.assignedTo = body.assigned_to;
        if (body.relatedDriverId !== undefined) data.relatedDriverId = body.relatedDriverId;
        if (body.related_driver_id !== undefined) data.relatedDriverId = body.related_driver_id;

        const updated = await prisma.serviceRequest.update({
            where: { id: params.id },
            data,
        });

        return NextResponse.json(JSON.parse(JSON.stringify(updated)));
    } catch (error) {
        console.error('Failed to update service request:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        await prisma.serviceRequest.update({
            where: { id: params.id },
            data: { deletedAt: new Date() },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete service request:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
