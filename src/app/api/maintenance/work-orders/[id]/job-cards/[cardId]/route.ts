import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// PUT /api/maintenance/work-orders/[id]/job-cards/[cardId]
// Updates a job card (status, hours, technician, tasks).
// Body: { title?, description?, technicianId?, technicianName?, status?, actualHours?,
//         tasksToAdd?: string[], tasksToToggle?: { id: string; completed: boolean }[] }
export async function PUT(
    request: NextRequest,
    props: { params: Promise<{ id: string; cardId: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { cardId } = params;
            const body = await request.json();

            // Toggle task completion if requested
            if (body.tasksToToggle?.length) {
                await Promise.all(
                    (body.tasksToToggle as { id: string; completed: boolean }[]).map(
                        (t) =>
                            tx.jobTask.update({
                                where: { id: t.id },
                                data: {
                                    completed:   t.completed,
                                    completedAt: t.completed ? new Date() : null,
                                    completedBy: t.completed ? (body.completedBy ?? null) : null,
                                },
                            }),
                    ),
                );
            }

            // Add new tasks if provided
            if (body.tasksToAdd?.length) {
                await tx.jobTask.createMany({
                    data: (body.tasksToAdd as string[]).map((desc: string) => ({
                        jobCardId:   cardId,
                        description: desc,
                    })),
                });
            }

            // Update the card itself
            const card = await tx.jobCard.update({
                where: { id: cardId },
                data: {
                    ...(body.title          != null && { title:          body.title }),
                    ...(body.description    != null && { description:    body.description }),
                    ...(body.technicianId   != null && { technicianId:   body.technicianId }),
                    ...(body.technicianName != null && { technicianName: body.technicianName }),
                    ...(body.status         != null && { status:         body.status }),
                    ...(body.actualHours    != null && { actualHours:    body.actualHours }),
                    ...(body.estimatedHours != null && { estimatedHours: body.estimatedHours }),
                },
                include: { tasks: { orderBy: { createdAt: 'asc' } } },
            });

            return NextResponse.json(JSON.parse(JSON.stringify(card)));
        } catch (e) {
            console.error('Failed to update job card:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}


// DELETE /api/maintenance/work-orders/[id]/job-cards/[cardId]
export async function DELETE(
    _request: NextRequest,
    props: { params: Promise<{ id: string; cardId: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: _request.headers, nextUrl: _request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { cardId } = params;
            await tx.jobCard.delete({ where: { id: cardId } });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete job card:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

