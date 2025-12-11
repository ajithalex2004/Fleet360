import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://127.0.0.1:8080/api/maintenance-requests';

export async function GET() {
    try {
        const res = await fetch(BACKEND_URL, { cache: 'no-store' });
        if (!res.ok) {
            return NextResponse.json({ error: 'Failed to fetch maintenance requests' }, { status: res.status });
        }
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.warn('Backend proxy failed, using mock data:', error);
        // Fail-safe mock response
        const mockRequests = [
            {
                id: 'MR-MOCK-001',
                status: 'Open',
                priority: 'Medium',
                description: 'Mock Maintenance Request (Backend Offline)',
                dateCreated: new Date().toISOString(),
                vehicle: { id: 'V-001', plateNumber: 'DXB-1234' },
                garage: { id: 'G-001', name: 'Al Quoz Garage' },
                issueSettings: []
            }
        ];
        return NextResponse.json(mockRequests);
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
        return NextResponse.json(data, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
