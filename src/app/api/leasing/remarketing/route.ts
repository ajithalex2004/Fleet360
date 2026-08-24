import { NextResponse } from 'next/server';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const RETIRED_REMARKETING_RESPONSE = {
  error: 'Leasing remarketing has been retired.',
  redirectTo: '/leasing',
};

export async function GET() {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return NextResponse.json(RETIRED_REMARKETING_RESPONSE, { status: 410 });
}

export async function POST() {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return NextResponse.json(RETIRED_REMARKETING_RESPONSE, { status: 410 });
}
