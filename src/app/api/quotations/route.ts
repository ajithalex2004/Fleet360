import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const quotations = await prisma.quotation.findMany({
            where: { deletedAt: null },
            include: {
                MaintenanceRequest: true,
                Garage: true,
                quotationLabors: true,
                quotationParts: true,
                attachments: true,
            },
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(JSON.parse(JSON.stringify(quotations)));
    } catch (error) {
        console.error('Failed to fetch quotations:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const quotation = await prisma.quotation.create({
            data: {
                maintenanceRequestId: body.maintenanceRequestId || body.maintenance_request_id,
                garageId: body.garageId || body.garage_id,
                status: body.status || 'PENDING',
                quotationDate: body.quotationDate ? new Date(body.quotationDate) : new Date(),
                validUntil: body.validUntil ? new Date(body.validUntil) : null,
                laborCost: body.laborCost ?? null,
                partsCost: body.partsCost ?? null,
                consumablesCost: body.consumablesCost ?? null,
                vatAmount: body.vatAmount ?? null,
                totalCost: body.totalCost ?? null,
                grandTotal: body.grandTotal ?? null,
                currency: body.currency || 'AED',
                estimatedDuration: body.estimatedDuration ? BigInt(body.estimatedDuration) : null,
                estimatedCompletionDate: body.estimatedCompletionDate ? new Date(body.estimatedCompletionDate) : null,
                submittedBy: body.submittedBy || body.submitted_by,
                notes: body.notes,
            }
        });

        return NextResponse.json(JSON.parse(JSON.stringify(quotation)), { status: 201 });
    } catch (error) {
        console.error('Failed to create quotation:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}
