export const dynamic = 'force-dynamic';

/**
 * POST   /api/push/subscribe — register a device for push notifications
 * DELETE /api/push/subscribe — unregister one of my devices
 *
 * The PWA's service worker calls `pushManager.subscribe(...)` to get a
 * PushSubscription object (endpoint, keys.p256dh, keys.auth) and posts
 * that to this endpoint. We persist it with the staff member id from
 * the session — so a staff member using two phones gets two rows.
 *
 * Auth: signed xl-session plus active tenant membership. User.employeeId
 * must link to an active workforce record in that tenant. A body employeeId
 * is optional and may only confirm that same identity, never select another.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import { getVerifiedRequestSession } from '@/lib/tenant-session';
import { resolvePushStaff } from '@/lib/push/auth';
interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  employeeId?: string;
  optIn?: { tripReminder?: boolean; runningLate?: boolean; delay?: boolean };
}

export async function POST(req: NextRequest) {

  const session = await getVerifiedRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const { tenantId } = session;

  return withTenantRls(prisma, tenantId, async (tx) => {
      let bodyRaw: SubscribeBody;
      try {
        bodyRaw = await req.json() as SubscribeBody;
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      const body = stripTenantOwnershipFields(bodyRaw);

      if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
        return NextResponse.json({ error: 'endpoint + keys required' }, { status: 400 });
      }
      const staff = await resolvePushStaff(tx, session);
      if (!staff || (body.employeeId && body.employeeId !== staff.employeeId)) {
        return NextResponse.json({ error: 'Staff identity not authorized' }, { status: 403 });
      }
      const existing = await tx.pushSubscription.findUnique({ where: { endpoint: body.endpoint } });
      if (existing && (existing.tenantId !== tenantId || existing.staffMemberId !== staff.id)) {
        return NextResponse.json({ error: 'Subscription not authorized' }, { status: 403 });
      }

      const ua = body.userAgent ?? req.headers.get('user-agent') ?? null;
      const sub = await tx.pushSubscription.upsert({
        where: { endpoint: body.endpoint, tenantId, staffMemberId: staff.id },
        update: {
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
  });
}


export async function DELETE(req: NextRequest) {

  const session = await getVerifiedRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const { tenantId } = session;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const url = new URL(req.url);
      const staff = await resolvePushStaff(tx, session);
      if (!staff) return NextResponse.json({ error: 'Staff identity not authorized' }, { status: 403 });
      const endpoint = url.searchParams.get('endpoint');
      if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

      // Soft-revoke so a re-subscribe can reuse the same row.
      const result = await tx.pushSubscription.updateMany({
        where: { endpoint, tenantId, staffMemberId: staff.id },
        data: { revokedAt: new Date() },
      });

      return NextResponse.json({ revoked: result.count });
  });
}
