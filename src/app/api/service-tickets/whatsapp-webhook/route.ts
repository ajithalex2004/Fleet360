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

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  parseInboundMessage,
  createTicketFromParsedIntent,
  type InboundMessageParams,
} from '@/lib/service-tickets/whatsapp-nlp-engine';

export const runtime = 'nodejs';

/**
 * GET /api/service-tickets/whatsapp-webhook
 * Meta Cloud API Verification Request
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const verifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN || 'fleet360_whatsapp_verify_token';

  if (mode === 'subscribe' && token === verifyToken) {
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

    const contentType = req.headers.get('content-type') || '';

    // 1. Parse Meta Cloud API or Twilio payload
    if (contentType.includes('application/json')) {
      const rawPayload = await req.json();
      const payload = stripTenantOwnershipFields(rawPayload) as Record<string, any>;

      // Meta WhatsApp Cloud API Format
      if (payload.object === 'whatsapp_business_account' && Array.isArray(payload.entry)) {
        const entry = payload.entry[0];
        const change = entry?.changes?.[0]?.value;
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
      // Standard Twilio Form Post
      const formData = await req.formData();
      messageText = String(formData.get('Body') ?? '');
      fromNumber = String(formData.get('From') ?? '');
      customerName = (formData.get('ProfileName') as string) || null;
      mediaUrl = (formData.get('MediaUrl0') as string) || null;
    }

    if (!messageText) {
      // Return 200 OK so Meta/Twilio does not repeatedly retry delivery receipts or status pings
      return NextResponse.json({ status: 'ignored_or_no_text' }, { status: 200 });
    }

    // 2. Resolve Tenant Context
    let tenantId = req.nextUrl.searchParams.get('tenantId') || req.headers.get('x-tenant-id');
    if (!tenantId) {
      // Query default active tenant under withPlatformAdmin
      const defaultTenant = await withPlatformAdmin(prisma, (tx) =>
        tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
          `SELECT DISTINCT tenant_id FROM service_tickets WHERE deleted_at IS NULL LIMIT 1`
        )
      ).catch(() => []);
      tenantId = defaultTenant[0]?.tenant_id || 'default-tenant';
    }

    // 3. Process Inbound Message with 2-Tier NLP
    return withTenantRls(prisma, tenantId, async () => {
      const inboundParams: InboundMessageParams = {
        from: fromNumber || 'whatsapp:customer',
        body: messageText,
        customerName,
        mediaUrl,
        tenantId: tenantId!,
      };

      const intent = await parseInboundMessage(inboundParams);
      const ticketResult = await createTicketFromParsedIntent(intent, inboundParams, tenantId!);

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
    // Return 200 or 500 with diagnostic message
    return NextResponse.json(
      { error: 'Failed to process WhatsApp webhook', details: String(err) },
      { status: 500 }
    );
  }
}
