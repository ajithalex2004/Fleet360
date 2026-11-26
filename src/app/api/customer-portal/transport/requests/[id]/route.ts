export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Portal — one of the customer's Transport requests.
 *
 * GET                       the request with its stage history, driver and vehicle
 * PATCH { action: 'cancel' }  cancel while it is awaiting approval or not yet arranged (ADMIN / REQUESTER)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import {
  TransportRequestError, cancelCustomerTransportRequest, getCustomerTransportRequest,
} from '@/lib/transport-requests/store';
import { captureException } from '@/lib/sentry';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await requireCustomerPortal(req, { portal: 'TRANSPORT' });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const request = await getCustomerTransportRequest(ctx.tenantId, ctx.customerId, id);
  if (!request) return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  return NextResponse.json({ ok: true, request });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireCustomerPortal(req, { portal: 'TRANSPORT', roles: ['ADMIN', 'REQUESTER'] });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== 'cancel') return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  try {
    const request = await cancelCustomerTransportRequest(ctx.tenantId, ctx.customerId, id, ctx.user.fullName ?? ctx.user.email);
    return NextResponse.json({ ok: true, request });
  } catch (err) {
    if (err instanceof TransportRequestError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customer-portal.transport.cancel' });
    return NextResponse.json({ ok: false, error: 'Could not cancel the request' }, { status: 500 });
  }
}
