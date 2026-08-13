import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// PUT /api/maintenance/work-orders/[id]/job-cards/[cardId]
// Updates a job card (status, hours, technician, tasks).
// Body: { title?, description?, technicianId?, technicianName?, status?, actualHours?,
//         tasksToAdd?: string[], tasksToToggle?: { id: string; completed: boolean }[] }
export async function PUT(
    request: Request,
    { params }: { params: { id: string; cardId: string } },
) {
    try {
        const { cardId } = params;
        const body = await request.json();

        // Toggle task completion if requested
        if (body.tasksToToggle?.length) {
            await Promise.all(
                (body.tasksToToggle as { id: string; completed: boolean }[]).map(
                    (t) =>
                        prisma.jobTask.update({
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
            await prisma.jobTask.createMany({
                data: (body.tasksToAdd as string[]).map((desc: string) => ({
                    jobCardId:   cardId,
                    description: desc,
                })),
            });
        }

        // Update the card itself
        const card = await prisma.jobCard.update({
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
    } catch (error) {
        console.error('Failed to update job card:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}

// DELETE /api/maintenance/work-orders/[id]/job-cards/[cardId]
export async function DELETE(
    _request: Request,
    { params }: { params: { id: string; cardId: string } },
) {
    try {
        const { cardId } = params;
        await prisma.jobCard.delete({ where: { id: cardId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete job card:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
