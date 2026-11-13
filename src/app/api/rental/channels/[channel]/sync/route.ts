export const dynamic = 'force-dynamic';

/**
 * GET  /api/rental/channels/[channel]/sync — preview live OTA Availability, Rates & Inventory (ARI) feed
 * POST /api/rental/channels/[channel]/sync — 3-Phase outbound ARI push (DB read -> external HTTPS POST -> last_sync_at stamp)
 *
 * Security invariants:
 *   - GET requires `rental:view:channels` (`rental:view:*`); POST requires `rental:edit:channels` (RAC_MANAGER / TENANT_ADMIN).
 *   - External HTTP `fetch()` executes strictly OUTSIDE `withTenantRls` so database connections
 *     and advisory/row locks are never held across network I/O.
 *   - `outbound_webhook_url` is validated with `validateOutboundWebhookUrl` (HTTPS-only, blocks
 *     loopback, RFC1918 private networks, link-local & cloud metadata IPs, and disables redirects).
 */

import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  buildOutboundAriPayload,
  getChannel,
  signOutboundAriPayload,
  validateOutboundWebhookUrl,
  type OutboundAriCategoryInput,
} from '@/lib/rental-channels';
import {
  calculateRate,
  categoriesMatch,
  normalizePricingRuleRow,
  normalizeRentalCategory,
  type PricingRuleRow,
} from '@/lib/rental-rate-engine';
import { RENTAL_VEHICLE_CATEGORIES } from '@/lib/rental/categories';
import { withSavepoint } from '@/lib/rental/locks';
import { deriveTenantChannelSecret } from '@/lib/rental/security-guards';
import { findGroundingBlocks } from '@/lib/fleet/grounding-blocks';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface SyncConfigRow {
  webhook_secret: string | null;
  is_active: boolean | null;
  commission_pct?: string | number | null;
  default_markup_pct?: string | number | null;
  auto_confirm?: boolean | null;
  outbound_webhook_url?: string | null;
  last_sync_at?: Date | string | null;
}

