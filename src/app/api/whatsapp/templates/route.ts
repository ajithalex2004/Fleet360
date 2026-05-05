import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT_TABLE = `
  CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    template_name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    category TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    body_en TEXT NOT NULL,
    body_ar TEXT,
    variables JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    usage_count INT DEFAULT 0
  );
`;

const DEFAULT_TEMPLATES = [
  {
    template_name: 'booking_confirmation_en',
    display_name: 'Booking Confirmation (English)',
    category: 'BOOKING_CONFIRMATION',
    language: 'en',
    body_en: `Hello {{customer_name}}! ✅ Your rental booking is confirmed.\n\n📋 Booking: {{booking_ref}}\n🚗 Vehicle: {{vehicle_name}}\n📅 Pickup: {{pickup_date}} at {{pickup_location}}\n📅 Return: {{return_date}}\n💰 Total: AED {{total_amount}}\n\nFor any changes: {{support_phone}}\n— Smart Mobility Team`,
    body_ar: null,
    variables: JSON.stringify(['customer_name', 'booking_ref', 'vehicle_name', 'pickup_date', 'pickup_location', 'return_date', 'total_amount', 'support_phone']),
  },
  {
    template_name: 'payment_reminder_en',
    display_name: 'Payment Reminder (English)',
    category: 'PAYMENT_REMINDER',
    language: 'en',
    body_en: `Hello {{customer_name}}, 💳 This is a friendly reminder that your payment of AED {{amount}} for {{contract_ref}} is due on {{due_date}}.\n\nPay online: {{payment_url}}\nQueries: {{support_email}}\n— Smart Mobility Finance`,
    body_ar: null,
    variables: JSON.stringify(['customer_name', 'amount', 'contract_ref', 'due_date', 'payment_url', 'support_email']),
  },
  {
    template_name: 'renewal_nudge_en',
    display_name: 'Renewal Nudge (English)',
    category: 'RENEWAL_NUDGE',
    language: 'en',
    body_en: `Hello {{customer_name}}! 🔄 Your {{contract_type}} contract {{contract_ref}} expires on {{expiry_date}} ({{days_remaining}} days remaining).\n\nTo renew, reply RENEW or contact us:\n📞 {{support_phone}}\n— Smart Mobility Team`,
    body_ar: null,
    variables: JSON.stringify(['customer_name', 'contract_type', 'contract_ref', 'expiry_date', 'days_remaining', 'support_phone']),
  },
  {
    template_name: 'booking_confirmation_ar',
    display_name: 'Booking Confirmation (Arabic)',
    category: 'BOOKING_CONFIRMATION',
    language: 'ar',
    body_en: `Hello {{customer_name}}! ✅ Your rental booking is confirmed.\n\n📋 Booking: {{booking_ref}}\n🚗 Vehicle: {{vehicle_name}}\n📅 Pickup: {{pickup_date}}\n📅 Return: {{return_date}}\n💰 Total: AED {{total_amount}}\n— Smart Mobility Team`,
    body_ar: `مرحباً {{customer_name}}! ✅ تم تأكيد حجزك.\n\n📋 الحجز: {{booking_ref}}\n🚗 السيارة: {{vehicle_name}}\n📅 الاستلام: {{pickup_date}}\n📅 الإرجاع: {{return_date}}\n💰 المبلغ: {{total_amount}} درهم\n— فريق سمارت موبيليتي`,
    variables: JSON.stringify(['customer_name', 'booking_ref', 'vehicle_name', 'pickup_date', 'return_date', 'total_amount']),
  },
  {
    template_name: 'payment_reminder_ar',
    display_name: 'Payment Reminder (Arabic)',
    category: 'PAYMENT_REMINDER',
    language: 'ar',
    body_en: `Hello {{customer_name}}, 💳 Your payment of AED {{amount}} for {{contract_ref}} is due on {{due_date}}.\n— Smart Mobility Finance`,
    body_ar: `مرحباً {{customer_name}}، 💳 تذكير بأن دفعتك البالغة {{amount}} درهم لعقد {{contract_ref}} مستحقة في {{due_date}}.\n— قسم المالية، سمارت موبيليتي`,
    variables: JSON.stringify(['customer_name', 'amount', 'contract_ref', 'due_date']),
  },
];

async function ensureTableAndSeed() {
  await prisma.$executeRawUnsafe(INIT_TABLE).catch(() => {});

  // Check if table is empty
  const rows = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM whatsapp_templates`
  ).catch(() => [{ count: '0' }]);

  if (parseInt(rows[0]?.count ?? '0', 10) === 0) {
    for (const t of DEFAULT_TEMPLATES) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO whatsapp_templates
           (template_name, display_name, category, language, body_en, body_ar, variables)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (template_name) DO NOTHING`,
        t.template_name,
        t.display_name,
        t.category,
        t.language,
        t.body_en,
        t.body_ar ?? null,
        t.variables
      ).catch(() => {});
    }
  }
}

export async function GET() {
  try {
    await ensureTableAndSeed();
    const templates = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM whatsapp_templates ORDER BY category, language, created_at`
    );
    return NextResponse.json({ templates });
  } catch (err) {
    console.error('[Templates GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTableAndSeed();
    const body = await req.json() as {
      template_name: string;
      display_name: string;
      category: string;
      language?: string;
      body_en: string;
      body_ar?: string;
      variables?: string[];
    };

    const { template_name, display_name, category, language = 'en', body_en, body_ar, variables = [] } = body;

    if (!template_name || !display_name || !category || !body_en) {
      return NextResponse.json({ error: 'template_name, display_name, category, body_en are required' }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO whatsapp_templates (template_name, display_name, category, language, body_en, body_ar, variables)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      template_name, display_name, category, language, body_en, body_ar ?? null, JSON.stringify(variables)
    );

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM whatsapp_templates WHERE template_name = $1 LIMIT 1`,
      template_name
    );

    return NextResponse.json({ template: rows[0] }, { status: 201 });
  } catch (err) {
    console.error('[Templates POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      template_name: string;
      display_name?: string;
      body_en?: string;
      body_ar?: string;
      variables?: string[];
      is_active?: boolean;
    };

    const { template_name, display_name, body_en, body_ar, variables, is_active } = body;

    if (!template_name) {
      return NextResponse.json({ error: 'template_name is required' }, { status: 400 });
    }

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [template_name];
    let idx = 2;

    if (display_name !== undefined) { setClauses.push(`display_name = $${idx++}`); params.push(display_name); }
    if (body_en !== undefined) { setClauses.push(`body_en = $${idx++}`); params.push(body_en); }
    if (body_ar !== undefined) { setClauses.push(`body_ar = $${idx++}`); params.push(body_ar); }
    if (variables !== undefined) { setClauses.push(`variables = $${idx++}::jsonb`); params.push(JSON.stringify(variables)); }
    if (is_active !== undefined) { setClauses.push(`is_active = $${idx++}`); params.push(is_active); }

    await prisma.$executeRawUnsafe(
      `UPDATE whatsapp_templates SET ${setClauses.join(', ')} WHERE template_name = $1`,
      ...params
    );

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM whatsapp_templates WHERE template_name = $1 LIMIT 1`,
      template_name
    );

    return NextResponse.json({ template: rows[0] });
  } catch (err) {
    console.error('[Templates PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
