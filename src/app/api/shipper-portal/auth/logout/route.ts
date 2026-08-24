/**
 * POST /api/shipper-portal/auth/logout — clears the session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildClearSessionCookie } from '@/lib/shipper-portal/auth';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', buildClearSessionCookie());
  return res;
}
