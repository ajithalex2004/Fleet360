import { NextResponse } from 'next/server';
import { PrismaClient, ActionStatus } from '@prisma/client';

const prisma = new PrismaClient();
const BACKEND_BASE_URL = 'http://127.0.0.1:8080/api/alerts';

export async function GET() {
    try {
        const alerts = await prisma.alert.findMany({
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

        // Sanitize Payload for Backend
        let relatedId = "";
        if (body.vehicleId) relatedId = body.vehicleId;
        else if (body.driverId) relatedId = body.driverId;

        const backendPayload = {
            type: body.type,
            title: body.title,
            description: body.description,
            severity: body.severity,
            status: body.status || "PENDING",
            assignedTo: body.assignedTo,
            relatedEntityId: relatedId, // Map to Go model field
            dateCreated: new Date().toISOString() // Ensure date is set
        };

        const res = await fetch(BACKEND_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(backendPayload),
        });

        if (!res.ok) {
            const errorText = await res.text();
            let errorMessage = errorText;
            try {
                const jsonError = JSON.parse(errorText);
                if (jsonError.error) {
                    errorMessage = jsonError.error;
                }
            } catch (e) { /* ignore */ }
            return NextResponse.json({ error: errorMessage }, { status: res.status });
        }

        const newAlert = await res.json();
        return NextResponse.json(newAlert);
    } catch (error) {
        console.error('Failed to create alert:', error);
        return NextResponse.json({ error: 'Failed to create alert', details: String(error) }, { status: 500 });
    }
}
