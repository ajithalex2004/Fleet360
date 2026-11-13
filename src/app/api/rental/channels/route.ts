export const dynamic = 'force-dynamic';

/**
 * GET  /api/rental/channels — list channel registry with tenantId, webhook URLs, booking counts & ARI config
 * POST /api/rental/channels — configure or rotate per-tenant channel settings & webhook secret
 * PUT  /api/rental/channels — update per-tenant channel configuration (markup, commission, auto-confirm, ARI URL)
 *
 * Security invariants:
 *   - GET requires `rental:view:*` and NEVER returns raw `webhook_secret` values (only masked tail preview).
 *   - POST / PUT require `rental:edit:channels` (RAC_MANAGER / TENANT_ADMIN), sanitize bodies via
 *     `stripTenantOwnershipFields`, validate `outboundWebhookUrl` against SSRF, and upsert per-tenant
 *     `rental_channel_configs` rows via savepoint-guarded parameterized SQL.
 */

import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import {
  CHANNELS,
  buildChannelWebhookUrl,
  getChannel,
  validateOutboundWebhookUrl,
} from '@/lib/rental-channels';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface ChannelConfigStatusRow {
  channel_key: string;
  is_active: boolean;
  has_secret: boolean;
  secret_tail?: string | null;
  commission_pct?: string | number | null;
  default_markup_pct?: string | number | null;
  auto_confirm?: boolean | null;
  outbound_webhook_url?: string | null;
  last_sync_at?: Date | string | null;
  updated_at: Date | string | null;
}

interface ExistingChannelConfigRow {
  webhook_secret: string | null;
  is_active: boolean | null;
  commission_pct?: string | number | null;
  default_markup_pct?: string | number | null;
  auto_confirm?: boolean | null;
  outbound_webhook_url?: string | null;
  last_sync_at?: Date | string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function maskSecretTail(tail: string | null | undefined, hasSecret: boolean): string | null {
  if (!hasSecret) return null;
  const clean = String(tail ?? '').trim();
  return clean ? `whsec_••••••••${clean}` : 'whsec_••••••••';
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    '*',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const baseOrigin =
    req.nextUrl?.origin || process.env.NEXT_PUBLIC_APP_URL || 'https://app.fleet360.ae';

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const grouped = await tx.rentalBooking.groupBy({
        by: ['channel'],
        where: { tenantId, deletedAt: null },
        _count: { _all: true },
        _max: { createdAt: true },
      });
      const byKey = new Map(grouped.map((g) => [g.channel ?? 'DIRECT', g]));

      let configRows = await withSavepoint<ChannelConfigStatusRow[] | null>(
        tx,
        'channel_cfg_status_ext',
        () =>
          tx.$queryRawUnsafe<ChannelConfigStatusRow[]>(
            `SELECT channel_key,
                    is_active,
                    (LENGTH(TRIM(COALESCE(webhook_secret, ''))) > 0) AS has_secret,
                    RIGHT(TRIM(COALESCE(webhook_secret, '')), 4) AS secret_tail,
                    commission_pct,
                    default_markup_pct,
                    auto_confirm,
                    outbound_webhook_url,
                    last_sync_at,
                    updated_at
               FROM rental_channel_configs
              WHERE tenant_id::text = $1`,
            tenantId,
          ),
        null,
      );

      if (configRows === null) {
        configRows = await withSavepoint<ChannelConfigStatusRow[]>(
          tx,
          'channel_cfg_status_base',
          () =>
            tx.$queryRawUnsafe<ChannelConfigStatusRow[]>(
              `SELECT channel_key,
                      is_active,
                      (LENGTH(TRIM(COALESCE(webhook_secret, ''))) > 0) AS has_secret,
                      RIGHT(TRIM(COALESCE(webhook_secret, '')), 4) AS secret_tail,
                      updated_at
                 FROM rental_channel_configs
                WHERE tenant_id::text = $1`,
              tenantId,
            ),
          [],
        );
      }

      const cfgByKey = new Map(
        configRows.map((r) => [String(r.channel_key).toUpperCase(), r]),
      );

      const channels = CHANNELS.map((c) => {
        const stat = byKey.get(c.key);
        const cfg = cfgByKey.get(c.key);
        const hasCustomSecret = Boolean(cfg?.has_secret);
        const isActive = cfg ? Boolean(cfg.is_active) : true;
        const envConfigured = c.secretEnvVar ? Boolean(process.env[c.secretEnvVar]) : true;
        const configured =
          isActive && (c.supportsInboundWebhook ? hasCustomSecret || envConfigured : true);

        const commissionPct =
          cfg?.commission_pct != null && Number.isFinite(Number(cfg.commission_pct))
            ? round2(Number(cfg.commission_pct))
            : 0;
        const defaultMarkupPct =
          cfg?.default_markup_pct != null && Number.isFinite(Number(cfg.default_markup_pct))
            ? round2(Number(cfg.default_markup_pct))
            : 0;
        const autoConfirm = Boolean(cfg?.auto_confirm ?? false);
        const outboundWebhookUrl = cfg?.outbound_webhook_url
          ? String(cfg.outbound_webhook_url)
          : null;
        const lastSyncAt = cfg?.last_sync_at
          ? cfg.last_sync_at instanceof Date
            ? cfg.last_sync_at.toISOString()
            : String(cfg.last_sync_at)
          : null;

        return {
          tenantId,
          key: c.key,
          label: c.label,
          category: c.category,
          supportsInboundWebhook: c.supportsInboundWebhook,
          supportsOutboundSync: c.supportsOutboundSync,
          configured,
          isActive,
          hasCustomSecret,
          secretPreview: maskSecretTail(cfg?.secret_tail, hasCustomSecret),
          commissionPct,
          defaultMarkupPct,
          autoConfirm,
          outboundWebhookUrl,
          lastSyncAt,
          webhookUrl: c.supportsInboundWebhook
            ? buildChannelWebhookUrl(baseOrigin, c.key, tenantId)
            : null,
          description: c.description,
          bookingCount: stat?._count._all ?? 0,
          lastBookingAt: stat?._max.createdAt ?? null,
          updatedAt: cfg?.updated_at ?? null,
        };
      });

      return NextResponse.json({
        ok: true,
        tenantId,
        channels,
      });
    } catch (err) {
      captureException(err, { context: 'rental.channels.GET' });
      return NextResponse.json({ error: 'Failed to load channels' }, { status: 500 });
    }
  });
}

