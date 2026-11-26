export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/customer-portal/fsm/requests/[id]
 * One request of the signed-in customer: details, lifecycle (stage, time,
 * who) and the assigned technician's contact. 404 for anyone else's request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import { getCustomerRequest } from '@/lib/customer-portal/requests';

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM' });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const request = await getCustomerRequest(ctx.tenantId, ctx.customerId, id);
  if (!request) return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  return NextResponse.json({ ok: true, request });
}
