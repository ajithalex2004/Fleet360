export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/customer-portal/fsm/context
 * The signed-in customer, its entities / sites, equipment and spare-parts
 * inventory, and a preview of the next request number. Same shape as the
 * staff /api/service-tickets/customers/[id]/context, plus `inventory`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import {
  getCustomer, listCustomerAssets, listCustomerInventory, listCustomerSites, peekServiceRequestNumber,
} from '@/lib/service-tickets/customer-context';

export async function GET(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM' });
  if (ctx instanceof NextResponse) return ctx;
  const { tenantId, customerId } = ctx;
  const data = await withTenantRls(prisma, tenantId, async (tx) => {
    const customer = await getCustomer(tx, tenantId, customerId);
    const [sites, assets, inventory, nextRequestNo] = await Promise.all([
      listCustomerSites(tx, tenantId, customerId),
      listCustomerAssets(tx, tenantId, customerId),
      listCustomerInventory(tx, tenantId, customerId),
      peekServiceRequestNumber(tx, tenantId, customer.code),
    ]);
    return { customer, sites, assets, inventory, nextRequestNo };
  });
  return NextResponse.json({ ok: true, ...data, role: ctx.user.role });
}
