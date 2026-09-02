export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiptService } from '@/lib/exchange/webhook-receipt-service';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/twilio
 * Twilio SMS Status Callback Webhook
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let body: any = {};

    if (contentType.includes('application/json')) {
      body = await req.json().catch(() => ({}));
    } else {
      // Twilio often sends x-www-form-urlencoded
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
    }

    const { MessageSid, MessageStatus, To, ErrorCode, ErrorMessage } = body;

    if (!MessageSid) {
      return NextResponse.json({ error: 'MessageSid is required' }, { status: 400 });
    }

    const result = await WebhookReceiptService.processTwilioStatusCallback({
      messageSid: MessageSid,
      messageStatus: MessageStatus || 'delivered',
      to: To || '',
      errorCode: ErrorCode,
      errorMessage: ErrorMessage,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process Twilio webhook' },
      { status: 500 }
    );
  }
}
