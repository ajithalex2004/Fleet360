export const dynamic = 'force-dynamic';

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
 *     channels?: ('WHATSAPP' | 'EMAIL' | 'SMS')[], // default: all three
 *     includeDispatcher?: boolean,            // default: true — also pings ops digest
 *     dryRun?: boolean,
 *   }
 *
 * SMS is a fallback, not a parallel broadcast channel: it only fires for a
 * given recipient when WhatsApp wasn't attempted or didn't land (no
 * WhatsApp/smartphone, Twilio error, etc) — see the per-recipient loop
 * below. This is what actually reaches staff without a smartphone or
 * WhatsApp account, a real population in blue-collar transport contexts.
 *
 * The wording is the tenant's email template for the notice (Admin > Email
 * templates > Staff transport), in the tenant's language; WhatsApp and SMS
 * get the same text. The summary goes to the tenant's Transport Managers
 * (else its contact email). Messages go out after the transaction commits.
 *
 * Returns per-passenger send results so the dispatcher can see who got it.
 * Best-effort — individual failures don't fail the request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { sendWhatsApp } from '@/lib/whatsapp';
import { sendEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { loadEmailTemplate, tenantEmailContext } from '@/lib/email-templates';
import { staffRecipients } from '@/lib/staff-recipients';
import { sessionUser } from '@/lib/session-user';
import {
  TRIP_NOTICE_KEY, TRIP_NOTICE_KINDS, OPS_SUMMARY_KEY,
  firstName, noticeLabel, quotedTextBlock, tripNoticeValues, type TripNoticeKind,
} from '@/lib/bus-ops/trip-notices';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

type Kind = TripNoticeKind;
type Channel = 'WHATSAPP' | 'EMAIL' | 'SMS';
type ChannelResult = { sent: boolean; reason?: string };

interface Recipient { passengerId: string; name: string | null; phone: string | null; email: string | null }

interface PerRecipient {
  passengerId: string;
  employeeName: string | null;
  whatsapp: ChannelResult | null;
  email:    ChannelResult | null;
  sms:      ChannelResult | null;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields((await req.json()) ?? {});
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const kind = String(body?.kind ?? '').toUpperCase() as Kind;
  if (!TRIP_NOTICE_KINDS.includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${TRIP_NOTICE_KINDS.join(', ')}` }, { status: 400 });
  }
  if (kind === 'CUSTOM' && !body.customMessage) {
    return NextResponse.json({ error: 'customMessage is required for CUSTOM kind' }, { status: 400 });
  }
  const channels: Channel[] = Array.isArray(body.channels) && body.channels.length > 0
    ? (body.channels as unknown[]).map((c) => String(c).toUpperCase()).filter((c): c is Channel => c === 'WHATSAPP' || c === 'EMAIL' || c === 'SMS')
    : ['WHATSAPP', 'EMAIL', 'SMS'];
  const includeDispatcher = body.includeDispatcher !== false;
  const dryRun = body.dryRun === true;
  const reason = typeof body.reason === 'string' ? body.reason : null;

  try {
    // 1. Read the trip and its passengers; a cancellation is recorded here.
    const loaded = await withTenantRls(prisma, tenantId, async (tx) => {
      const schedule = await tx.tripSchedule.findUnique({
        where: { id: params.id },
        include: { route: true, passengers: true },
      });
      if (!schedule) return null;

      const passengers = schedule.passengers.filter(p => ['CONFIRMED', 'BOARDED'].includes(p.status ?? 'CONFIRMED'));
      const staffIds = [...new Set(passengers.map(p => p.staffMemberId).filter(Boolean) as string[])];
      const staff = staffIds.length > 0
        ? await tx.staffMember.findMany({
            where: { id: { in: staffIds }, tenantId },
            select: { id: true, name: true, email: true, contactNumber: true },
          })
        : [];
      const staffById = new Map(staff.map(s => [s.id, s]));
      const recipients: Recipient[] = passengers.map((p) => {
        const s = p.staffMemberId ? staffById.get(p.staffMemberId) : null;
        return { passengerId: p.id, name: p.employeeName ?? s?.name ?? null, phone: s?.contactNumber ?? null, email: s?.email ?? null };
      });

      // For CANCELLED, also flip the trip status (driver may not be there to do it).
      if (kind === 'CANCELLED' && !dryRun && !['COMPLETED', 'CANCELLED'].includes(schedule.status ?? '')) {
        await tx.tripSchedule.update({
          where: { id: params.id },
          data: { status: 'CANCELLED', notes: [schedule.notes, reason ? `Cancelled via notify: ${reason}` : 'Cancelled via notify'].filter(Boolean).join('\n') },
        });
      }

      return {
        tripNumber: schedule.tripNumber ?? params.id.slice(0, 8),
        routeName: schedule.route?.name ?? null,
        departure: schedule.departureTime,
        recipients,
      };
    });
    if (!loaded) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    // 2. Render the tenant's wording (no database access per recipient).
    const context = await tenantEmailContext(tenantId);
    const template = await loadEmailTemplate({ tenantId, key: TRIP_NOTICE_KEY[kind], context });
    const values = tripNoticeValues(kind, {
      tripNumber: loaded.tripNumber,
      routeName: loaded.routeName,
      departure: loaded.departure,
      delayMinutes: typeof body.delayMinutes === 'number' ? body.delayMinutes : undefined,
      newDeparture: typeof body.newDeparture === 'string' ? body.newDeparture : null,
      reason,
      message: typeof body.customMessage === 'string' ? body.customMessage : null,
    });
    const messageFor = (name: string | null) => template.render({ values: { ...values, staffName: firstName(name) } });
    const preview = messageFor(null);

    // 3. Send.
    const results: PerRecipient[] = [];
    if (!dryRun) {
      for (const r of loaded.recipients) {
        const msg = messageFor(r.name);
        let whatsappResult: ChannelResult | null = null;
        let emailResult: ChannelResult | null = null;
        let smsResult: ChannelResult | null = null;

        if (channels.includes('WHATSAPP') && r.phone) {
          const r1 = await sendWhatsApp({ to: r.phone, body: msg.text });
          whatsappResult = { sent: r1.sent, reason: r1.reason };
        }
        if (channels.includes('EMAIL') && r.email) {
          const r2 = await sendEmail({ to: r.email, subject: msg.subject, html: msg.html, text: msg.text });
          emailResult = { sent: r2.sent, reason: r2.reason };
        }
        // Fallback, not a broadcast: fires whenever WhatsApp wasn't
        // attempted (no phone, channel not requested) or was attempted
        // and didn't land (no WhatsApp/smartphone, Twilio error) — this
        // is what reaches a passenger with a basic phone and no data.
        if (channels.includes('SMS') && r.phone && !whatsappResult?.sent) {
          const r3 = await sendSms({ to: r.phone, body: msg.text });
          smsResult = { sent: r3.sent, reason: r3.reason };
        }

        results.push({ passengerId: r.passengerId, employeeName: r.name, whatsapp: whatsappResult, email: emailResult, sms: smsResult });
      }
    }

    // Summary for the tenant's transport managers (email), and the ops
    // phone (WhatsApp, else SMS) when one is configured.
    let dispatcherEmail: ChannelResult | null = null;
    let dispatcherWhatsApp: ChannelResult | null = null;
    let dispatcherSms: ChannelResult | null = null;
    if (!dryRun && includeDispatcher) {
      const reached = results.filter(r => r.whatsapp?.sent || r.email?.sent || r.sms?.sent).length;
      const sender = await sessionUser(req.headers).catch(() => null);
      const summary = (await loadEmailTemplate({ tenantId, key: OPS_SUMMARY_KEY, context })).render({
        values: (l) => ({
          tripNumber: loaded.tripNumber,
          routeName: loaded.routeName ?? '',
          noticeType: noticeLabel(kind, l),
          reachedCount: String(reached),
          passengerCount: String(results.length),
          sentBy: sender?.name ?? sender?.email ?? '',
        }),
        blocks: { passengerMessage: quotedTextBlock(preview.text) },
      });
      const managers = await staffRecipients(tenantId, 'TRANSPORT_MANAGER');
      if (managers.length) {
        const r = await sendEmail({ to: managers, subject: summary.subject, html: summary.html, text: summary.text });
        dispatcherEmail = { sent: r.sent, reason: r.reason };
      }
      const opsPhone = process.env.OPERATIONS_PHONE;
      if (opsPhone) {
        const digest = `${summary.subject}\n\n${preview.text}`;
        const r = await sendWhatsApp({ to: opsPhone, body: digest });
        dispatcherWhatsApp = { sent: r.sent, reason: r.reason };
        if (!r.sent) {
          const r2 = await sendSms({ to: opsPhone, body: digest });
          dispatcherSms = { sent: r2.sent, reason: r2.reason };
        }
      }
    }

    if (!dryRun) {
      await logAudit({
        tenantId,
        userId: req.headers.get('x-user-id') ?? 'system',
        userRole: req.headers.get('x-user-role') ?? 'STAFF',
        entityType: 'TripSchedule',
        entityId: params.id,
        action: kind === 'CANCELLED' ? 'UPDATE' : 'EXPORT',
        details: `Notify ${kind}: ${results.length} recipients via ${channels.join('+')}.${kind === 'DELAY' && body.delayMinutes ? ` Delay ${body.delayMinutes}m.` : ''}${reason ? ` Reason: ${reason}` : ''}`,
      });
    }

    return NextResponse.json({
      ok: true,
      kind,
      dryRun,
      recipients: dryRun ? loaded.recipients.length : results.length,
      sentWhatsApp: results.filter(r => r.whatsapp?.sent).length,
      sentEmail:    results.filter(r => r.email?.sent).length,
      sentSms:      results.filter(r => r.sms?.sent).length,
      noPhone:      results.filter(r => channels.includes('WHATSAPP') && r.whatsapp === null).length,
      noEmail:      results.filter(r => channels.includes('EMAIL')    && r.email    === null).length,
      // Recipients WhatsApp never reached (no attempt or a failed send)
      // and SMS also couldn't cover — i.e. genuinely unreachable, not
      // just "SMS wasn't tried because WhatsApp already worked".
      unreachable:  results.filter(r => !r.whatsapp?.sent && !r.email?.sent && !r.sms?.sent).length,
      results,
      dispatcherEmail,
      dispatcherWhatsApp,
      dispatcherSms,
      preview: { subject: preview.subject, body: preview.text },
    });
  } catch (err) {
    captureException(err, { context: 'bus-ops.notify', tags: { scheduleId: params.id } });
    return NextResponse.json({ error: 'Notify failed' }, { status: 500 });
  }
}
