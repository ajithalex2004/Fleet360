export const dynamic = 'force-dynamic';

import { secretsEqual } from '@/lib/secure-compare';
import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiptService } from '@/lib/exchange/webhook-receipt-service';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { ensureAgentSchema } from '@/lib/agents/schema';
import { logInteraction } from '@/lib/agents/whatsapp-agent/agent';
import { classifyIntent, WhatsAppIntent } from '@/lib/whatsapp/intent';
import { sendWhatsAppMessage, WHATSAPP_FROM_NUMBER } from '@/lib/whatsapp/twilio-client';
import { verifyTwilioSignature, twilioWebhookUrl } from '@/lib/whatsapp/twilio-signature';

export const runtime = 'nodejs';

const TEMPLATE_BY_INTENT: Record<WhatsAppIntent, string> = {
  INQUIRY:  'auto_reply_inquiry',
  PAYMENT:  'auto_reply_payment',
  RENEWAL:  'auto_reply_renewal',
  GENERAL:  'auto_reply_general',
};

async function getReplyBody(intent: WhatsAppIntent): Promise<string> {
  const templateName = TEMPLATE_BY_INTENT[intent];
  try {
    const rows = await prisma.$queryRawUnsafe<{ body_en: string }[]>(
      `SELECT body_en FROM whatsapp_templates WHERE template_name = $1 AND is_active = true LIMIT 1`,
      templateName,
    );
    if (rows[0]?.body_en) {
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_templates SET usage_count = usage_count + 1, updated_at = NOW() WHERE template_name = $1`,
        templateName,
      ).catch(() => {});
      return rows[0].body_en;
    }
  } catch { /* fall through to hardcoded fallback below */ }

  // Fallback if the templates table isn't reachable — never leave a
  // customer message unanswered because of a DB hiccup.
  return "Thanks for contacting Fleet360! We've received your message and a member of our team will respond as soon as possible.";
}

/**
 * Tenant an inbound message belongs to: the tenant that most recently sent a
 * message to this number. 'default' (platform-only) when no tenant has.
 */
async function attributeInboundTenant(fromNumber: string): Promise<string> {
  if (!fromNumber) return 'default';
  try {
    const rows = await withPlatformAdmin(prisma, (tx) => tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
      `SELECT tenant_id FROM whatsapp_messages
        WHERE direction = 'OUTBOUND' AND to_number = $1 AND tenant_id <> 'default'
        ORDER BY created_at DESC
        LIMIT 1`,
      fromNumber,
    ));
    return rows[0]?.tenant_id ?? 'default';
  } catch {
    return 'default';
  }
}

/**
 * Twilio's inbound-message webhook posts x-www-form-urlencoded with
 * MessageSid + From + Body, and critically no MessageStatus (that field
 * only appears on delivery-status callbacks for outbound messages).
 */
async function handleInboundTwilioMessage(form: URLSearchParams) {
  const t0 = Date.now();
  await ensureAgentSchema();

  const messageSid = form.get('MessageSid') ?? '';
  const from        = (form.get('From') ?? '').replace('whatsapp:', '');
  const to          = (form.get('To') ?? '').replace('whatsapp:', '') || WHATSAPP_FROM_NUMBER;
  const body        = form.get('Body') ?? '';

  const intent = classifyIntent(body);

  // The shared number carries every tenant's conversations and the webhook
  // has no session. Attribute the message to the tenant that last messaged
  // this sender; with none, keep it platform-only ('default', the column
  // default, which no tenant can read under RLS). Stored in platform context
  // because whatsapp_messages is tenant-isolated by RLS.
  const tenantId = await attributeInboundTenant(from);

  // Log the inbound message first, independent of whether the reply succeeds.
  await withPlatformAdmin(prisma, (tx) => tx.$executeRawUnsafe(
    `INSERT INTO whatsapp_messages
       (direction, from_number, to_number, message_body, message_sid, status,
        message_type, module, intent, auto_replied, raw_payload, tenant_id)
     VALUES ('INBOUND', $1, $2, $3, $4, 'RECEIVED', 'TEXT', 'WHATSAPP', $5, false, $6::jsonb, $7)`,
    from, to, body, messageSid, intent,
    JSON.stringify(Object.fromEntries(form.entries())),
    tenantId,
  )).catch((e) => console.error('[whatsapp webhook] failed to log inbound message:', e));

  const replyBody = await getReplyBody(intent);
  const sendResult = await sendWhatsAppMessage(from, replyBody);
  const resolved = sendResult !== null;

  await withPlatformAdmin(prisma, (tx) => tx.$executeRawUnsafe(
    `INSERT INTO whatsapp_messages
       (direction, from_number, to_number, message_body, message_sid, status,
        message_type, template_name, module, intent, auto_replied, raw_payload, tenant_id)
     VALUES ('OUTBOUND', $1, $2, $3, $4, $5, 'TEMPLATE', $6, 'WHATSAPP', $7, true, $8::jsonb, $9)`,
    to, from, replyBody, sendResult?.sid ?? null, resolved ? 'SENT' : 'FAILED',
    TEMPLATE_BY_INTENT[intent], intent,
    JSON.stringify({ inReplyTo: messageSid }),
    tenantId,
  )).catch((e) => console.error('[whatsapp webhook] failed to log outbound reply:', e));

  await logInteraction({
    tenantId,
    messageId:  messageSid,
    intent,
    from,
    resolved,
    durationMs: Date.now() - t0,
  });

  // Twilio expects a 200 with empty/TwiML body — an auto-reply was already
  // sent via the REST API above, so no <Message> content is needed here.
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

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

  if (mode === 'subscribe' && secretsEqual(token, verifyToken)) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse('Forbidden', { status: 403 });
}

/**
 * POST /api/webhooks/whatsapp
 * Handles two distinct payload shapes on this one endpoint:
 *  - Twilio inbound message (x-www-form-urlencoded, has Body+From, no
 *    MessageStatus) → classify intent, auto-reply, log to whatsapp_messages.
 *  - Meta WhatsApp Business status updates (JSON, entry[].changes[].value.statuses[])
 *    → delivery receipt processing (sent/delivered/read/failed).
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const rawBody = await req.text();
    const form = new URLSearchParams(rawBody);

    const signature = req.headers.get('x-twilio-signature');
    const url = twilioWebhookUrl(req, '/api/webhooks/whatsapp');
    if (!verifyTwilioSignature(url, form, signature, process.env.TWILIO_AUTH_TOKEN)) {
      console.error('[whatsapp webhook] rejected: invalid or missing X-Twilio-Signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    if (form.get('Body') !== null && form.get('From') !== null && form.get('MessageStatus') === null) {
      return handleInboundTwilioMessage(form);
    }
    // A Twilio status callback shape landed here instead — nothing to do,
    // that traffic is expected at /api/webhooks/twilio.
    return NextResponse.json({ ok: true, ignored: true });
  }

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
