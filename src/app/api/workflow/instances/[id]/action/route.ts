import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { advanceWorkflow, getWorkflowInstanceWithHistory } from '@/lib/workflow-db';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { action, comments, currentStepOrder } = body;
    let actionedByEmail = typeof body.actionedByEmail === 'string' ? body.actionedByEmail.trim().toLowerCase() : '';
    const sessionUserId = req.headers.get('x-user-id') ?? '';

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'action must be APPROVE or REJECT' }, { status: 400 });
    }

    if (sessionUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { email: true },
      });
      actionedByEmail = user?.email?.trim().toLowerCase() ?? '';
    }

    if (!actionedByEmail) {
      return NextResponse.json({ error: 'Authenticated user email not found' }, { status: 400 });
    }

    const instance = await getWorkflowInstanceWithHistory(params.id);
    if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    if (instance.status !== 'IN_PROGRESS') {
      return NextResponse.json({ error: `Workflow is already ${instance.status}` }, { status: 422 });
    }

    const stepOrder = currentStepOrder ?? instance.currentStepOrder;
    const result = await advanceWorkflow(params.id, stepOrder, action, comments ?? '', actionedByEmail);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed';
    console.error('POST /api/workflow/instances/[id]/action error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const instance = await getWorkflowInstanceWithHistory(params.id);
    if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(instance);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
