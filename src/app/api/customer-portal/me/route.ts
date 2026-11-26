export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/customer-portal/me — the signed-in portal user, their company and enabled portals. */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { readCustomerPortalSession, requireCustomerPortal } from '@/lib/customer-portal/session';
import { portalsForCustomer } from '@/lib/customer-portal/users';
import { getCustomer } from '@/lib/service-tickets/customer-context';

export async function GET(req: NextRequest) {
  // Any enabled portal will do for "who am I"; try FSM, then Transport.
  const s = readCustomerPortalSession(req);
  if (!s) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  const portals = await portalsForCustomer(s.tenantId, s.customerId);
  const ctx = await requireCustomerPortal(req, { portal: portals[0] ?? 'FSM' });
  if (ctx instanceof NextResponse) return ctx;
  const customer = await withTenantRls(prisma, ctx.tenantId, (tx) => getCustomer(tx, ctx.tenantId, ctx.customerId));
  return NextResponse.json({
    ok: true,
    user: ctx.user,
    customer: { id: customer.id, code: customer.code, name: customer.name },
    portals,
  });
}
