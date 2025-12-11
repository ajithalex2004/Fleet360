import { NextResponse } from 'next/server';
import { PrismaClient, ActionStatus } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
    try {
        const alerts = await prisma.alert.findMany({
            // Return all alerts (Frontend will filter active vs history)
            orderBy: {
                dateCreated: 'desc'
            }
        });
        return NextResponse.json(alerts);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Destructure to sanitize and avoid "Unknown arg" errors
        const {
            type,
            title,
            description,
            severity,
            status,
            assignedTo,
            vehicleId,
            driverId,
            relatedEntityId // Ignore this old field
        } = body;

        // If relatedEntityId is sent but no specific ID, try to map based on type (best effort backward compat)
        // detailed mapping logic would be here, but for now we rely on explicit vehicleId/driverId from frontend

        const newAlert = await prisma.alert.create({
            data: {
                type,
                title,
                description,
                severity,
                status: status || ActionStatus.PENDING,
                assignedTo,
                vehicleId,
                driverId,
            }
        });
        return NextResponse.json(newAlert);
    } catch (error) {
        console.error('Failed to create alert:', error);
        return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
    }
}
