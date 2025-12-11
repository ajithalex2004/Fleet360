import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
    try {
        const body = await request.json();
        const { id, ...updateData } = body; // Exclude ID from update data

        const updatedConfig = await prisma.alertConfig.update({
            where: { id: params.id },
            data: updateData,
        });
        return NextResponse.json(updatedConfig);
    } catch (error: any) {
        console.error('Failed to update alert config:', error);
        return NextResponse.json({
            error: 'Failed to update alert config',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        await prisma.alertConfig.delete({
            where: { id: params.id },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete alert config:', error);
        return NextResponse.json({ error: 'Failed to delete alert config' }, { status: 500 });
    }
}
