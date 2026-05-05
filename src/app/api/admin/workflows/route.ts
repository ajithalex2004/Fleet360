import { NextRequest, NextResponse } from 'next/server';
import { listWorkflows, createWorkflow } from '@/lib/workflow-db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const module = searchParams.get('module') ?? undefined;
    const workflows = await listWorkflows(module);
    return NextResponse.json(workflows);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, module, procedure, description } = body;
    if (!name || !module || !procedure) {
      return NextResponse.json({ error: 'name, module and procedure are required' }, { status: 400 });
    }
    const id = await createWorkflow({ name, module, procedure, description });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
