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
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      console.error('[twilio webhook] rejected: TWILIO_AUTH_TOKEN unset');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
    }

    const signature = req.headers.get('x-twilio-signature');
    if (!signature) {
      console.error('[twilio webhook] rejected: missing X-Twilio-Signature header');
      return NextResponse.json({ error: 'Missing X-Twilio-Signature' }, { status: 401 });
    }

    const contentType = req.headers.get('content-type') || '';
    let body: any = {};
    const form = new URLSearchParams();
    const url = twilioWebhookUrl(req, '/api/webhooks/twilio');

    if (contentType.includes('application/json')) {
      const jsonBody = await req.json().catch(() => null);
      if (!jsonBody || typeof jsonBody !== 'object') {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      for (const [k, v] of Object.entries(jsonBody)) {
        if (v !== undefined && v !== null) {
          form.set(k, String(v));
        }
      }
      body = jsonBody;
    } else {
      const rawBody = await req.text();
      const parsedForm = new URLSearchParams(rawBody);
      for (const [k, v] of parsedForm.entries()) {
        form.set(k, v);
      }
      body = Object.fromEntries(parsedForm.entries());
    }

    if (!verifyTwilioSignature(url, form, signature, authToken)) {
      console.error('[twilio webhook] rejected: invalid X-Twilio-Signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
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
