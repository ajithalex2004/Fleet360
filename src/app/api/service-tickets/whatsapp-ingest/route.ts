export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import {
  parseInboundMessage,
  createTicketFromParsedIntent,
  type InboundMessageParams,
} from '@/lib/service-tickets/whatsapp-nlp-engine';

export const runtime = 'nodejs';

/**
 * POST /api/service-tickets/whatsapp-ingest
 *
 * Ingestion endpoint for Omnichannel WhatsApp & In-App Driver support chats.
 * Body: { from, body, customerName?, mediaUrl?, geminiApiKey? }
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rawBody = await req.json();
      const body = stripTenantOwnershipFields(rawBody);

      const { from, body: messageText, customerName, mediaUrl, geminiApiKey } = body;

      if (!messageText || typeof messageText !== 'string') {
        return NextResponse.json(
          { error: 'message body text is required' },
          { status: 400 }
        );
      }

      const params: InboundMessageParams = {
        from: from || 'whatsapp:web_inbound',
        body: messageText,
        customerName: customerName || null,
        mediaUrl: mediaUrl || null,
        tenantId,
      };

      // 1. Run Hybrid 2-Tier NLP Engine
      const intent = await parseInboundMessage(params, geminiApiKey);

      // 2. Provision Service Ticket in Postgres
      const ticketResult = await createTicketFromParsedIntent(intent, params, tenantId);

      return NextResponse.json({
        ok: true,
        intent,
        ticket: {
          id: ticketResult.ticketId,
          readableId: ticketResult.readableId,
          ticketType: intent.ticketType,
          priority: intent.priority,
          title: intent.title,
          description: intent.description,
          extractedPlateNumber: intent.extractedPlateNumber,
          category: intent.category,
          tierUsed: intent.tierUsed,
          confidence: intent.confidence,
        },
        autoReply: ticketResult.autoReply,
      });
    } catch (err) {
      console.error('POST /api/service-tickets/whatsapp-ingest error:', err);
      return NextResponse.json(
        { error: 'Failed to process WhatsApp message ingestion' },
        { status: 500 }
      );
    }
  });
}