async function validateAndSaveChannelConfig(
  tx: TxClient,
  tenantId: string,
  baseOrigin: string,
  body: Record<string, unknown>,
) {
  const channelInput =
    typeof body.channel === 'string'
      ? body.channel.trim()
      : typeof body.channelKey === 'string'
        ? body.channelKey.trim()
        : '';

  if (!channelInput) {
    return { ok: false as const, status: 400, error: 'channel is required' };
  }

  const descriptor = getChannel(channelInput);
  if (!descriptor) {
    return { ok: false as const, status: 404, error: `Unknown channel: ${channelInput}` };
  }
  if (!descriptor.supportsInboundWebhook && !descriptor.supportsOutboundSync) {
    return {
      ok: false as const,
      status: 400,
      error: `Channel ${descriptor.key} is an internal counter channel and does not use external OTA configuration`,
    };
  }

  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    return { ok: false as const, status: 400, error: 'isActive must be a boolean' };
  }
  if (body.autoConfirm !== undefined && typeof body.autoConfirm !== 'boolean') {
    return { ok: false as const, status: 400, error: 'autoConfirm must be a boolean' };
  }

  let parsedCommission: number | undefined;
  if (body.commissionPct !== undefined && body.commissionPct !== null && body.commissionPct !== '') {
    const n = Number(body.commissionPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { ok: false as const, status: 400, error: 'commissionPct must be between 0 and 100' };
    }
    parsedCommission = round2(n);
  }

  let parsedMarkup: number | undefined;
  if (
    body.defaultMarkupPct !== undefined &&
    body.defaultMarkupPct !== null &&
    body.defaultMarkupPct !== ''
  ) {
    const n = Number(body.defaultMarkupPct);
    if (!Number.isFinite(n) || n < -50 || n > 500) {
      return {
        ok: false as const,
        status: 400,
        error: 'defaultMarkupPct must be between -50 and 500',
      };
    }
    parsedMarkup = round2(n);
  }

  let parsedOutboundUrl: string | null | undefined;
  if (body.outboundWebhookUrl !== undefined) {
    try {
      parsedOutboundUrl = validateOutboundWebhookUrl(body.outboundWebhookUrl);
    } catch (err) {
      return {
        ok: false as const,
        status: 400,
        error: err instanceof Error ? err.message : 'Invalid outboundWebhookUrl',
      };
    }
  }

  const rotateSecret = body.rotateSecret === true;
  const hasExplicitSecret =
    body.webhookSecret !== undefined && body.webhookSecret !== null && body.webhookSecret !== '';
  let suppliedSecret: string | null = null;

  if (hasExplicitSecret) {
    if (typeof body.webhookSecret !== 'string') {
      return { ok: false as const, status: 400, error: 'webhookSecret must be a string' };
    }
    const trimmed = body.webhookSecret.trim();
    if (trimmed.length < 16 || trimmed.length > 256) {
      return {
        ok: false as const,
        status: 400,
        error: 'webhookSecret must be between 16 and 256 characters',
      };
    }
    suppliedSecret = trimmed;
  }

  let existingRows = await withSavepoint<ExistingChannelConfigRow[] | null>(
    tx,
    'channel_cfg_read_ext',
    () =>
      tx.$queryRawUnsafe<ExistingChannelConfigRow[]>(
        `SELECT webhook_secret,
                is_active,
                commission_pct,
                default_markup_pct,
                auto_confirm,
                outbound_webhook_url,
                last_sync_at
           FROM rental_channel_configs
          WHERE tenant_id::text = $1 AND channel_key = $2
          LIMIT 1`,
        tenantId,
        descriptor.key,
      ),
    null,
  );

  if (existingRows === null) {
    existingRows = await withSavepoint<ExistingChannelConfigRow[]>(
      tx,
      'channel_cfg_read_base',
      () =>
        tx.$queryRawUnsafe<ExistingChannelConfigRow[]>(
          `SELECT webhook_secret, is_active
             FROM rental_channel_configs
            WHERE tenant_id::text = $1 AND channel_key = $2
            LIMIT 1`,
          tenantId,
          descriptor.key,
        ),
      [],
    );
  }

  const existing = existingRows[0];

  let nextSecret: string;
  let secretIssued = false;
  if (suppliedSecret) {
    nextSecret = suppliedSecret;
    secretIssued = true;
  } else if (rotateSecret || !existing?.webhook_secret?.trim()) {
    nextSecret = randomBytes(32).toString('hex');
    secretIssued = true;
  } else {
    nextSecret = existing.webhook_secret.trim();
  }

  const nextIsActive =
    typeof body.isActive === 'boolean' ? body.isActive : (existing?.is_active ?? true);
  const nextCommission =
    parsedCommission !== undefined
      ? parsedCommission
      : round2(Number(existing?.commission_pct ?? 0));
  const nextMarkup =
    parsedMarkup !== undefined
      ? parsedMarkup
      : round2(Number(existing?.default_markup_pct ?? 0));
  const nextAutoConfirm =
    typeof body.autoConfirm === 'boolean'
      ? body.autoConfirm
      : Boolean(existing?.auto_confirm ?? false);
  const nextOutboundUrl =
    parsedOutboundUrl !== undefined
      ? parsedOutboundUrl
      : existing?.outbound_webhook_url
        ? String(existing.outbound_webhook_url)
        : null;

  const savedExt = await withSavepoint<boolean>(
    tx,
    'channel_cfg_upsert_ext',
    async () => {
      await tx.$executeRawUnsafe(
        `INSERT INTO rental_channel_configs (
           tenant_id,
           channel_key,
           webhook_secret,
           is_active,
           commission_pct,
           default_markup_pct,
           auto_confirm,
           outbound_webhook_url,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (tenant_id, channel_key)
         DO UPDATE SET
           webhook_secret = EXCLUDED.webhook_secret,
           is_active = EXCLUDED.is_active,
           commission_pct = EXCLUDED.commission_pct,
           default_markup_pct = EXCLUDED.default_markup_pct,
           auto_confirm = EXCLUDED.auto_confirm,
           outbound_webhook_url = EXCLUDED.outbound_webhook_url,
           updated_at = NOW()`,
        tenantId,
        descriptor.key,
        nextSecret,
        nextIsActive,
        nextCommission,
        nextMarkup,
        nextAutoConfirm,
        nextOutboundUrl,
      );
      return true;
    },
    false,
  );

  if (!savedExt) {
    await tx.$executeRawUnsafe(
      `INSERT INTO rental_channel_configs (tenant_id, channel_key, webhook_secret, is_active, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_id, channel_key)
       DO UPDATE SET webhook_secret = EXCLUDED.webhook_secret,
                     is_active = EXCLUDED.is_active,
                     updated_at = NOW()`,
      tenantId,
      descriptor.key,
      nextSecret,
      nextIsActive,
    );
  }

  return {
    ok: true as const,
    data: {
      tenantId,
      channel: descriptor.key,
      isActive: nextIsActive,
      commissionPct: nextCommission,
      defaultMarkupPct: nextMarkup,
      autoConfirm: nextAutoConfirm,
      outboundWebhookUrl: nextOutboundUrl,
      hasCustomSecret: true,
      secretPreview: maskSecretTail(nextSecret.slice(-4), true),
      webhookUrl: descriptor.supportsInboundWebhook
        ? buildChannelWebhookUrl(baseOrigin, descriptor.key, tenantId)
        : null,
      secretIssued,
      webhookSecret: secretIssued ? nextSecret : undefined,
    },
  };
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'channels',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!bodyRaw || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(bodyRaw as Record<string, unknown>);
  const baseOrigin =
    req.nextUrl?.origin || process.env.NEXT_PUBLIC_APP_URL || 'https://app.fleet360.ae';

  try {
    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      return validateAndSaveChannelConfig(tx, tenantId, baseOrigin, body);
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    const saved = outcome.data;
    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      entityType: 'RentalChannelConfig',
      entityId: `${tenantId}:${saved.channel}`,
      entityName: saved.channel,
      action: 'UPDATE',
      details: `Configured channel ${saved.channel} (isActive=${saved.isActive}, markup=${saved.defaultMarkupPct}%, commission=${saved.commissionPct}%, autoConfirm=${saved.autoConfirm}, secretRotated=${saved.secretIssued})`,
    });

    return NextResponse.json({
      ok: true,
      tenantId: saved.tenantId,
      channel: saved.channel,
      isActive: saved.isActive,
      commissionPct: saved.commissionPct,
      defaultMarkupPct: saved.defaultMarkupPct,
      autoConfirm: saved.autoConfirm,
      outboundWebhookUrl: saved.outboundWebhookUrl,
      hasCustomSecret: saved.hasCustomSecret,
      secretPreview: saved.secretPreview,
      webhookUrl: saved.webhookUrl,
      ...(saved.secretIssued ? { webhookSecret: saved.webhookSecret } : {}),
    });
  } catch (err) {
    captureException(err, { context: 'rental.channels.POST' });
    return NextResponse.json({ error: 'Failed to update channel configuration' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'channels',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!bodyRaw || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(bodyRaw as Record<string, unknown>);
  const baseOrigin =
    req.nextUrl?.origin || process.env.NEXT_PUBLIC_APP_URL || 'https://app.fleet360.ae';

  try {
    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      return validateAndSaveChannelConfig(tx, tenantId, baseOrigin, body);
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    const saved = outcome.data;
    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      entityType: 'RentalChannelConfig',
      entityId: `${tenantId}:${saved.channel}`,
      entityName: saved.channel,
      action: 'UPDATE',
      details: `Updated channel ${saved.channel} (isActive=${saved.isActive}, markup=${saved.defaultMarkupPct}%, commission=${saved.commissionPct}%, autoConfirm=${saved.autoConfirm}, secretRotated=${saved.secretIssued})`,
    });

    return NextResponse.json({
      ok: true,
      tenantId: saved.tenantId,
      channel: saved.channel,
      isActive: saved.isActive,
      commissionPct: saved.commissionPct,
      defaultMarkupPct: saved.defaultMarkupPct,
      autoConfirm: saved.autoConfirm,
      outboundWebhookUrl: saved.outboundWebhookUrl,
      hasCustomSecret: saved.hasCustomSecret,
      secretPreview: saved.secretPreview,
      webhookUrl: saved.webhookUrl,
      ...(saved.secretIssued ? { webhookSecret: saved.webhookSecret } : {}),
    });
  } catch (err) {
    captureException(err, { context: 'rental.channels.PUT' });
    return NextResponse.json({ error: 'Failed to update channel configuration' }, { status: 500 });
  }
}
