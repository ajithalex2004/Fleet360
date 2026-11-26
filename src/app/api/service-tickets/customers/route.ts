export const dynamic = 'force-dynamic';

/**
 * GET /api/service-tickets/customers
 *
 * Customers a Field Service request can be raised for, plus the request
 * channel and entitlement / billing options the Service Request form offers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { captureException } from '@/lib/sentry';
import { ENTITLEMENT_TYPES, REQUEST_CHANNELS, listCustomers } from '@/lib/service-tickets/customer-context';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;
  try {
    const customers = await withTenantRls(prisma, tenantId, (tx) => listCustomers(tx, tenantId));
    return NextResponse.json({ ok: true, customers, channels: REQUEST_CHANNELS, entitlements: ENTITLEMENT_TYPES });
  } catch (err) {
    captureException(err, { context: 'service-tickets.customers.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load customers' }, { status: 500 });
  }
}
