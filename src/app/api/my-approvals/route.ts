import { NextRequest, NextResponse } from 'next/server';
import { getMyPendingApprovals } from '@/lib/workflow-db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');
    if (!email) return NextResponse.json({ error: 'email query param required' }, { status: 400 });
    const approvals = await getMyPendingApprovals(email);
    return NextResponse.json(approvals);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
