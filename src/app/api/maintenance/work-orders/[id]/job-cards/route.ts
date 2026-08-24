import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
// GET /api/maintenance/work-orders/[id]/job-cards
// Returns all job cards (with tasks) for the given work order.
export async function GET(
    _request: Request,
    { params }: { params: { id: string } },
) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const { id } = params;

        const cards = await prisma.jobCard.findMany({
            where:   { workOrderId: id },
            include: { tasks: { orderBy: { createdAt: 'asc' } } },
            orderBy: { createdAt: 'asc' },
        });

        return NextResponse.json(JSON.parse(JSON.stringify(cards)));
    } catch (error) {
        console.error('Failed to fetch job cards:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}

// POST /api/maintenance/work-orders/[id]/job-cards
// Creates a new job card (optionally with initial tasks).
// Body: { title, description?, technicianId?, technicianName?, estimatedHours?, tasks?: string[] }
export async function POST(
    request: Request,
    { params }: { params: { id: string } },
) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const { id } = params;
        const body = await request.json();

        const card = await prisma.jobCard.create({
            data: {
                workOrderId:    id,
                title:          body.title,
                description:    body.description    ?? null,
                technicianId:   body.technicianId   ?? null,
                technicianName: body.technicianName ?? null,
                status:         body.status         ?? 'PENDING',
                estimatedHours: body.estimatedHours ?? null,
                tasks: {
                    create: ((body.tasks ?? []) as string[]).map((desc: string) => ({
                        description: desc,
                    })),
                },
            },
            include: { tasks: true },
        });

        return NextResponse.json(
            JSON.parse(JSON.stringify(card)),
            { status: 201 },
        );
    } catch (error) {
        console.error('Failed to create job card:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
