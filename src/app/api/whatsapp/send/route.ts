export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { sendWhatsAppMessage, WHATSAPP_FROM_NUMBER } from '@/lib/whatsapp/twilio-client';
import { ensureAgentSchema } from '@/lib/agents/schema';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';

interface SendPayload {
  to: string;
  message?: string;
  templateName?: string;
  templateVars?: Record<string, string>;
  module?: string;
  intent?: string;
}

async function getTemplateBody(templateName: string, vars: Record<string, string>, lang = 'en'): Promise<string> {
  try {
    const col = lang === 'ar' ? 'body_ar' : 'body_en';
    const rows = await prisma.$queryRawUnsafe<{ body: string }[]>(
      `SELECT ${col} AS body FROM whatsapp_templates WHERE template_name = $1 AND is_active = true LIMIT 1`,
      templateName
    );
    if (!rows.length || !rows[0].body) return '';
    let body = rows[0].body;
    for (const [k, v] of Object.entries(vars)) {
      body = body.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    // Increment usage count
    await prisma.$executeRawUnsafe(
      `UPDATE whatsapp_templates SET usage_count = usage_count + 1, updated_at = NOW() WHERE template_name = $1`,
      templateName
    ).catch(() => {});
    return body;
  } catch {
    return '';
  }
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const payloadRaw: SendPayload = await req.json();
        const payload = stripTenantOwnershipFields(payloadRaw);
        const { to, message, templateName, templateVars = {}, module = 'GENERAL', intent = 'GENERAL' } = payload;

        if (!to) {
          return NextResponse.json({ error: 'to is required' }, { status: 400 });
        }

        const normalizedTo = to.startsWith('+') ? to : `+${to}`;

        // Build message body
        let messageBody = message ?? '';
        let resolvedTemplate: string | null = null;

        if (templateName) {
          const body = await getTemplateBody(templateName, templateVars);
          if (body) {
            messageBody = body;
            resolvedTemplate = templateName;
          }
        }

        if (!messageBody) {
          return NextResponse.json({ error: 'message body is empty' }, { status: 400 });
        }

        // Send via Twilio
        const twilioResp = await sendWhatsAppMessage(normalizedTo, messageBody);
        const messageSid = twilioResp?.sid ?? null;
        const status = twilioResp ? 'SENT' : (ACCOUNT_SID ? 'FAILED' : 'LOGGED');

        // Store outbound message
        const fromNumber = WHATSAPP_FROM_NUMBER;
        await tx.$executeRawUnsafe(
          `INSERT INTO whatsapp_messages
             (direction, from_number, to_number, message_body, message_sid, status,
              message_type, template_name, module, intent, auto_replied, raw_payload)
           VALUES ('OUTBOUND', $1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10::jsonb)`,
          fromNumber,
          normalizedTo,
          messageBody,
          messageSid,
          status,
          resolvedTemplate ? 'TEMPLATE' : 'TEXT',
          resolvedTemplate,
          module,
          intent,
          JSON.stringify({ to, templateName, templateVars, module, intent })
        ).catch(() => {});

        return NextResponse.json({ success: true, messageSid, status });
        } catch (err) {
        console.error('[WhatsApp Send]', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
  });
}


export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const to = searchParams.get('to');

        if (!to) {
          return NextResponse.json({ error: 'to query param required' }, { status: 400 });
        }

        const normalizedTo = to.startsWith('+') ? to : `+${to}`;

        const messages = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM whatsapp_messages
           WHERE from_number = $1 OR to_number = $1
           ORDER BY created_at ASC`,
          normalizedTo
        );

        return NextResponse.json({ messages });
      } catch (e) {
        console.error('[WhatsApp GET]', e);
        return NextResponse.json({ error: 'Internal server e' }, { status: 500 });
      }
  });
}

