import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

const BODY = {
  error: 'Legacy booking-based logistics trip status API has been retired.',
  replacement: '/api/logistics/shipments/[id]/status',
  canonicalEntity: 'logistics_shipment_orders',
};

export async function GET() {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return NextResponse.json(BODY, { status: 410 });
}

export async function PATCH() {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return NextResponse.json(BODY, { status: 410 });
}
