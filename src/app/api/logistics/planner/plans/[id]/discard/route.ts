export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  // A stub, but still tenant-scoped: it answers only an authorized tenant.
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { id } = await ctx.params;
  return NextResponse.json({ id, note: 'Migrated to Go backend' });
}
