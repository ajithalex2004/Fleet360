export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// GET /api/maintenance/work-orders/[id]/job-cards
// Returns all job cards (with tasks) for the given work order.
export async function GET(
    _request: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: _request.headers, nextUrl: _request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { id } = params;

            // JobCard has no tenantId column of its own — it is scoped
            // through its WorkOrder relation, which does carry tenantId.
            const cards = await tx.jobCard.findMany({
                where:   { workOrderId: id, WorkOrder: { tenantId } },
                include: { tasks: { orderBy: { createdAt: 'asc' } } },
                orderBy: { createdAt: 'asc' },
            });

            return NextResponse.json(JSON.parse(JSON.stringify(cards)));
        } catch (e) {
            console.error('Failed to fetch job cards:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}


// POST /api/maintenance/work-orders/[id]/job-cards
// Creates a new job card (optionally with initial tasks).
// Body: { title, description?, technicianId?, technicianName?, estimatedHours?, tasks?: string[] }
export async function POST(
    request: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { id } = params;
            const body = await request.json();

            // Real bug: nothing previously verified that the work order
            // named in the URL belongs to this tenant before attaching a
            // job card to it — a caller who knew another tenant's work
            // order id could write a job card onto it.
            const workOrder = await tx.workOrder.findFirst({ where: { id, tenantId } });
            if (!workOrder) {
                return NextResponse.json(
                    { error: 'Work order not found' },
                    { status: 404 },
                );
            }

            const card = await tx.jobCard.create({
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
        } catch (e) {
            console.error('Failed to create job card:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

