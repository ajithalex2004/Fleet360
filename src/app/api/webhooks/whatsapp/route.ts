import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logInteraction } from '@/lib/agents/whatsapp-agent/agent';

const INIT = `
  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    direction TEXT NOT NULL,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    customer_name TEXT,
    message_body TEXT NOT NULL,
    message_sid TEXT,
    status TEXT DEFAULT 'RECEIVED',
    message_type TEXT DEFAULT 'TEXT',
    template_name TEXT,
    module TEXT,
    intent TEXT,
    auto_replied BOOLEAN DEFAULT false,
    auto_reply_text TEXT,
    resolved BOOLEAN DEFAULT false,
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    media_url TEXT,
    raw_payload JSONB
  );
`;

function detectIntentAndModule(lowerBody: string, profileName: string): {
  intent: string;
  module: string;
  autoReply: string;
} {
  if (
    lowerBody.includes('book') ||
    lowerBody.includes('reserve') ||
    lowerBody.includes('rental') ||
    lowerBody.includes('rent') ||
    lowerBody.includes('حجز') ||
    lowerBody.includes('ايجار')
  ) {
    return {
      intent: 'INQUIRY',
      module: 'RENTAL',
      autoReply: `Hello ${profileName || 'there'}! 👋 Thank you for your interest in our rental service.\n\nTo process your rental inquiry, please provide:\n📅 Pickup date\n📅 Return date\n🚗 Vehicle type preference\n📍 Pickup location\n\nOur team will respond within 30 minutes.\n\n— Smart Mobility Team`,
    };
  }

  if (
    lowerBody.includes('lease') ||
    lowerBody.includes('leasing') ||
    lowerBody.includes('تأجير') ||
    lowerBody.includes('ليس')
  ) {
    return {
      intent: 'INQUIRY',
      module: 'LEASING',
      autoReply: `Hello ${profileName || 'there'}! 👋 Thank you for your interest in our vehicle leasing service.\n\nFor a leasing quotation, we'll need:\n🚗 Vehicle type & brand preference\n📅 Lease duration (months)\n📏 Expected monthly mileage\n\nOur leasing advisor will contact you shortly.\n\n— Smart Mobility Team`,
    };
  }

  if (
    lowerBody.includes('payment') ||
    lowerBody.includes('invoice') ||
    lowerBody.includes('pay') ||
    lowerBody.includes('دفع') ||
    lowerBody.includes('فاتورة')
  ) {
    return {
      intent: 'PAYMENT_REMINDER',
      module: 'GENERAL',
      autoReply: `Hello! 💳 For payment inquiries, please visit our customer portal or contact our finance team.\n\n📧 finance@smartmobility.ae\n📞 +971 4 XXX XXXX\n\n— Smart Mobility Finance Team`,
    };
  }

  if (
    lowerBody.includes('renew') ||
    lowerBody.includes('extend') ||
    lowerBody.includes('تجديد')
  ) {
    return {
      intent: 'RENEWAL_NUDGE',
      module: 'GENERAL',
      autoReply: `Hello ${profileName || 'there'}! 🔄 To renew or extend your contract, please provide your:\n📋 Contract/Agreement number\n📅 Preferred new end date\n\nOur team will prepare the renewal paperwork.\n\n— Smart Mobility Team`,
    };
  }

  if (
    lowerBody === 'hi' ||
    lowerBody === 'hello' ||
    lowerBody === 'السلام عليكم' ||
    lowerBody === 'مرحبا'
  ) {
    return {
      intent: 'GENERAL',
      module: 'GENERAL',
      autoReply: `Hello ${profileName || 'there'}! 👋 Welcome to Smart Mobility.\n\nHow can we help you today?\n\n1️⃣ *Vehicle Rental* — Short-term rentals\n2️⃣ *Vehicle Leasing* — Long-term leasing\n3️⃣ *Payment & Invoices* — Billing support\n4️⃣ *Contract Renewal* — Extend your agreement\n\nReply with a number or describe your inquiry.\n\n🕐 Available 24/7 | 🌐 Arabic & English`,
    };
  }

  return {
    intent: 'GENERAL',
    module: 'GENERAL',
    autoReply: `Thank you for contacting Smart Mobility! 🚗\n\nWe've received your message and our team will respond shortly.\n\nFor urgent matters: 📞 +971 4 XXX XXXX\n\n— Smart Mobility Team`,
  };
}

export async function POST(req: NextRequest) {
  // Ensure table exists
  await prisma.$executeRawUnsafe(INIT).catch(() => {});

  // Parse Twilio's form-encoded body
  const text = await req.text();
  const params = new URLSearchParams(text);

  const from = params.get('From') ?? '';
  const body = params.get('Body') ?? '';
  const profileName = params.get('ProfileName') ?? '';
  const messageSid = params.get('MessageSid') ?? '';
  const numMedia = parseInt(params.get('NumMedia') ?? '0', 10);
  const mediaUrl = numMedia > 0 ? (params.get('MediaUrl0') ?? null) : null;

  // Clean phone numbers
  const fromNumber = from.replace('whatsapp:', '');
  const toNumber = (params.get('To') ?? '').replace('whatsapp:', '');

  const lowerBody = body.toLowerCase().trim();
  const { intent, module, autoReply } = detectIntentAndModule(lowerBody, profileName);

  const messageType = numMedia > 0 ? 'MEDIA' : 'TEXT';

  const t0 = Date.now();

  // Store inbound message
  await prisma
    .$executeRawUnsafe(
      `INSERT INTO whatsapp_messages
         (direction, from_number, to_number, customer_name, message_body, message_sid,
          intent, module, auto_replied, auto_reply_text, message_type, media_url, raw_payload)
       VALUES ('INBOUND', $1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11::jsonb)`,
      fromNumber,
      toNumber,
      profileName || null,
      body,
      messageSid,
      intent,
      module,
      autoReply,
      messageType,
      mediaUrl,
      JSON.stringify(Object.fromEntries(params))
    )
    .catch(() => {});

  // Log to agent_runs for ecosystem visibility (fire-and-forget)
  logInteraction({
    messageId:  messageSid || `wa-${Date.now()}`,
    intent,
    from:       fromNumber,
    resolved:   true, // auto-replied = resolved by bot
    durationMs: Date.now() - t0,
  });

  // Escape XML special characters for TwiML
  const safeReply = autoReply
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${safeReply}</Message>
</Response>`;

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
