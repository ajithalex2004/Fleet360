/**
 * POST   /api/push/subscribe — register a device for push notifications
 * DELETE /api/push/subscribe — unregister a device (or all of mine)
 *
 * The PWA's service worker calls `pushManager.subscribe(...)` to get a
 * PushSubscription object (endpoint, keys.p256dh, keys.auth) and posts
 * that to this endpoint. We persist it with the staff member id from
 * the session — so a staff member using two phones gets two rows.
 *
 * Auth: the mobile PWA authenticates with a staff member's employeeId
 * (the PWA's login flow uses that, not the admin session). The
 * subscription row is keyed by staffMemberId, so we need to accept
 * either an admin session or a staff member session.
 *
 * In practice, the mobile PWA posts the employeeId alongside the
 * subscription so the server doesn't need a separate login for the
 * notification opt-in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  employeeId?: string;
  optIn?: { tripReminder?: boolean; runningLate?: boolean; delay?: boolean };
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let body: SubscribeBody;
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: 'endpoint + keys required' }, { status: 400 });
  }
  if (!body.employeeId) {
    return NextResponse.json({ error: 'employeeId required' }, { status: 400 });
  }

  // The mobile PWA does not have an admin session — it identifies itself
  // by staff employeeId only. We look up the staff record across tenants
  // (no RLS filter — the employeeId is the global identity) and infer
  // tenantId from the staff record. This is safe because push subscriptions
  // are tied to the staff record, and a subscription is only useful to
  // whoever controls that staff row.
  const staff = await prisma.staffMember.findFirst({
    where: { employeeId: body.employeeId, deletedAt: null },
    select: { id: true, tenantId: true },
  });
  if (!staff) {
    return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
  }
  const tenantId = staff.tenantId ?? req.headers.get('x-tenant-id') ?? '';
  if (!tenantId) {
    return NextResponse.json({ error: 'Cannot determine tenant' }, { status: 400 });
  }

  const ua = body.userAgent ?? req.headers.get('user-agent') ?? null;
  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: {
      staffMemberId: staff.id,
      tenantId,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: ua,
      revokedAt: null,
      updatedAt: new Date(),
      optInTripReminder: body.optIn?.tripReminder ?? true,
      optInRunningLate:  body.optIn?.runningLate  ?? true,
      optInDelay:        body.optIn?.delay        ?? true,
    },
    create: {
      staffMemberId: staff.id,
      tenantId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: ua,
      optInTripReminder: body.optIn?.tripReminder ?? true,
      optInRunningLate:  body.optIn?.runningLate  ?? true,
      optInDelay:        body.optIn?.delay        ?? true,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: sub.id, ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint');
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

  // Soft-revoke so a re-subscribe can reuse the same row.
  const result = await prisma.pushSubscription.updateMany({
    where: { endpoint, tenantId },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ revoked: result.count });
}
