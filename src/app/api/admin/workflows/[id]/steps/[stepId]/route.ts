import { NextRequest, NextResponse } from 'next/server';
import { updateStep, deleteStep } from '@/lib/workflow-db';

export async function PUT(req: NextRequest, { params }: { params: { stepId: string } }) {
  try {
    const body = await req.json();
    await updateStep(params.stepId, body);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { stepId: string } }) {
  try {
    await deleteStep(params.stepId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
