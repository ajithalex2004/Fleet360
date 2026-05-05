import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowWithSteps, updateWorkflow, deleteWorkflow } from '@/lib/workflow-db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const wf = await getWorkflowWithSteps(params.id);
    if (!wf) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(wf);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    await updateWorkflow(params.id, body);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteWorkflow(params.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
