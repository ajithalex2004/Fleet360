import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/* ── Bootstrap table ─────────────────────────────────────── */
async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  /* Seed defaults on first run */
  const defaults: Record<string, string> = {
    timezone:           'Asia/Dubai',
    locale:             'en-AE',
    date_format:        'YYYY-MM-DD',
    currency:           'AED',
    tax_enabled:        'true',
    tax_rate:           '5',
    late_fee_enabled:   'false',
    late_fee_percentage:'2',
    // Feature flags
    ff_whatsapp:        'true',
    ff_esign:           'true',
    ff_predictive_maint:'false',
    ff_ai_dispatch:     'false',
    ff_customer_portal: 'true',
    ff_mobile_app:      'false',
    // Security
    password_min_length:'8',
    session_timeout_minutes: '480',
    two_factor_enabled: 'false',
    // Email Service
    email_provider:      'none',
    email_from_name:     '',
    email_from_address:  '',
    email_reply_to:      '',
    smtp_host:           '',
    smtp_port:           '587',
    smtp_username:       '',
    smtp_password:       '',
    smtp_encryption:     'tls',
    email_api_key:       '',
    email_api_region:    '',
    email_daily_limit:   '500',
    email_test_mode:     'true',
    // SMS Service
    sms_provider:        'none',
    sms_from_number:     '',
    sms_account_sid:     '',
    sms_auth_token:      '',
    sms_api_url:         '',
    sms_daily_limit:     '200',
    sms_test_mode:       'true',
  };

  for (const [key, value] of Object.entries(defaults)) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO platform_settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
    `, key, value);
  }
}

/* ── GET — return all settings as flat object ────────────── */
export async function GET() {
  try {
    await ensureTable();
    const rows = await prisma.$queryRawUnsafe<{ key: string; value: string }[]>(
      `SELECT key, value FROM platform_settings ORDER BY key`
    );
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return NextResponse.json({ settings });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/* ── PATCH — update one or many settings ─────────────────── */
export async function PATCH(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json() as Record<string, string>;

    for (const [key, value] of Object.entries(body)) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `, key, String(value));
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
