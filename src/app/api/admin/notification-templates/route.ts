
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const templates = await prisma.notificationTemplate.findMany();
        return NextResponse.json(templates);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const template = await prisma.notificationTemplate.create({
            data: {
                name: body.name,
                event: body.event,
                channel: body.channel,
                subject: body.subject,
                body: body.body,
                isActive: body.isActive,
            },
        });
        return NextResponse.json(template);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const template = await prisma.notificationTemplate.update({
            where: { id: body.id },
            data: {
                name: body.name,
                event: body.event,
                channel: body.channel,
                subject: body.subject,
                body: body.body,
                isActive: body.isActive,
            },
        });
        return NextResponse.json(template);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
    }
}
