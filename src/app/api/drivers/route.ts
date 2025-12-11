import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma'; // Use singleton instance

export async function GET() {
    try {
        const drivers = await prisma.driver.findMany({
            orderBy: { name: 'asc' },
            include: { assignedVehicle: true }
        });
        return NextResponse.json(drivers);
    } catch (error) {
        console.error('Failed to fetch drivers:', error);
        return NextResponse.json({ error: `Internal Server Error: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Basic validation
        if (!body.name || !body.licenseNumber) {
            return NextResponse.json({ error: 'Name and License Number are required' }, { status: 400 });
        }

        const newDriver = await prisma.driver.create({
            data: {
                name: body.name,
                licenseNumber: body.licenseNumber,
                licenseExpiry: new Date(body.licenseExpiry),
                contactNumber: body.contactNumber,
                email: body.email,
                // Optional fields
                firstName: body.firstName,
                lastName: body.lastName,
                hierarchy: body.hierarchy,
                driverType: body.driverType,
                nationality: body.nationality,
                dob: body.dob ? new Date(body.dob) : null,
                emiratesId: body.emiratesId,
                communicationLanguage: body.communicationLanguage,
                dateOfJoin: body.dateOfJoin ? new Date(body.dateOfJoin) : null,
                dallasId: body.dallasId,
            },
        });

        return NextResponse.json(newDriver, { status: 201 });
    } catch (error) {
        console.error('Failed to create driver:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
