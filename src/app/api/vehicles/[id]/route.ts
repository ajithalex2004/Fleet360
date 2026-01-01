import { NextResponse } from 'next/server';

const BACKEND_BASE_URL = 'http://127.0.0.1:8080/api/vehicles';

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const id = params.id;
        const res = await fetch(`${BACKEND_BASE_URL}/${id}`);
        if (!res.ok) {
            if (res.status === 404) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
            const error = await res.text();
            return NextResponse.json({ error }, { status: res.status });
        }
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const id = params.id;
        const body = await request.json();

        // No need to convert dates manually, standard JSON string is fine for backend
        const res = await fetch(`${BACKEND_BASE_URL}/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            let error = await res.text();
            try {
                const jsonError = JSON.parse(error);
                if (jsonError.error) {
                    error = jsonError.error;
                }
            } catch (e) {
                // Keep raw text
            }
            return NextResponse.json({ error }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const id = params.id;
        const res = await fetch(`${BACKEND_BASE_URL}/${id}`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            let error = await res.text();
            try {
                // Try to parse as JSON to avoid double quoting
                const jsonError = JSON.parse(error);
                if (jsonError.error) {
                    error = jsonError.error;
                }
            } catch (e) {
                // Keep raw text if not JSON
            }
            return NextResponse.json({ error }, { status: res.status });
        }

        return NextResponse.json({ message: 'Vehicle deleted' });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
