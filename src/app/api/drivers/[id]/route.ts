import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
        const driver = await prisma.driver.findUnique({
            where: { id: params.id },
            include: { assignedVehicle: true },
        });
        if (!driver) return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
        return NextResponse.json(driver);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch driver' }, { status: 500 });
    }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    console.log(`[DRIVER_UPDATE] Updating driver ${params.id}`);
    try {
        const body = await request.json();

        // Destructure and sanitize
        const {
            fullName, // Exclude this
            id, // Exclude this from update data
            // Date fields needing conversion
            licenseExpiry,
            dob,
            dateOfJoin,
            // Direct pass-through fields
            name,
            licenseNumber,
            contactNumber,
            email,
            firstName,
            lastName,
            hierarchy,
            driverType,
            nationality,
            emiratesId,
            communicationLanguage,
            dallasId,
        } = body;

        const updateData: any = {
            name,
            licenseNumber,
            contactNumber,
            email,
            firstName,
            lastName,
            hierarchy,
            driverType,
            nationality,
            emiratesId,
            communicationLanguage,
            dallasId,
        };

        // Handle Dates
        if (licenseExpiry) updateData.licenseExpiry = new Date(licenseExpiry);
        if (dob) updateData.dob = new Date(dob);
        if (dateOfJoin) updateData.dateOfJoin = new Date(dateOfJoin);

        const updatedDriver = await prisma.driver.update({
            where: { id: params.id },
            data: updateData,
        });
        return NextResponse.json(updatedDriver);
    } catch (error) {
        console.error('[DRIVER_UPDATE] Error:', error);
        return NextResponse.json({ error: 'Failed to update driver' }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    console.log(`[DRIVER_DELETE] Deleting driver ${params.id}`);
    try {
        await prisma.driver.delete({
            where: { id: params.id },
        });
        return NextResponse.json({ message: 'Driver deleted' });
    } catch (error) {
        console.error('[DRIVER_DELETE] Error:', error);
        return NextResponse.json({ error: 'Failed to delete driver' }, { status: 500 });
    }
}
