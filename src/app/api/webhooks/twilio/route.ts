export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiptService } from '@/lib/exchange/webhook-receipt-service';
import { verifyTwilioSignature, twilioWebhookUrl } from '@/lib/whatsapp/twilio-signature';

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
      // Twilio's own status callbacks are always x-www-form-urlencoded;
      // this branch only exists for non-Twilio/manual test callers, so
      // there's no X-Twilio-Signature to check here.
      body = await req.json().catch(() => ({}));
    } else {
      // Twilio always sends x-www-form-urlencoded — verify the signature
      // before trusting anything in the body.
      const rawBody = await req.text();
      const form = new URLSearchParams(rawBody);

      const signature = req.headers.get('x-twilio-signature');
      const url = twilioWebhookUrl(req, '/api/webhooks/twilio');
      if (!verifyTwilioSignature(url, form, signature, process.env.TWILIO_AUTH_TOKEN)) {
        console.error('[twilio webhook] rejected: invalid or missing X-Twilio-Signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }

      body = Object.fromEntries(form.entries());
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
