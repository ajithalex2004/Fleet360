import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
    try {
        const logs = await prisma.notificationLog.findMany({
            orderBy: {
                sentAt: 'desc',
            },
        });
        return NextResponse.json(logs);
    } catch (error) {
        console.error('Failed to fetch notification logs:', error);
        return NextResponse.json({ error: 'Failed to fetch notification logs' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            recipient,
            type,
            subject,
            body: messageBody,
            status,
            triggerReason,
        } = body;

        const newLog = await prisma.notificationLog.create({
            data: {
                recipient,
                type,
                subject,
                body: messageBody,
                status: status || 'Pending',
                triggerReason,
            }
        });
        return NextResponse.json(newLog);
    } catch (error) {
        console.error('Failed to create notification log:', error);
        return NextResponse.json({ error: 'Failed to create notification log' }, { status: 500 });
    }
}
