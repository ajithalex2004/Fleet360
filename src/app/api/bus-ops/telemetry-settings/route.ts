import { requireBusOpsRequest } from '@/lib/bus-ops/access';
export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/telemetry-settings — per-tenant auto Start / Complete tuning
 * for trips driven by GPS telemetry (Bus Ops → Settings).
 *
 * GET: the tenant's settings (defaults when none are saved), the formulas
 * used when a value is left blank, and the process-level env override if
 * one is set (env still wins; see applyTelemetrySettingsToEnv).
 * PUT: validate and save. Needs the bus-ops admin permission, the same
 * gate as the other bus-ops engine settings (Tenant Admin, Super Admin and
 * the roles granted bus-ops:admin, which includes Transport Operator).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';
import {
  getTelemetrySettings,
  upsertTelemetrySettings,
  validateTelemetrySettingsPatch,
} from '@/lib/bus-ops/telemetry-settings';
import type { PrismaClient } from '@prisma/client';

const FORMULAS = {
  hysteresis: 'Hysteresis H = clamp(max(15 m, 1.0·σ + 0.22·R_enter), 15 m, 60 m), σ = GPS accuracy',
  startDwell: 'Start dwell = clamp(max(20 s, H / v_start + 2 pings), 20 s, 90 s)',
  completeDwell: 'Complete dwell = clamp(max(90 s, R_enter / v_crawl + 60 s alighting), 90 s, 300 s)',
};

function envOverride() {
  const mode = process.env.TELEMETRY_TRIP_MODE?.trim();
  return { mode: mode || null };
}

export async function GET(req: NextRequest) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const settings = await withTenantRls(prisma, tenantId, (tx) =>
      getTelemetrySettings(tx as unknown as PrismaClient, tenantId),
    );
    return NextResponse.json(
      { settings, formulas: FORMULAS, envOverride: envOverride() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[bus-ops/telemetry-settings] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load telemetry settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permError = await requireBusOpsAdminAccess(req, 'planning-core');
  if (permError) return permError;

  const bodyRaw = await req.json().catch(() => null);
  if (!bodyRaw || typeof bodyRaw !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const checked = validateTelemetrySettingsPatch(
    stripTenantOwnershipFields(bodyRaw as Record<string, unknown>),
  );
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  try {
    const settings = await withTenantRls(prisma, tenantId, (tx) =>
      upsertTelemetrySettings(
        tx as unknown as PrismaClient,
        tenantId,
        checked.data,
        req.headers.get('x-user-id'),
      ),
    );
    return NextResponse.json({ settings, formulas: FORMULAS, envOverride: envOverride() });
  } catch (e) {
    console.error('[bus-ops/telemetry-settings] PUT failed:', e);
    return NextResponse.json({ error: 'Failed to save telemetry settings' }, { status: 500 });
  }
}
