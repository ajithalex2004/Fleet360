import { NextResponse } from 'next/server';

const BACKEND_BASE_url = 'http://127.0.0.1:8080/api/garages';

export async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
        const res = await fetch(`${BACKEND_BASE_url}/${params.id}`, { cache: 'no-store' });
        if (!res.ok) {
            return NextResponse.json({ error: 'Garage not found' }, { status: res.status });
        }
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
    try {
        const body = await request.json();
        const res = await fetch(`${BACKEND_BASE_url}/${params.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorData = await res.text();
            return NextResponse.json({ error: errorData }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        const res = await fetch(`${BACKEND_BASE_url}/${params.id}`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            const errorData = await res.text();
            return NextResponse.json({ error: errorData }, { status: res.status });
        }

        return NextResponse.json({ message: 'Garage deleted' });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
