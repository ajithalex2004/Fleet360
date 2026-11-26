export const dynamic = 'force-dynamic';

/**
 * Booking Portal → Customer requests: Transport requests raised by customers
 * in the Customer Portal.
 *
 * GET   ?status=active|PENDING_APPROVAL|…&category=RAC   the tenant's requests
 * PATCH { id, action, driverName?, driverPhone?, vehicle?, note?, staffNote? }
 *   action: approve | reject | confirm | assign | start | complete | cancel | send.
 *   `note` is shown to the customer in the stage history; `staffNote` is not.
 *   Approving sends the request to its module (Logistics shipping request,
 *   Rental inquiry, Bus Ops transport request); `send` retries one that was
 *   not sent, e.g. once the Staff Transport passenger is in Bus Ops.
 * Access: booking-portal module (policy matrix); changes are audited.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { resolveTechnician } from '@/lib/service-tickets/customer-context';
import {
  TransportRequestError, listTenantTransportRequests, staffTransportAction,
} from '@/lib/transport-requests/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const q = req.nextUrl.searchParams;
  try {
    const requests = await listTenantTransportRequests(authz.tenantId, { status: q.get('status'), category: q.get('category') });
    return NextResponse.json({ ok: true, requests });
  } catch (err) {
    captureException(err, { context: 'booking-portal.customer-requests.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load customer requests' }, { status: 500 });
  }
}

async function handlePATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const body = stripTenantOwnershipFields((await req.json().catch(() => ({}))) as Record<string, unknown>);
  const id = String(body.id ?? '');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
  const userId = authz.userId ?? '';
  try {
    const who = await withTenantRls(prisma, authz.tenantId, (tx) => resolveTechnician(tx, userId));
    const staffName = who?.name ?? 'Operations';
    const request = await staffTransportAction(authz.tenantId, id, body.action, {
      driverName: body.driverName, driverPhone: body.driverPhone, vehicle: body.vehicle, note: body.note, staffNote: body.staffNote,
    }, { id: userId, name: staffName });
    void logAudit({
      tenantId: authz.tenantId, userId, entityType: 'CustomerTransportRequest', entityId: request.id,
      entityName: request.requestNo, action: 'UPDATE',
      details: `Customer transport request ${request.requestNo}: ${String(body.action)} → ${request.status}`,
    });
    return NextResponse.json({ ok: true, request });
  } catch (err) {
    if (err instanceof TransportRequestError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'booking-portal.customer-requests.update' });
    return NextResponse.json({ ok: false, error: 'Failed to update the request' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
