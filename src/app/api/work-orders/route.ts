import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { WorkOrderStatus } from '@prisma/client';

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const newWorkOrder = await prisma.workOrder.create({
            data: {
                ...body,
                status: WorkOrderStatus.NOT_STARTED,
            },
        });

        return NextResponse.json(newWorkOrder);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create work order' }, { status: 500 });
    }
}
