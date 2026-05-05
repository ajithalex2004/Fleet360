import { NextResponse } from 'next/server';
import { duplicateWorkflow } from '@/lib/workflow-db';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const newId = await duplicateWorkflow(params.id);
    return NextResponse.json({ id: newId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
