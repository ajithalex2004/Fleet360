export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/customer-portal/me — the signed-in account, its company, the
 * portals it can open (enabled for the company and holding a role there) with
 * its role in each, and the Transport categories it can request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { openablePortals, readCustomerPortalSession, requireCustomerPortal } from '@/lib/customer-portal/session';
import { getPortalUserById, portalsForCustomer } from '@/lib/customer-portal/users';
import { getCustomer } from '@/lib/service-tickets/customer-context';
import { customerTransportCategories } from '@/lib/transport-catalog/store';

export async function GET(req: NextRequest) {
  const s = readCustomerPortalSession(req);
  if (!s) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  const account = await getPortalUserById(s.tenantId, s.userId);
  const portals = account ? openablePortals(account.roles, await portalsForCustomer(s.tenantId, s.customerId)) : [];
  // Runs the full session check (active, version, company) against a portal the account can open.
  const ctx = await requireCustomerPortal(req, { portal: portals[0] ?? 'FSM' });
  if (ctx instanceof NextResponse) return ctx;
  const [customer, categories] = await Promise.all([
    withTenantRls(prisma, ctx.tenantId, (tx) => getCustomer(tx, ctx.tenantId, ctx.customerId)),
    portals.includes('TRANSPORT') ? customerTransportCategories(ctx.tenantId, ctx.customerId) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    ok: true,
    user: {
      id: ctx.user.id, email: ctx.user.email, fullName: ctx.user.fullName, mobile: account?.mobile ?? null,
      roles: account?.roles ?? {},
    },
    customer: { id: customer.id, code: customer.code, name: customer.name },
    portals,
    transportCategories: categories.map((c) => ({
      category: c.category, title: c.title, description: c.description, menu: c.menu, approvalRequired: c.approvalRequired,
    })),
  });
}
