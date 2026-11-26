export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/customer-portal/fsm/sites — add an entity / site to the
 * signed-in customer (portal ADMIN only). Same fields as the staff route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import { CustomerContextError, createCustomerSite } from '@/lib/service-tickets/customer-context';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM', roles: ['ADMIN'] });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  try {
    const site = await withTenantRls(prisma, ctx.tenantId, (tx) => createCustomerSite(tx, ctx.tenantId, ctx.customerId, body));
    void logAudit({
      tenantId: ctx.tenantId, userId: ctx.user.id, userRole: 'CUSTOMER_PORTAL', entityType: 'CustomerSite',
      entityId: site.id, entityName: site.name, action: 'CREATE', details: `Customer added entity / site ${site.name}`,
    });
    return NextResponse.json({ ok: true, site }, { status: 201 });
  } catch (err) {
    if (err instanceof CustomerContextError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    throw err;
  }
}
