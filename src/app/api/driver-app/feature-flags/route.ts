export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/feature-flags/route.ts
 *
 * GET /api/driver-app/feature-flags
 *
 * Returns per-tenant feature flags for the driver app. Today only
 * `dvirEnabled` is exposed; the today page uses it to gate the
 * Pre-trip / Post-trip DVIR buttons.
 *
 * Source of truth:
 *   1. `tenant_feature_overrides` (`driver-mgmt.dvir`), managed via
 *      Admin -> Tenants -> [Tenant] -> Modules & Feature Flags.
 *   2. Legacy fallback: the `DRIVER_DVIR_ENABLED_TENANTS` env var
 *      (comma-separated tenant UUIDs).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireDriverSession } from '@/lib/driver-session';
import { privateCacheControl } from '@/lib/server-cache';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

let cachedTenants: { raw: string; ids: Set<string> } | null = null;

function getEnabledTenants(): Set<string> {
  const raw = process.env.DRIVER_DVIR_ENABLED_TENANTS ?? '';
  if (cachedTenants?.raw === raw) return cachedTenants.ids;
  const ids = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  cachedTenants = { raw, ids };
  return ids;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const envEnabled = getEnabledTenants().has(ctx.tenantId);
  const dbOverride = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
    const row = await tx.tenantFeatureOverride.findUnique({
      where: {
        tenantId_featureKey: {
          tenantId: ctx.tenantId,
          featureKey: 'driver-mgmt.dvir',
        },
      },
      select: { isEnabled: true },
    });
    return row?.isEnabled ?? null;
  }).catch(() => null);

  const dvirEnabled = dbOverride !== null ? dbOverride : envEnabled;

  return NextResponse.json(
    { dvirEnabled },
    { headers: { 'Cache-Control': privateCacheControl(300, 300) } },
  );
}
