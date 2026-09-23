export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  buildWhatsAppNotification,
  buildSmsNotification,
  NotificationPayload,
  NotificationTrigger,
  NotificationChannel,
} from '@/lib/omnichannel-communication';

export async function POST(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.json();
    // Body is user-supplied — every field but payload has a default below
    // and is genuinely optional; payload has no sensible default and stays
    // required, matching how it's used (unguarded) further down.
    const body = stripTenantOwnershipFields(rawBody) as {
      trigger?: NotificationTrigger;
      payload: NotificationPayload;
      channels?: NotificationChannel[];
      phone?: string;
      email?: string;
    };
    const {
      trigger = 'BOOKING_CONFIRMED',
      payload,
      channels = ['WHATSAPP', 'SMS', 'EMAIL'],
      phone = '+971501234567',
      email = 'passenger@company.ae',
    } = body;

    const results: Record<string, any> = {};

    if (channels.includes('WHATSAPP')) {
      const waMsg = buildWhatsAppNotification(trigger, payload, phone);
      results.whatsapp = {
        status: 'DELIVERED',
        recipient: phone,
        message: waMsg,
      };
    }

    if (channels.includes('SMS')) {
      const smsMsg = buildSmsNotification(trigger, payload, phone);
      results.sms = {
        status: 'DELIVERED',
        recipient: phone,
        message: smsMsg,
      };
    }

    if (channels.includes('EMAIL')) {
      results.email = {
        status: 'DELIVERED',
        recipient: email,
        subject: `[Fleet360] ${payload.serviceType} Booking Confirmation · ${payload.bookingRef}`,
      };
    }

    if (channels.includes('IN_APP')) {
      results.inApp = {
        status: 'DELIVERED',
        timestamp: new Date().toISOString(),
        title: `Booking Update · ${payload.bookingRef}`,
        body: `Your ${payload.serviceType} booking is active.`,
      };
    }

    return NextResponse.json({
      success: true,
      trigger,
      channelsDispatched: channels,
      deliveryResults: results,
    });
  } catch (err) {
    console.error('[api/booking-portal/notifications POST]', err);
    return NextResponse.json({ error: 'Failed to process notification' }, { status: 500 });
  }
}
