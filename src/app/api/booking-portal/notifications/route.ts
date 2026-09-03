export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  buildWhatsAppNotification,
  buildSmsNotification,
  NotificationPayload,
  NotificationTrigger,
  NotificationChannel,
} from '@/lib/omnichannel-communication';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      trigger = 'BOOKING_CONFIRMED',
      payload,
      channels = ['WHATSAPP', 'SMS', 'EMAIL'],
      phone = '+971501234567',
      email = 'passenger@company.ae',
    }: {
      trigger: NotificationTrigger;
      payload: NotificationPayload;
      channels: NotificationChannel[];
      phone: string;
      email: string;
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
