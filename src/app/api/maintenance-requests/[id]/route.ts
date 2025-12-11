import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
        const res = await fetch(`http://127.0.0.1:8080/api/maintenance-requests/${params.id}`);

        if (!res.ok) {
            if (res.status === 404) {
                return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            }
            const errorText = await res.text();
            console.error(`Backend fetch failed. Status: ${res.status}, Body: ${errorText}`);
            return NextResponse.json(
                { error: 'Failed to fetch request', backendStatus: res.status, backendError: errorText },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Proxy error fetching request:', error);
        return NextResponse.json({ error: 'Failed to fetch request' }, { status: 500 });
    }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    try {
        const body = await request.json();
        const res = await fetch(`http://127.0.0.1:8080/api/maintenance-requests/${params.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Backend update failed. Status: ${res.status}, Body: ${errorText}`);
            return NextResponse.json(
                { error: 'Failed to update request', backendStatus: res.status, backendError: errorText },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Proxy error updating request:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}
