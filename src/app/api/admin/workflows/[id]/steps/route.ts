import { NextRequest, NextResponse } from 'next/server';
import { listSteps, createStep } from '@/lib/workflow-db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const steps = await listSteps(params.id);
    return NextResponse.json(steps);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const id = await createStep(params.id, body);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
