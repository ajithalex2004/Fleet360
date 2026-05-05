import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
        const garage = await prisma.garage.findFirst({
            where: { id: params.id, deletedAt: null }
        });
        if (!garage) {
            return NextResponse.json({ error: 'Garage not found' }, { status: 404 });
        }
        return NextResponse.json(JSON.parse(JSON.stringify(garage)));
    } catch (error) {
        console.error('Failed to fetch garage:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
    try {
        const body = await request.json();

        const data: Record<string, unknown> = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.location !== undefined) data.location = body.location;
        if (body.contactPerson !== undefined) data.contactPerson = body.contactPerson;
        if (body.contact_person !== undefined) data.contactPerson = body.contact_person;
        if (body.designation !== undefined) data.designation = body.designation;
        if (body.email !== undefined) data.email = body.email;
        if (body.contactNumber !== undefined) data.contactNumber = body.contactNumber;
        if (body.contact_number !== undefined) data.contactNumber = body.contact_number;
        if (body.specialties !== undefined) data.specialties = body.specialties;
        if (body.isInternal !== undefined) data.isInternal = body.isInternal;
        if (body.is_internal !== undefined) data.isInternal = body.is_internal;

        const updated = await prisma.garage.update({
            where: { id: params.id },
            data,
        });

        return NextResponse.json(JSON.parse(JSON.stringify(updated)));
    } catch (error) {
        console.error('Failed to update garage:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    return PUT(request, { params });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        await prisma.garage.update({
            where: { id: params.id },
            data: { deletedAt: new Date() },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete garage:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
