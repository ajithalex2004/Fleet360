import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const requests = await prisma.maintenanceRequest.findMany({
            where: { deletedAt: null },
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

export async function POST(request: Request) {
    try {
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

        return NextResponse.json(JSON.parse(JSON.stringify(req)), { status: 201 });
    } catch (error) {
        console.error('Failed to create maintenance request:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}
