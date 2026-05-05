import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const garages = await prisma.garage.findMany({
            where: { deletedAt: null },
            orderBy: { name: 'asc' }
        });
        return NextResponse.json(JSON.parse(JSON.stringify(garages)));
    } catch (error) {
        console.error('Failed to fetch garages:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const garage = await prisma.garage.create({
            data: {
                name: body.name,
                location: body.location,
                contactPerson: body.contactPerson || body.contact_person,
                designation: body.designation,
                email: body.email,
                contactNumber: body.contactNumber || body.contact_number,
                specialties: body.specialties || [],
                isInternal: body.isInternal ?? body.is_internal ?? false,
            }
        });

        return NextResponse.json(JSON.parse(JSON.stringify(garage)), { status: 201 });
    } catch (error) {
        console.error('Failed to create garage:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
