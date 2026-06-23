/**
 * POST /api/bus-ops/schedules/[id]/notify
 *
 * Bulk notification to all CONFIRMED|BOARDED passengers on a trip.
 *
 * Body:
 *   {
 *     kind: 'DELAY' | 'CANCELLED' | 'ROUTE_CHANGE' | 'DEPARTURE_REMINDER' | 'CUSTOM',
 *     delayMinutes?: number,                  // for DELAY
 *     newDeparture?: ISO string,              // for DELAY / ROUTE_CHANGE
 *     reason?: string,                        // free-text augmentation
 *     customMessage?: string,                 // for CUSTOM
 *     channels?: ('WHATSAPP' | 'EMAIL')[],    // default: both
 *     includeDispatcher?: boolean,            // default: true — also pings ops digest
 *     dryRun?: boolean,
 *   }
 *
 * Returns per-passenger send results so the dispatcher can see who got it.
 * Best-effort — individual failures don't fail the request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendWhatsApp } from '@/lib/whatsapp';
import { sendEmail } from '@/lib/email';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { requireBusEntity, requireBusOpsContext } from '@/lib/bus-ops-route-guards';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

export const runtime = 'nodejs';

const VALID_KINDS = ['DELAY', 'CANCELLED', 'ROUTE_CHANGE', 'DEPARTURE_REMINDER', 'CUSTOM'] as const;
type Kind = typeof VALID_KINDS[number];

function buildMessage(kind: Kind, ctx: {
  routeName: string; tripNumber: string; originalDepart: string;
  delayMinutes?: number; newDeparture?: string; reason?: string; custom?: string;
}): { subject: string; body: string } {
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  switch (kind) {
    case 'DELAY':
      return {
        subject: `Bus delay — trip ${ctx.tripNumber}`,
        body:
          `🚌 Trip ${ctx.tripNumber} (${ctx.routeName})\n\n` +
          `Your bus is running ${ctx.delayMinutes ?? '?'} minutes late.\n` +
          `New departure: ${ctx.newDeparture ? fmtTime(ctx.newDeparture) : 'TBC'}\n` +
          (ctx.reason ? `\nReason: ${ctx.reason}\n` : '') +
          `\nWe apologise for the inconvenience. — Staff Transport Ops`,
      };
    case 'CANCELLED':
      return {
        subject: `Bus CANCELLED — trip ${ctx.tripNumber}`,
        body:
          `❌ Trip ${ctx.tripNumber} (${ctx.routeName}) has been CANCELLED.\n\n` +
          (ctx.reason ? `Reason: ${ctx.reason}\n\n` : '') +
          `Please arrange alternative transport. Contact Ops if you need an ad-hoc taxi voucher. — Staff Transport Ops`,
      };
    case 'ROUTE_CHANGE':
      return {
        subject: `Route change — trip ${ctx.tripNumber}`,
        body:
          `🔁 Trip ${ctx.tripNumber} (${ctx.routeName})\n\n` +
          `The route has changed. Updated departure: ${ctx.newDeparture ? fmtTime(ctx.newDeparture) : fmtTime(ctx.originalDepart)}\n` +
          (ctx.reason ? `Details: ${ctx.reason}\n` : '') +
          `\n— Staff Transport Ops`,
      };
    case 'DEPARTURE_REMINDER':
      return {
        subject: `Departure reminder — trip ${ctx.tripNumber}`,
        body:
          `⏰ Trip ${ctx.tripNumber} (${ctx.routeName}) departs at ${fmtTime(ctx.originalDepart)}.\n\n` +
          `Please be at your boarding stop 5 minutes early. — Staff Transport Ops`,
      };
    case 'CUSTOM':
      return {
        subject: `Update — trip ${ctx.tripNumber}`,
        body: ctx.custom ?? '(empty message)',
      };
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await requireBusOpsContext(req, { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const boundary = await requireBusEntity(ctx, 'trip_schedules', id, 'Trip');
    if (boundary) return boundary;
    const body = await req.json();
    const kind = String(body?.kind ?? '').toUpperCase() as Kind;
    if (!VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` }, { status: 400 });
    }
    if (kind === 'CUSTOM' && !body.customMessage) {
      return NextResponse.json({ error: 'customMessage is required for CUSTOM kind' }, { status: 400 });
    }
    const channels: Array<'WHATSAPP' | 'EMAIL'> = Array.isArray(body.channels) && body.channels.length > 0
      ? body.channels.map((c: string) => c.toUpperCase()).filter((c: string) => c === 'WHATSAPP' || c === 'EMAIL')
      : ['WHATSAPP', 'EMAIL'];
    const includeDispatcher = body.includeDispatcher !== false;
    const dryRun = body.dryRun === true;

    const schedule = await prisma.tripSchedule.findUnique({
      where: { id },
      include: { route: true, passengers: true },
    });
    if (!schedule) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const recipients = schedule.passengers.filter(p => ['CONFIRMED', 'BOARDED'].includes(p.status ?? 'CONFIRMED'));
    const staffIds = [...new Set(recipients.map(p => p.staffMemberId).filter(Boolean) as string[])];
    const staff = staffIds.length > 0
      ? await prisma.staffMember.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true, email: true, contactNumber: true },
        })
      : [];
    const staffById = new Map(staff.map(s => [s.id, s]));

    const { subject, body: messageBody } = buildMessage(kind, {
      routeName: schedule.route?.name ?? 'your route',
      tripNumber: schedule.tripNumber ?? id.slice(0, 8),
      originalDepart: schedule.departureTime.toISOString(),
      delayMinutes: typeof body.delayMinutes === 'number' ? body.delayMinutes : undefined,
      newDeparture: body.newDeparture,
      reason: body.reason,
      custom: body.customMessage,
    });

    interface PerRecipient {
      passengerId: string;
      employeeName: string | null;
      whatsapp: { sent: boolean; reason?: string } | null;
      email:    { sent: boolean; reason?: string } | null;
    }
    const results: PerRecipient[] = [];

    if (!dryRun) {
      for (const r of recipients) {
        const s = r.staffMemberId ? staffById.get(r.staffMemberId) : null;
        const phone = s?.contactNumber ?? null;
        const email = s?.email ?? null;

        let whatsappResult = null;
        let emailResult = null;

        if (channels.includes('WHATSAPP') && phone) {
          const r1 = await sendWhatsApp({ to: phone, body: messageBody });
          whatsappResult = { sent: r1.sent, reason: r1.reason };
        }
        if (channels.includes('EMAIL') && email) {
          const r2 = await sendEmail({ to: email, subject, text: messageBody });
          emailResult = { sent: r2.sent, reason: r2.reason };
        }

        results.push({
          passengerId: r.id,
          employeeName: r.employeeName ?? s?.name ?? null,
          whatsapp: whatsappResult,
          email: emailResult,
        });
      }
    }

    // Dispatcher digest — same format, sent to ops contact.
    let dispatcherEmail: { sent: boolean; reason?: string } | null = null;
    let dispatcherWhatsApp: { sent: boolean; reason?: string } | null = null;
    if (!dryRun && includeDispatcher) {
      const opsEmail = process.env.OPERATIONS_EMAIL;
      const opsPhone = process.env.OPERATIONS_PHONE;
      const sentOk = results.filter(r => r.whatsapp?.sent || r.email?.sent).length;
      const digestBody = `[OPS] ${subject}\n\nNotified ${sentOk}/${results.length} passengers.\n\n${messageBody}`;
      if (opsEmail) {
        const r = await sendEmail({ to: opsEmail, subject: `[OPS] ${subject}`, text: digestBody });
        dispatcherEmail = { sent: r.sent, reason: r.reason };
      }
      if (opsPhone) {
        const r = await sendWhatsApp({ to: opsPhone, body: digestBody });
        dispatcherWhatsApp = { sent: r.sent, reason: r.reason };
      }
    }

    // For CANCELLED, also flip the trip status (driver may not be there to do it).
    if (kind === 'CANCELLED' && !dryRun) {
      try {
        if (!['COMPLETED', 'CANCELLED'].includes(schedule.status ?? '')) {
          await prisma.tripSchedule.update({
            where: { id },
            data: { status: 'CANCELLED', notes: [schedule.notes, body.reason ? `Cancelled via notify: ${body.reason}` : 'Cancelled via notify'].filter(Boolean).join('\n') },
          });
        }
      } catch (err) {
        captureException(err, { context: 'bus-ops.notify.cancel-flip', tags: { scheduleId: id } });
      }
    }

    void logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userRole: ctx.role,
      entityType: 'TripSchedule',
      entityId: id,
      action: kind === 'CANCELLED' ? 'UPDATE' : 'EXPORT',
      details: `Notify ${kind}: ${results.length} recipients via ${channels.join('+')}.${kind === 'DELAY' && body.delayMinutes ? ` Delay ${body.delayMinutes}m.` : ''}${body.reason ? ` Reason: ${body.reason}` : ''}`,
    });

    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'STAFF_ATTENDANCE_EXCEPTION',
      referenceType: 'TripSchedule',
      referenceId: id,
      referenceNumber: schedule.tripNumber ?? id,
      contextData: {
        scheduleId: id,
        tripNumber: schedule.tripNumber ?? null,
        notificationKind: kind,
        recipients: results.length,
        channels,
        delayMinutes: body.delayMinutes ?? null,
        reason: body.reason ?? null,
        dryRun,
      },
      force: kind === 'CANCELLED' || kind === 'ROUTE_CHANGE',
    });

    return NextResponse.json({
      ok: true,
      kind,
      dryRun,
      recipients: results.length,
      sentWhatsApp: results.filter(r => r.whatsapp?.sent).length,
      sentEmail:    results.filter(r => r.email?.sent).length,
      noPhone:      results.filter(r => channels.includes('WHATSAPP') && r.whatsapp === null).length,
      noEmail:      results.filter(r => channels.includes('EMAIL')    && r.email    === null).length,
      results,
      workflow,
      dispatcherEmail,
      dispatcherWhatsApp,
      preview: { subject, body: messageBody },
    });
  } catch (err) {
    captureException(err, { context: 'bus-ops.notify', tags: { scheduleId: id } });
    return NextResponse.json({ error: 'Notify failed' }, { status: 500 });
  }
}
