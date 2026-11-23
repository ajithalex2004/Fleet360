export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { invalidateSmtpCache } from '@/lib/email';
import {
  sanitizePlatformSettingsResponse,
  resolvePlatformSettingPatch,
  validatePlatformSettingSecretBindings,
  redactPlatformSettingSecrets,
} from '@/lib/platform-settings-secrets';

const NOT_PLATFORM_ADMIN = { error: 'Only a platform admin can manage platform settings.' };
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

type RawExecClient = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
};

/* ── Seed defaults ────────────────────────────────────────── */
async function seedDefaultSettings(client: RawExecClient) {
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
    // AI reads Document Number / Expiry Date from tenant attachments (src/lib/tenant-attachments-autofill.ts)
    ff_attachment_autofill: 'true',
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
    await client.$executeRawUnsafe(`
      INSERT INTO platform_settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
    `, key, value);
  }
}

/* ── GET — return redacted settings + configured-secret flags ── */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status, headers: NO_STORE_HEADERS });
  }
  if (authz.role !== 'SUPER_ADMIN') {
    return NextResponse.json(NOT_PLATFORM_ADMIN, { status: 403, headers: NO_STORE_HEADERS });
  }

  try {
    // platform_settings is a global table (no tenant_id), but the wrap is
    // the canonical pattern for admin routes and keeps future RLS additions
    // backward-compatible.
    const rawSettings = await withPlatformAdmin(prisma, async (tx) => {
      await seedDefaultSettings(tx);
      const rows = await tx.$queryRawUnsafe<{ key: string; value: string }[]>(
        `SELECT key, value FROM platform_settings ORDER BY key`
      );
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    });
    const sanitized = sanitizePlatformSettingsResponse(rawSettings);
    return NextResponse.json(sanitized, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/admin/platform-settings] Error loading settings:', redactPlatformSettingSecrets(msg));
    return NextResponse.json({ error: 'Failed to load platform settings.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

/* ── PATCH — update settings while preserving omitted/blank secrets ── */
async function handlePATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status, headers: NO_STORE_HEADERS });
  }
  if (authz.role !== 'SUPER_ADMIN') {
    return NextResponse.json(NOT_PLATFORM_ADMIN, { status: 403, headers: NO_STORE_HEADERS });
  }

  let suppliedSecrets: string[] = [];
  try {
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const cleaned = stripTenantOwnershipFields(parsed as Record<string, unknown>);
    const patch = resolvePlatformSettingPatch(cleaned);
    suppliedSecrets = patch.suppliedSecrets;

    const result = await withPlatformAdmin(prisma, async (tx) => {
      await seedDefaultSettings(tx);

      const currentRows = await tx.$queryRawUnsafe<{ key: string; value: string }[]>(
        `SELECT key, value FROM platform_settings ORDER BY key`
      );
      const currentSettings: Record<string, string> = {};
      for (const r of currentRows) currentSettings[r.key] = r.value;

      const bindingCheck = validatePlatformSettingSecretBindings(currentSettings, patch);
      if (!bindingCheck.ok) {
        return { rejected: bindingCheck.error as string } as const;
      }

      for (const [key, value] of patch.writes) {
        await tx.$executeRawUnsafe(`
          INSERT INTO platform_settings (key, value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, key, value);
      }
      const rows = await tx.$queryRawUnsafe<{ key: string; value: string }[]>(
        `SELECT key, value FROM platform_settings ORDER BY key`
      );
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return { rawAfter: out } as const;
    });

    if ('rejected' in result) {
      return NextResponse.json({ error: result.rejected }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (patch.touchedSmtp) {
      invalidateSmtpCache();
    }

    const sanitized = sanitizePlatformSettingsResponse(result.rawAfter);
    return NextResponse.json(
      {
        ok: true,
        configuredSecrets: sanitized.configuredSecrets,
        secretStatus: sanitized.secretStatus,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      '[PATCH /api/admin/platform-settings] Error updating settings:',
      redactPlatformSettingSecrets(msg, suppliedSecrets),
    );
    return NextResponse.json({ error: 'Failed to update platform settings.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
