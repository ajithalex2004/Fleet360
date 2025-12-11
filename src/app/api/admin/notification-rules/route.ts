
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const rules = await prisma.notificationRule.findMany({
            include: {
                template: true,
            },
        });
        return NextResponse.json(rules);
    } catch (error: any) {
        console.error('Error fetching rules:', error);
        return NextResponse.json({ error: `Failed to fetch rules: ${error.message}` }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const rule = await prisma.notificationRule.create({
            data: {
                event: body.event,
                channels: body.channels,
                recipientTypes: body.recipientTypes,
                specificRecipientIds: body.specificRecipientIds,
                templateId: body.templateId,
                isEnabled: body.isEnabled,
            },
            include: {
                template: true,
            },
        });
        return NextResponse.json(rule);
    } catch (error: any) {
        console.error('Error creating rule:', error);
        return NextResponse.json({ error: `Failed to create rule: ${error.message}` }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const rule = await prisma.notificationRule.update({
            where: { id: body.id },
            data: {
                event: body.event,
                channels: body.channels,
                recipientTypes: body.recipientTypes,
                specificRecipientIds: body.specificRecipientIds,
                templateId: body.templateId,
                isEnabled: body.isEnabled,
            },
            include: {
                template: true,
            },
        });
        return NextResponse.json(rule);
    } catch (error: any) {
        console.error('Error updating rule:', error);
        return NextResponse.json({ error: `Failed to update rule: ${error.message}` }, { status: 500 });
    }
}
