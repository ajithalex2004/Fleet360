import { NextResponse } from 'next/server';
import { getWorkflowStats } from '@/lib/workflow-db';

export async function GET() {
  try {
    const stats = await getWorkflowStats();
    return NextResponse.json(stats);
  } catch (e: any) {
    return NextResponse.json({ total: 0, active: 0, pendingApprovals: 0, activeInstances: 0 });
  }
}
