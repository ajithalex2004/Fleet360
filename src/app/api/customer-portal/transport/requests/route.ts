export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Portal — the customer's Transport requests.
 *
 * GET  ?scope=active|all&category=RAC&from=ISO   the company's requests
 * POST { category, values, customerNote? }      raise a request (ADMIN / REQUESTER)
 *   values are checked against the tenant's form for the category; a 400
 *   carries `fieldErrors` for the form to show.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import {
  TransportRequestError, createTransportRequest, listCustomerTransportRequests,
} from '@/lib/transport-requests/store';
import { captureException } from '@/lib/sentry';

export async function GET(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'TRANSPORT' });
  if (ctx instanceof NextResponse) return ctx;
  const q = req.nextUrl.searchParams;
  try {
    const requests = await listCustomerTransportRequests(ctx.tenantId, ctx.customerId, {
      scope: q.get('scope') === 'active' ? 'active' : 'all', category: q.get('category'), from: q.get('from'),
    });
    return NextResponse.json({ ok: true, requests });
  } catch (err) {
    captureException(err, { context: 'customer-portal.transport.list' });
    return NextResponse.json({ ok: false, error: 'Could not load your requests' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'TRANSPORT', roles: ['ADMIN', 'REQUESTER'] });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const request = await createTransportRequest({
      tenantId: ctx.tenantId, customerId: ctx.customerId,
      user: { id: ctx.user.id, name: ctx.user.fullName ?? ctx.user.email },
      category: body?.category, values: body?.values, customerNote: body?.customerNote, attachments: body?.attachments,
    });
    return NextResponse.json({ ok: true, request }, { status: 201 });
  } catch (err) {
    if (err instanceof TransportRequestError) {
      return NextResponse.json({ ok: false, error: err.message, fieldErrors: err.fieldErrors }, { status: err.status });
    }
    captureException(err, { context: 'customer-portal.transport.create' });
    return NextResponse.json({ ok: false, error: 'Could not submit your request' }, { status: 500 });
  }
}
