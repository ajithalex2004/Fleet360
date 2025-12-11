import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
    try {
        const configs = await prisma.integrationConfig.findMany();
        return NextResponse.json(configs);
    } catch (error) {
        console.error('Failed to fetch integration configs:', error);
        return NextResponse.json({ error: 'Failed to fetch integration configs' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { type, ...data } = body;

        // Upsert based on Type (Email vs SMS vs WhatsApp)
        const config = await prisma.integrationConfig.upsert({
            where: { type },
            update: data,
            create: { type, ...data },
        });

        return NextResponse.json(config);
    } catch (error) {
        console.error('Failed to save integration config:', error);
        return NextResponse.json({ error: 'Failed to save integration config' }, { status: 500 });
    }
}
