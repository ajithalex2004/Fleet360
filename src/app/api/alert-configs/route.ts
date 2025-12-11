import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
    try {
        const configs = await prisma.alertConfig.findMany();
        return NextResponse.json(configs);
    } catch (error) {
        console.error('Failed to fetch alert configs:', error);
        return NextResponse.json({ error: 'Failed to fetch alert configs' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            alertFor,
            alertType,
            frequency,
            frequencyValue,
            thresholdValue,
            notificationEnabled,
            emailEnabled,
            smsEnabled,
            whatsappEnabled,
            notificationEmail,
            assignedIds,
            // remove id if present to let DB generate it
            id,
            ...other
        } = body;

        const newConfig = await prisma.alertConfig.create({
            data: {
                alertFor,
                alertType,
                frequency,
                frequencyValue,
                thresholdValue,
                notificationEnabled,
                emailEnabled: emailEnabled ?? true, // Default to true if missing
                smsEnabled: smsEnabled ?? false,
                whatsappEnabled: whatsappEnabled ?? false,
                notificationEmail,
                assignedIds,
            }
        });
        return NextResponse.json(newConfig);
    } catch (error) {
        console.error('Failed to create alert config:', error);
        return NextResponse.json({ error: 'Failed to create alert config' }, { status: 500 });
    }
}
