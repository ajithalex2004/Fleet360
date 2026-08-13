import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ inputs: [], note: 'Migrated to Go backend' });
}
