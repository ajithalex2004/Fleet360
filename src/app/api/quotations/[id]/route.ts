import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const quotation = await prisma.quotation.findFirst({
            where: { id, deletedAt: null },
            include: {
                MaintenanceRequest: true,
                Garage: true,
                quotationLabors: true,
                quotationParts: true,
                attachments: true,
            },
        });

        if (!quotation) {
            return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
        }

        return NextResponse.json(JSON.parse(JSON.stringify(quotation)));
    } catch (error) {
        console.error('Failed to fetch quotation:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const body = await request.json();

        const data: Record<string, unknown> = {};
        if (body.status !== undefined) data.status = body.status;
        if (body.garageId !== undefined) data.garageId = body.garageId;
        if (body.garage_id !== undefined) data.garageId = body.garage_id;
        if (body.maintenanceRequestId !== undefined) data.maintenanceRequestId = body.maintenanceRequestId;
        if (body.maintenance_request_id !== undefined) data.maintenanceRequestId = body.maintenance_request_id;
        if (body.quotationDate !== undefined) data.quotationDate = body.quotationDate ? new Date(body.quotationDate) : null;
        if (body.validUntil !== undefined) data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
        if (body.laborCost !== undefined) data.laborCost = body.laborCost;
        if (body.partsCost !== undefined) data.partsCost = body.partsCost;
        if (body.consumablesCost !== undefined) data.consumablesCost = body.consumablesCost;
        if (body.vatAmount !== undefined) data.vatAmount = body.vatAmount;
        if (body.totalCost !== undefined) data.totalCost = body.totalCost;
        if (body.grandTotal !== undefined) data.grandTotal = body.grandTotal;
        if (body.currency !== undefined) data.currency = body.currency;
        if (body.estimatedDuration !== undefined) data.estimatedDuration = body.estimatedDuration ? BigInt(body.estimatedDuration) : null;
        if (body.estimatedCompletionDate !== undefined) data.estimatedCompletionDate = body.estimatedCompletionDate ? new Date(body.estimatedCompletionDate) : null;
        if (body.submittedBy !== undefined) data.submittedBy = body.submittedBy;
        if (body.submitted_by !== undefined) data.submittedBy = body.submitted_by;
        if (body.notes !== undefined) data.notes = body.notes;

        const updated = await prisma.quotation.update({
            where: { id },
            data,
            include: {
                MaintenanceRequest: true,
                Garage: true,
                quotationLabors: true,
                quotationParts: true,
                attachments: true,
            },
        });

        return NextResponse.json(JSON.parse(JSON.stringify(updated)));
    } catch (error) {
        console.error('Failed to update quotation:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return PUT(request, { params });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        await prisma.quotation.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete quotation:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
