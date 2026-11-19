export const dynamic = 'force-dynamic';

/**
 * GET  /api/service-tickets/whatsapp-webhook — Meta WhatsApp Cloud API verification challenge
 * POST /api/service-tickets/whatsapp-webhook — Live inbound WhatsApp message receiver (Meta & Twilio)
 *
 * Capabilities:
 *  1. Meta Webhook Handshake: validates hub.verify_token and returns hub.challenge.
 *  2. Dual Payload Support: parses both Meta Cloud API JSON and Twilio form/JSON payloads.
 *  3. Ingestion into Central Hopper: runs 2-tier NLP parser and provisions ticket into OPERATIONS_TRIAGE.
 */

import crypto from 'crypto';
import { secretsEqual } from '@/lib/secure-compare';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import { verifyTwilioSignature, twilioWebhookUrl } from '@/lib/whatsapp/twilio-signature';
import {
  parseInboundMessage,
  createTicketFromParsedIntent,
  type InboundMessageParams,
} from '@/lib/service-tickets/whatsapp-nlp-engine';

export const runtime = 'nodejs';

function verifyMetaHubSignature(rawBody: string, signatureHeader: string | null, secret: string | undefined): boolean {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') return false;
  const signatureHex = parts[1];

  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const actualBuf = Buffer.from(signatureHex, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  try {
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

async function resolveInboundTenant(fromNumber: string, phoneNumberId?: string | null): Promise<string> {
  const cleanNumber = fromNumber.replace(/^whatsapp:/, '').trim();

  if (phoneNumberId) {
    try {
      const match = await withPlatformAdmin(prisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
          `SELECT tenant_id FROM tenants WHERE id = $1 OR custom_domain = $1 LIMIT 1`,
          phoneNumberId
        )
      ).catch(() => []);
      if (match[0]?.tenant_id) return match[0].tenant_id;
    } catch { /* ignore */ }
  }

  if (cleanNumber) {
    try {
      const rows = await withPlatformAdmin(prisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
          `SELECT tenant_id FROM whatsapp_messages
           WHERE direction = 'OUTBOUND' AND to_number = $1 AND tenant_id <> 'default'
           ORDER BY created_at DESC LIMIT 1`,
          cleanNumber
        )
      ).catch(() => []);
      if (rows[0]?.tenant_id) return rows[0].tenant_id;

      const custRows = await withPlatformAdmin(prisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
          `SELECT tenant_id FROM customers
           WHERE (mobile_number = $1 OR contact_person_phone = $1 OR phone = $1)
             AND tenant_id IS NOT NULL AND tenant_id <> 'default'
           ORDER BY created_at DESC LIMIT 1`,
          cleanNumber
        )
      ).catch(() => []);
      if (custRows[0]?.tenant_id) return custRows[0].tenant_id;
    } catch { /* ignore */ }
  }

  return 'default';
}

/**
 * GET /api/service-tickets/whatsapp-webhook
 * Meta Cloud API Verification Request
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json(
      { error: 'WhatsApp webhook verification token is not configured' },
      { status: 503 }
    );
  }

  if (mode === 'subscribe' && secretsEqual(token, verifyToken)) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return NextResponse.json({ error: 'Forbidden verification challenge' }, { status: 403 });
}

/**
 * POST /api/service-tickets/whatsapp-webhook
 * Inbound Message Receiver
 */