interface FleetVehicleRow {
  id: string;
  cat: string;
  status: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function readChannelSyncStateInTx(
  tx: TxClient,
  tenantId: string,
  channelKey: string,
  windowStart: Date,
  windowEnd: Date,
  markupOverride?: number,
) {
  // 1. Read channel configuration (savepoint-guarded for new columns)
  let cfgRows = await withSavepoint<SyncConfigRow[] | null>(
    tx,
    'ari_sync_cfg_ext',
    () =>
      tx.$queryRawUnsafe<SyncConfigRow[]>(
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
        channelKey,
      ),
    null,
  );
  if (cfgRows === null) {
    cfgRows = await withSavepoint<SyncConfigRow[]>(
      tx,
      'ari_sync_cfg_base',
      () =>
        tx.$queryRawUnsafe<SyncConfigRow[]>(
          `SELECT webhook_secret, is_active
             FROM rental_channel_configs
            WHERE tenant_id::text = $1 AND channel_key = $2
            LIMIT 1`,
          tenantId,
          channelKey,
        ),
      [],
    );
  }
  const cfg = cfgRows[0];
  const isActive = cfg ? cfg.is_active !== false : true;
  const commissionPct = round2(Number(cfg?.commission_pct ?? 0));
  const defaultMarkupPct =
    markupOverride !== undefined
      ? round2(markupOverride)
      : round2(Number(cfg?.default_markup_pct ?? 0));
  const outboundWebhookUrl = cfg?.outbound_webhook_url
    ? String(cfg.outbound_webhook_url).trim() || null
    : null;
  const lastSyncAt = cfg?.last_sync_at
    ? cfg.last_sync_at instanceof Date
      ? cfg.last_sync_at.toISOString()
      : String(cfg.last_sync_at)
    : null;
  const customSecret = cfg?.webhook_secret?.trim() || null;

  // 2. Read active tenant vehicles
  const fleetRows = await withSavepoint<FleetVehicleRow[]>(
    tx,
    'ari_sync_fleet',
    () =>
      tx.$queryRawUnsafe<FleetVehicleRow[]>(
        `SELECT v.id::text AS id,
                COALESCE(
                  NULLIF(TRIM(to_jsonb(v)->>'category'), ''),
                  NULLIF(TRIM(to_jsonb(v)->>'vehicle_group'), ''),
                  NULLIF(TRIM(to_jsonb(v)->>'vehicle_class'), ''),
                  NULLIF(TRIM(to_jsonb(v)->>'type'), ''),
                  'ECONOMY'
                ) AS cat,
                UPPER(COALESCE(v.status::text, 'AVAILABLE')) AS status
           FROM vehicles v
          WHERE v.tenant_id::text = $1
            AND v.deleted_at IS NULL
            AND COALESCE(v.is_active, true) = true
            AND UPPER(COALESCE(v.status::text, 'AVAILABLE')) NOT IN ('INACTIVE', 'SOLD', 'DECOMMISSIONED')`,
        tenantId,
      ),
    [],
  );

  // 3. Collect unavailable vehicle IDs across bookings, agreements, workshop WOs, transfers & grounding
  const busyVehicleIds = new Set<string>();

  for (const v of fleetRows) {
    if (
      ['MAINTENANCE', 'OUT_OF_SERVICE', 'GROUNDED', 'RENTED', 'PENDING_INSPECTION'].includes(
        v.status,
      )
    ) {
      busyVehicleIds.add(v.id);
    }
  }

  const overlappingBookings = await withSavepoint<Array<{ vehicle_id: string | null; vehicle_category: string | null }>>(
    tx,
    'ari_sync_bookings',
    () =>
      tx.$queryRawUnsafe<Array<{ vehicle_id: string | null; vehicle_category: string | null }>>(
        `SELECT vehicle_id, vehicle_category
           FROM rental_bookings
          WHERE tenant_id::text = $1
            AND deleted_at IS NULL
            AND status IN ('CONFIRMED', 'ACTIVE')
            AND pickup_date < $3::timestamptz
            AND dropoff_date > $2::timestamptz`,
        tenantId,
        windowStart.toISOString(),
        windowEnd.toISOString(),
      ),
    [],
  );
  const unassignedBookingsByCat = new Map<string, number>();
  for (const b of overlappingBookings) {
    if (b.vehicle_id) {
      busyVehicleIds.add(b.vehicle_id);
    } else if (b.vehicle_category) {
      const normCat = normalizeRentalCategory(b.vehicle_category) || b.vehicle_category.toUpperCase();
      unassignedBookingsByCat.set(normCat, (unassignedBookingsByCat.get(normCat) ?? 0) + 1);
    }
  }

  const overlappingAgreements = await withSavepoint<Array<{ vehicle_id: string | null }>>(
    tx,
    'ari_sync_agreements',
    () =>
      tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
        `SELECT vehicle_id
           FROM rental_agreements
          WHERE tenant_id::text = $1
            AND deleted_at IS NULL
            AND status IN ('DRAFT', 'ACTIVE')
            AND vehicle_id IS NOT NULL
            AND start_date < $3::timestamptz
            AND end_date > $2::timestamptz`,
        tenantId,
        windowStart.toISOString(),
        windowEnd.toISOString(),
      ),
    [],
  );
  for (const a of overlappingAgreements) {
    if (a.vehicle_id) busyVehicleIds.add(a.vehicle_id);
  }

  const openWorkOrders = await withSavepoint<Array<{ vehicle_id: string }>>(
    tx,
    'ari_sync_wo',
    () =>
      tx.$queryRawUnsafe<Array<{ vehicle_id: string }>>(
        `SELECT DISTINCT mr.vehicle_id::text AS vehicle_id
           FROM "WorkOrder" wo
           JOIN maintenance_requests mr ON mr.id::text = wo."requestId"::text
          WHERE wo.tenant_id::text = $1
            AND mr.deleted_at IS NULL
            AND mr.vehicle_id IS NOT NULL
            AND UPPER(COALESCE(wo.status::text, '')) NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')`,
        tenantId,
      ),
    [],
  );
  for (const wo of openWorkOrders) {
    if (wo.vehicle_id) busyVehicleIds.add(wo.vehicle_id);
  }

  const candidateIds = fleetRows.filter((v) => !busyVehicleIds.has(v.id)).map((v) => v.id);
  if (candidateIds.length > 0) {
    const groundingMap = await withSavepoint(
      tx,
      'ari_sync_grounding',
      () => findGroundingBlocks(tx, tenantId, candidateIds),
      new Map(),
    );
    for (const [vehId, blocks] of groundingMap.entries()) {
      if (Array.isArray(blocks) && blocks.length > 0) {
        busyVehicleIds.add(vehId);
      }
    }
  }

