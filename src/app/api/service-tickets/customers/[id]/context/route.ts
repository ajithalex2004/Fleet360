export const dynamic = 'force-dynamic';

/**
 * GET /api/service-tickets/customers/[id]/context
 *
 * Everything the Service Request form needs once a customer is chosen: the
 * customer, its entities / sites (with contact person and mobile), the
 * equipment installed at those sites, and a preview of the next request
 * number (the number is only taken when the request is submitted).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { captureException } from '@/lib/sentry';
import {
  CustomerContextError, getCustomer, listCustomerAssets, listCustomerSites, peekServiceRequestNumber,
} from '@/lib/service-tickets/customer-context';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;
  const { id } = await params;
  try {
    const data = await withTenantRls(prisma, tenantId, async (tx) => {
      const customer = await getCustomer(tx, tenantId, id);
      const [sites, assets, nextRequestNo] = await Promise.all([
        listCustomerSites(tx, tenantId, id),
        listCustomerAssets(tx, tenantId, id),
        peekServiceRequestNumber(tx, tenantId, customer.code),
      ]);
      return { customer, sites, assets, nextRequestNo };
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    if (err instanceof CustomerContextError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    captureException(err, { context: 'service-tickets.customers.context' });
    return NextResponse.json({ ok: false, error: 'Failed to load the customer' }, { status: 500 });
  }
}
