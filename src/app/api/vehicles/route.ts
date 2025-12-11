import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma'; // Use singleton instance

export async function GET() {
    try {
        const vehicles = await prisma.vehicle.findMany({
            orderBy: { licensePlate: 'asc' }
        });
        return NextResponse.json(vehicles);
    } catch (error) {
        console.error('Failed to fetch vehicles:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const newVehicle = await prisma.vehicle.create({
            data: {
                make: body.make,
                model: body.model,
                year: parseInt(body.year),
                licensePlate: body.licensePlate,
                vin: body.vin,
                color: body.color,
                status: body.status || 'Active',
                fuelType: body.fuelType,
                department: body.department,
                currentOdometer: parseInt(body.currentOdometer),
                registrationExpiry: body.registrationExpiry ? new Date(body.registrationExpiry) : null,
                insuranceExpiry: body.insuranceExpiry ? new Date(body.insuranceExpiry) : null,
                assignedDriverId: body.assignedDriverId,
            }
        });
        return NextResponse.json(newVehicle, { status: 201 });
    } catch (error) {
        console.error('Failed to create vehicle:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
