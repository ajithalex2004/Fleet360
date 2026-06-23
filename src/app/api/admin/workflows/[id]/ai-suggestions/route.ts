import { NextRequest, NextResponse } from 'next/server';
import { listWorkflowAISuggestions, refreshWorkflowAISuggestions } from '@/lib/workflow-db';
import { requireWorkflowAccess } from '@/lib/admin-workflow-policy';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'view', id);
    if (auth instanceof NextResponse) return auth;
    const suggestions = await listWorkflowAISuggestions(id);
    return NextResponse.json(suggestions);
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'edit', id);
    if (auth instanceof NextResponse) return auth;
    const suggestions = await refreshWorkflowAISuggestions(id);
    return NextResponse.json({ success: true, suggestions });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
