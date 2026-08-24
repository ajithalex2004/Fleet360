import { NextRequest, NextResponse } from 'next/server';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ inputs: [], note: 'Migrated to Go backend' });
}
