
import { NextResponse } from 'next/server';
import { processNotificationRules } from '@/lib/notifications';

const BACKEND_URL = 'http://127.0.0.1:8080/api/service-requests';

export async function GET() {
    try {
        const res = await fetch(BACKEND_URL, { cache: 'no-store' });
        if (!res.ok) {
            return NextResponse.json({ error: 'Failed to fetch' }, { status: res.status });
        }
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Proxy Error GET /service-requests:', error);
        return NextResponse.json({ error: `Internal Server Error: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const res = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorData = await res.text();
            return NextResponse.json({ error: errorData }, { status: res.status });
        }

        const data = await res.json();

        // Trigger Notification in background
        if (data && data.id) {
            // Map data for template
            const templateData = {
                requestId: data.id,
                status: data.status || 'Open',
                assignee: data.assignee || 'Unassigned',
                description: data.description || '',
                vehicle: data.vehicle?.licensePlate || 'Unknown',
            };

            // Fire and forget - DO NOT await to avoid blocking UI
            processNotificationRules('SR_CREATED', templateData, data.assignee).catch(err => {
                console.error('Background Notification Failed:', err);
            });
        }

        return NextResponse.json(data, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
