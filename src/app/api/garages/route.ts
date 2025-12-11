import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://127.0.0.1:8080/api/garages';

export async function GET() {
    try {
        const res = await fetch(BACKEND_URL, { cache: 'no-store' });
        if (!res.ok) {
            return NextResponse.json({ error: 'Failed to fetch garages' }, { status: res.status });
        }
        const data = await res.json();
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        });
    } catch (error) {
        console.error("PROXY ERROR:", error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
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
