import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { QuotationStatus } from '@prisma/client';

export async function POST(request: Request) {
    console.log('API /api/quotations hit - Proxying to Backend');
    try {
        const body = await request.json();
        const res = await fetch('http://127.0.0.1:8080/api/quotations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Backend quotation creation failed. Status: ${res.status}, Body: ${errorText}`);
            return NextResponse.json(
                { error: 'Failed to create quotation', backendStatus: res.status, backendError: errorText },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Proxy error creating quotation:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}