export async function POST(req: NextRequest) {
  try {
    let messageText = '';
    let fromNumber = '';
    let customerName: string | null = null;
    let mediaUrl: string | null = null;
    let phoneNumberId: string | null = null;

    const contentType = req.headers.get('content-type') || '';

    // 1. Authenticate and parse Meta Cloud API or Twilio payload
    if (contentType.includes('application/json')) {
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      if (!appSecret) {
        return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
      }

      const hubSignature = req.headers.get('x-hub-signature-256');
      if (!hubSignature) {
        return NextResponse.json({ error: 'Missing X-Hub-Signature-256' }, { status: 401 });
      }

      const rawBody = await req.text();
      if (!verifyMetaHubSignature(rawBody, hubSignature, appSecret)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }

      let rawPayload: any;
      try {
        rawPayload = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
      }

      const payload = stripTenantOwnershipFields(rawPayload) as Record<string, any>;

      // Meta WhatsApp Cloud API Format
      if (payload.object === 'whatsapp_business_account' && Array.isArray(payload.entry)) {
        const entry = payload.entry[0];
        const change = entry?.changes?.[0]?.value;
        phoneNumberId = change?.metadata?.phone_number_id || null;
        const contact = change?.contacts?.[0];
        const message = change?.messages?.[0];

        if (message) {
          fromNumber = message.from;
          customerName = contact?.profile?.name || null;
          if (message.type === 'text') {
            messageText = message.text?.body || '';
          } else if (message.type === 'image') {
            messageText = message.image?.caption || 'Attached breakdown image';
            mediaUrl = message.image?.id || null;
          } else if (message.type === 'location') {
            messageText = `Location shared: Lat ${message.location?.latitude}, Lng ${message.location?.longitude}`;
          } else {
            messageText = `Inbound ${message.type} message`;
          }
        }
      } else {
        // Direct JSON or Twilio JSON
        messageText = payload.body || payload.Body || payload.text || '';
        fromNumber = payload.from || payload.From || '';
        customerName = payload.customerName || payload.ProfileName || null;
        mediaUrl = payload.mediaUrl || payload.MediaUrl0 || null;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!authToken) {
        return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
      }

      const signature = req.headers.get('x-twilio-signature');
      if (!signature) {
        return NextResponse.json({ error: 'Missing X-Twilio-Signature' }, { status: 401 });
      }

      const rawBody = await req.text();
      const form = new URLSearchParams(rawBody);
      const url = twilioWebhookUrl(req, '/api/service-tickets/whatsapp-webhook');
      if (!verifyTwilioSignature(url, form, signature, authToken)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }

      messageText = String(form.get('Body') ?? '');
      fromNumber = String(form.get('From') ?? '');
      customerName = (form.get('ProfileName') as string) || null;
      mediaUrl = (form.get('MediaUrl0') as string) || null;
    } else {
      return NextResponse.json({ error: 'Unsupported media type' }, { status: 415 });
    }

    if (!messageText) {
      // Return 200 OK so Meta/Twilio does not repeatedly retry delivery receipts or status pings
      return NextResponse.json({ status: 'ignored_or_no_text' }, { status: 200 });
    }

    // 2. Resolve Tenant Context securely from sender/phone metadata (never untrusted query/header)
    const tenantId = await resolveInboundTenant(fromNumber, phoneNumberId);

    // 3. Process Inbound Message with 2-Tier NLP
    return withTenantRls(prisma, tenantId, async () => {
      const inboundParams: InboundMessageParams = {
        from: fromNumber || 'whatsapp:customer',
        body: messageText,
        customerName,
        mediaUrl,
        tenantId,
      };

      const intent = await parseInboundMessage(inboundParams);
      const ticketResult = await createTicketFromParsedIntent(intent, inboundParams, tenantId);

      // Also ensure trackingToken is attached in customFields
      const trackingToken = crypto.randomUUID().replace(/-/g, '');
      await prisma.$executeRawUnsafe(
        `UPDATE service_tickets
         SET custom_fields = custom_fields || jsonb_build_object(
           'assignedDepartment', 'OPERATIONS_TRIAGE',
           'source', 'WHATSAPP',
           'trackingToken', $2
         )
         WHERE id = $1::uuid`,
        ticketResult.ticketId,
        trackingToken
      ).catch(() => {});

      return NextResponse.json({
        ok: true,
        status: 'received',
        ticketId: ticketResult.ticketId,
        readableId: ticketResult.readableId,
        trackingToken,
        intent: {
          category: intent.category,
          priority: intent.priority,
          confidence: intent.confidence,
        },
      });
    });
  } catch (err) {
    console.error('POST /api/service-tickets/whatsapp-webhook error:', err);
    return NextResponse.json(
      { error: 'Failed to process WhatsApp webhook', details: String(err) },
      { status: 500 }
    );
  }
}
