import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ plans: [], note: 'Migrated to Go backend' });
}
