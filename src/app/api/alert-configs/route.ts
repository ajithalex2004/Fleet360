import { NextResponse } from 'next/server';

const BACKEND_BASE_URL = 'http://127.0.0.1:8080/api/alert-configs';

export async function GET() {
    try {
        const res = await fetch(BACKEND_BASE_URL, { cache: 'no-store' });
        if (!res.ok) {
            throw new Error(`Backend responded with ${res.status}`);
        }
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Failed to fetch alert configs:', error);
        return NextResponse.json({ error: 'Failed to fetch alert configs', details: String(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Sanitize Payload: Ensure numeric fields are actually numbers for Go
        const sanitizedBody = {
            ...body,
            frequencyValue: parseInt(body.frequencyValue) || 0,
            thresholdValue: parseInt(body.thresholdValue) || 0,
        };

        // Proxy to Go Backend
        const res = await fetch(BACKEND_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(sanitizedBody),
        });

        if (!res.ok) {
            const errorText = await res.text();
            let errorMessage = errorText;
            try {
                const jsonError = JSON.parse(errorText);
                if (jsonError.error) {
                    errorMessage = jsonError.error;
                }
            } catch (e) {
                // Raw text
            }
            return NextResponse.json({ error: errorMessage }, { status: res.status });
        }

        const newConfig = await res.json();
        return NextResponse.json(newConfig, { status: 201 });
    } catch (error) {
        console.error('Failed to create alert config:', error);
        return NextResponse.json({ error: 'Failed to create alert config', details: String(error) }, { status: 500 });
    }
}
