import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processNotificationRules } from '@/lib/notifications';

export async function GET() {
    try {
        const requests = await prisma.serviceRequest.findMany({
            where: { deletedAt: null },
            include: {
                attachments: true,
                histories: true,
            },
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(JSON.parse(JSON.stringify(requests)));
    } catch (error) {
        console.error('Proxy Error GET /service-requests:', error);
        return NextResponse.json({ error: `Internal Server Error: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const data = await prisma.serviceRequest.create({
            data: {
                requestorId: body.requestorId || body.requestor_id,
                serviceType: body.serviceType || body.service_type,
                vehicleId: body.vehicleId || body.vehicle_id,
                priority: body.priority,
                description: body.description,
                date: body.date ? new Date(body.date) : new Date(),
                status: body.status || 'Open',
                maintenanceRequestId: body.maintenanceRequestId || body.maintenance_request_id,
                assignedTo: body.assignedTo || body.assigned_to,
                relatedDriverId: body.relatedDriverId || body.related_driver_id,
            }
        });

        // Trigger notification in background
        if (data && data.id) {
            const templateData = {
                requestId: data.id,
                status: data.status || 'Open',
                assignee: data.assignedTo || 'Unassigned',
                description: data.description || '',
                vehicle: data.vehicleId || 'Unknown',
            };

            // Fire and forget - DO NOT await to avoid blocking UI
            processNotificationRules('SR_CREATED', templateData, data.assignedTo ?? undefined).catch(err => {
                console.error('Background Notification Failed:', err);
            });
        }

        return NextResponse.json(JSON.parse(JSON.stringify(data)), { status: 201 });
    } catch (error) {
        console.error('Failed to create service request:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
