export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest): Promise<NextResponse> {
  // A stub, but still tenant-scoped: it answers only an authorized tenant.
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  return NextResponse.json({ inputs: [], note: 'Migrated to Go backend' });
}
