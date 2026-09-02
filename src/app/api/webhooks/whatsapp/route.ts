export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiptService } from '@/lib/exchange/webhook-receipt-service';

export const runtime = 'nodejs';

/**
 * GET /api/webhooks/whatsapp
 * Meta WhatsApp Webhook Verification Handshake
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'fleet360_exchange_webhook_token';

  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse('Forbidden', { status: 403 });
}

/**
 * POST /api/webhooks/whatsapp
 * Meta WhatsApp Status Updates (sent, delivered, read, failed)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Check for WhatsApp status receipts in entry[].changes[].value.statuses[]
    const entries = body.entry || [];
    const results = [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const statuses = change.value?.statuses || [];
        for (const st of statuses) {
          const res = await WebhookReceiptService.processWhatsAppStatusUpdate({
            messageId: st.id,
            status: st.status,
            recipientId: st.recipient_id,
            timestamp: st.timestamp,
            errorDetails: st.errors ? st.errors[0] : undefined,
          });
          results.push(res);
        }
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process WhatsApp webhook' },
      { status: 500 }
    );
  }
}
