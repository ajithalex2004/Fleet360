export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Portal — the customer's Field Service requests.
 *
 * GET  /api/customer-portal/fsm/requests?scope=active|all&status=&siteId=&from=&to=
 *      Requests of the signed-in customer only (customer view: no staff notes).
 * POST /api/customer-portal/fsm/requests
 *      Raise a request (ADMIN or REQUESTER). Same validation and numbering as
 *      staff (createServiceTicket in portal mode): locked to this customer,
 *      Field Service catalogue types only, channel Customer Portal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import { listCustomerRequests } from '@/lib/customer-portal/requests';
import { createServiceTicket, type CreateTicketBody } from '@/lib/service-tickets/create-ticket';
import { captureException } from '@/lib/sentry';

export async function GET(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM' });
  if (ctx instanceof NextResponse) return ctx;
  const sp = req.nextUrl.searchParams;
  try {
    const requests = await listCustomerRequests(ctx.tenantId, ctx.customerId, {
      scope: sp.get('scope') ?? undefined, status: sp.get('status') ?? undefined, siteId: sp.get('siteId') ?? undefined,
      from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined,
    });
    return NextResponse.json({ ok: true, requests });
  } catch (err) {
    captureException(err, { context: 'customer-portal.fsm.requests.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load your requests' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM', roles: ['ADMIN', 'REQUESTER'] });
  if (ctx instanceof NextResponse) return ctx;
  let body: CreateTicketBody;
  try { body = (await req.json()) as CreateTicketBody; }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  return withTenantRls(prisma, ctx.tenantId, (tx) => createServiceTicket(tx, {
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    actorName: ctx.user.fullName ?? ctx.user.email,
    body,
    portal: { customerId: ctx.customerId },
  }));
}
