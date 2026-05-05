import { NextRequest, NextResponse } from 'next/server';
import { advanceWorkflow, getWorkflowInstanceWithHistory } from '@/lib/workflow-db';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { action, comments, actionedByEmail, currentStepOrder } = body;

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'action must be APPROVE or REJECT' }, { status: 400 });
    }
    if (!actionedByEmail) {
      return NextResponse.json({ error: 'actionedByEmail is required' }, { status: 400 });
    }

    const instance = await getWorkflowInstanceWithHistory(params.id);
    if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    if (instance.status !== 'IN_PROGRESS') {
      return NextResponse.json({ error: `Workflow is already ${instance.status}` }, { status: 422 });
    }

    const stepOrder = currentStepOrder ?? instance.currentStepOrder;
    const result = await advanceWorkflow(params.id, stepOrder, action, comments ?? '', actionedByEmail);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('POST /api/workflow/instances/[id]/action error:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const instance = await getWorkflowInstanceWithHistory(params.id);
    if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(instance);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