  // 4. Read canonical pricing_rules + active rate_events
  const pricingRules = await withSavepoint<PricingRuleRow[]>(
    tx,
    'ari_sync_rules',
    () =>
      tx.$queryRawUnsafe<PricingRuleRow[]>(
        `SELECT *
           FROM pricing_rules
          WHERE tenant_id::text = $1 AND is_active = true
          ORDER BY priority DESC`,
        tenantId,
      ),
    [],
  );

  const eventRows = await withSavepoint<Record<string, unknown>[]>(
    tx,
    'ari_sync_events',
    () =>
      tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT *
           FROM rate_events
          WHERE tenant_id::text = $1
            AND deleted_at IS NULL
            AND is_active = true
            AND date_from <= $3::timestamptz
            AND date_to >= $2::timestamptz`,
        tenantId,
        windowStart.toISOString(),
        windowEnd.toISOString(),
      ),
    [],
  );

  const rateEvents = eventRows.map((e) => ({
    id: String(e.id ?? ''),
    eventCode: String(e.event_code ?? e.eventCode ?? e.name ?? ''),
    name: String(e.name ?? ''),
    dateFrom: new Date(String(e.date_from ?? e.dateFrom ?? windowStart.toISOString())),
    dateTo: new Date(String(e.date_to ?? e.dateTo ?? windowEnd.toISOString())),
    multiplier: Number(e.multiplier ?? 1),
    flatSurcharge: Number(e.flat_surcharge ?? e.flatSurcharge ?? 0),
    applicableCategories: (e.applicable_categories ?? e.applicableCategories ?? null) as string | null,
    applicableChannels: (e.applicable_channels ?? e.applicableChannels ?? null) as string | null,
    priority: Number(e.priority ?? 0),
    isActive: (e.is_active ?? e.isActive ?? true) !== false,
  }));

  // 5. Aggregate per-category fleet inventory + canonical tariff
  const normalizedRules = pricingRules.map(normalizePricingRuleRow);
  const categorySet = new Set<string>(RENTAL_VEHICLE_CATEGORIES.map((c) => c.value));
  for (const r of normalizedRules) {
    const norm = normalizeRentalCategory(r.vehicle_category);
    if (norm) categorySet.add(norm);
  }
  for (const v of fleetRows) {
    const norm = normalizeRentalCategory(v.cat);
    if (norm) categorySet.add(norm);
  }

  const categoriesInput: OutboundAriCategoryInput[] = [];
  for (const cat of categorySet) {
    const matchingVehicles = fleetRows.filter((v) => categoriesMatch(v.cat, cat));
    const totalUnits = matchingVehicles.length;
    const freePhysical = matchingVehicles.filter((v) => !busyVehicleIds.has(v.id)).length;
    const unassignedSoftHolds = unassignedBookingsByCat.get(cat) ?? 0;
    const availableUnits = Math.max(0, freePhysical - unassignedSoftHolds);

    const matchingRule = normalizedRules.find((r) => categoriesMatch(r.vehicle_category, cat));
    if (totalUnits === 0 && !matchingRule) continue;

    const utilizationPct =
      totalUnits > 0 ? Math.round(((totalUnits - availableUnits) / totalUnits) * 100) : 0;

    const oneDayQuote = calculateRate(pricingRules, {
      vehicleCategory: cat,
      pickupDate: windowStart,
      dropoffDate: windowEnd,
      channel: 'ONLINE',
      events: rateEvents,
      fleetUtilizationPct: utilizationPct,
      totalCategoryFleet: totalUnits,
    });

    categoriesInput.push({
      category: cat,
      availableUnits,
      totalUnits,
      baseDailyRate: oneDayQuote.dailyRate,
      weeklyRate: matchingRule?.weekly_rate ?? (oneDayQuote.dailyRate > 0 ? round2(oneDayQuote.dailyRate * 7 * 0.9) : null),
      monthlyRate: matchingRule?.monthly_rate ?? (oneDayQuote.dailyRate > 0 ? round2(oneDayQuote.dailyRate * 30 * 0.78) : null),
      currency: oneDayQuote.currency || 'AED',
    });
  }

  const ari = buildOutboundAriPayload({
    tenantId,
    channelKey,
    markupPct: defaultMarkupPct,
    categories: categoriesInput,
  });

  return {
    isActive,
    commissionPct,
    defaultMarkupPct,
    outboundWebhookUrl,
    lastSyncAt,
    customSecret,
    ari,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'channels',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const { channel: channelParam } = await params;
  const descriptor = getChannel(channelParam);
  if (!descriptor) {
    return NextResponse.json({ error: `Unknown channel: ${channelParam}` }, { status: 404 });
  }
  if (!descriptor.supportsOutboundSync) {
    return NextResponse.json(
      { error: `Channel ${descriptor.key} does not support outbound ARI sync` },
      { status: 400 },
    );
  }

  const pickupParam = req.nextUrl.searchParams.get('pickupDate');
  const dropoffParam = req.nextUrl.searchParams.get('dropoffDate');
  const now = new Date();
  const windowStart = pickupParam ? new Date(pickupParam) : now;
  const windowEnd = dropoffParam
    ? new Date(dropoffParam)
    : new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  if (
    Number.isNaN(windowStart.getTime()) ||
    Number.isNaN(windowEnd.getTime()) ||
    windowEnd <= windowStart
  ) {
    return NextResponse.json({ error: 'Invalid pickupDate/dropoffDate window' }, { status: 400 });
  }

  try {
    const snapshot = await withTenantRls(prisma, tenantId, async (tx) => {
      return readChannelSyncStateInTx(tx, tenantId, descriptor.key, windowStart, windowEnd);
    });

    return NextResponse.json({
      ok: true,
      tenantId,
      channel: descriptor.key,
      label: descriptor.label,
      config: {
        isActive: snapshot.isActive,
        commissionPct: snapshot.commissionPct,
        defaultMarkupPct: snapshot.defaultMarkupPct,
        outboundWebhookUrl: snapshot.outboundWebhookUrl,
        lastSyncAt: snapshot.lastSyncAt,
      },
      ari: snapshot.ari,
    });
  } catch (err) {
    captureException(err, { context: 'rental.channels.sync.GET' });
    return NextResponse.json({ error: 'Failed to generate live ARI feed' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
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

  const { channel: channelParam } = await params;
  const descriptor = getChannel(channelParam);
  if (!descriptor) {
    return NextResponse.json({ error: `Unknown channel: ${channelParam}` }, { status: 404 });
  }
  if (!descriptor.supportsOutboundSync) {
    return NextResponse.json(
      { error: `Channel ${descriptor.key} does not support outbound ARI sync` },
      { status: 400 },
    );
  }

  const rawJson = await req.json().catch(() => ({}));
  const rawObj =
    rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)
      ? (rawJson as Record<string, unknown>)
      : {};
  const body = stripTenantOwnershipFields(rawObj);

  let markupOverride: number | undefined;
  if (body.markupPct !== undefined && body.markupPct !== null && body.markupPct !== '') {
    const parsedMarkup = Number(body.markupPct);
    if (!Number.isFinite(parsedMarkup) || parsedMarkup < -50 || parsedMarkup > 500) {
      return NextResponse.json(
        { error: 'markupPct must be between -50 and 500' },
        { status: 400 },
      );
    }
    markupOverride = round2(parsedMarkup);
  }

  const now = new Date();
  const windowStart =
    typeof body.pickupDate === 'string' && body.pickupDate ? new Date(body.pickupDate) : now;
  const windowEnd =
    typeof body.dropoffDate === 'string' && body.dropoffDate
      ? new Date(body.dropoffDate)
      : new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  if (
    Number.isNaN(windowStart.getTime()) ||
    Number.isNaN(windowEnd.getTime()) ||
    windowEnd <= windowStart
  ) {
    return NextResponse.json({ error: 'Invalid pickupDate/dropoffDate window' }, { status: 400 });
  }

  try {
    // ── Phase 1 (Inside `withTenantRls`): Build live ARI feed & read channel config ──
    const phase1 = await withTenantRls(prisma, tenantId, async (tx) => {
      return readChannelSyncStateInTx(
        tx,
        tenantId,
        descriptor.key,
        windowStart,
        windowEnd,
        markupOverride,
      );
    });

    if (!phase1.isActive) {
      return NextResponse.json(
        { error: `Channel ${descriptor.label} is disabled for this tenant` },
        { status: 403 },
      );
    }

    const envSecret = descriptor.secretEnvVar ? process.env[descriptor.secretEnvVar] ?? null : null;
    const signingSecret =
      phase1.customSecret ??
      (envSecret ? deriveTenantChannelSecret(envSecret, tenantId, descriptor.key) : null) ??
      deriveTenantChannelSecret('fleet360-ari-sandbox-signing-key', tenantId, descriptor.key);

    const payloadJson = JSON.stringify(phase1.ari);
    const signature = signOutboundAriPayload(payloadJson, signingSecret);

    // ── Phase 2 (Strictly OUTSIDE `withTenantRls`): Dispatch outbound ARI webhook if configured ──
    let syncMode: 'WEBHOOK_PUSHED' | 'SANDBOX_SYNCED' = 'SANDBOX_SYNCED';
    let partnerHttpStatus: number | null = null;
    let safeTargetUrl: string | null = null;

    if (phase1.outboundWebhookUrl) {
      try {
        safeTargetUrl = validateOutboundWebhookUrl(phase1.outboundWebhookUrl);
      } catch (err) {
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? `Invalid outboundWebhookUrl: ${err.message}`
                : 'Invalid outboundWebhookUrl',
          },
          { status: 400 },
        );
      }

      if (safeTargetUrl) {
        const res = await fetch(safeTargetUrl, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            'X-Fleet360-Signature': signature,
            'X-Channel-Signature': signature,
            'X-Fleet360-Channel': descriptor.key,
            'X-OTA-Tenant-Id': tenantId,
          },
          body: payloadJson,
        });
        partnerHttpStatus = res.status;
        if (!res.ok) {
          return NextResponse.json(
            {
              ok: false,
              error: `Outbound partner ARI endpoint returned HTTP ${res.status}`,
              partnerHttpStatus,
            },
            { status: 502 },
          );
        }
        syncMode = 'WEBHOOK_PUSHED';
      }
    }

    const syncedAt = new Date().toISOString();

    // ── Phase 3 (Inside `withTenantRls`): Stamp `last_sync_at = NOW()` via savepoint ──
    await withTenantRls(prisma, tenantId, async (tx) => {
      const updatedRows = await withSavepoint<number>(
        tx,
        'ari_sync_stamp_update',
        () =>
          tx.$executeRawUnsafe(
            `UPDATE rental_channel_configs
                SET last_sync_at = NOW(),
                    updated_at = NOW()
              WHERE tenant_id::text = $1 AND channel_key = $2`,
            tenantId,
            descriptor.key,
          ),
        0,
      );

      if (Number(updatedRows) === 0) {
        const generatedSecret = randomBytes(32).toString('hex');
        await withSavepoint(
          tx,
          'ari_sync_stamp_insert',
          () =>
            tx.$executeRawUnsafe(
              `INSERT INTO rental_channel_configs (
                 tenant_id,
                 channel_key,
                 webhook_secret,
                 is_active,
                 last_sync_at,
                 updated_at
               )
               VALUES ($1, $2, $3, true, NOW(), NOW())
               ON CONFLICT (tenant_id, channel_key)
               DO UPDATE SET last_sync_at = NOW(), updated_at = NOW()`,
              tenantId,
              descriptor.key,
              generatedSecret,
            ),
          0,
        );
      }
    });

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RentalChannelConfig',
      entityId: `${tenantId}:${descriptor.key}`,
      entityName: descriptor.key,
      action: 'EXPORT',
      details: `Pushed live ARI sync for ${descriptor.label} (mode=${syncMode}, categories=${phase1.ari.summary.totalCategories}, availableUnits=${phase1.ari.summary.availableUnits}, markup=${phase1.ari.markupPct}%)`,
    });

    return NextResponse.json({
      ok: true,
      mode: syncMode,
      syncedAt,
      channel: descriptor.key,
      label: descriptor.label,
      outboundWebhookUrl: safeTargetUrl,
      partnerHttpStatus,
      signaturePreview: `sha256=${signature.slice(0, 12)}…`,
      ari: phase1.ari,
    });
  } catch (err) {
    captureException(err, { context: 'rental.channels.sync.POST' });
    return NextResponse.json({ error: 'Outbound ARI sync failed' }, { status: 500 });
  }
}
