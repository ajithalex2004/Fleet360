import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/maintenance/[id]/warranty-check
// Returns active warranties for the vehicle linked to this request.
// Useful to call when request reaches ESTIMATION_APPROVED.
export async function GET(
    _request: Request,
    { params }: { params: { id: string } },
) {
    try {
        const { id } = params;

        // Resolve the vehicleId from the request
        const req = await prisma.maintenanceRequest.findUnique({
            where:  { id },
            select: { vehicleId: true },
        });

        if (!req) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        const today = new Date();

        const warranties = req.vehicleId
            ? await prisma.vehicleWarranty.findMany({
                  where: {
                      vehicleId:  req.vehicleId,
                      isActive:   true,
                      startDate:  { lte: today },
                      expiryDate: { gte: today },
                  },
                  include: { claims: { orderBy: { createdAt: 'desc' }, take: 5 } },
                  orderBy: { expiryDate: 'asc' },
              })
            : [];

        const result = {
            hasActiveWarranty: warranties.length > 0,
            warranties: warranties.map((w) => ({
                ...w,
                coverageNote: w.coverageDescription
                    ?? `${w.warrantyType} warranty — expires ${w.expiryDate.toISOString().split('T')[0]}`,
            })),
        };

        return NextResponse.json(JSON.parse(JSON.stringify(result)));
    } catch (error) {
        console.error('Failed to check warranty:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
