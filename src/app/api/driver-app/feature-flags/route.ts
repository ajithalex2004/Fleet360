/**
 * src/app/api/driver-app/feature-flags/route.ts
 *
 * GET /api/driver-app/feature-flags
 *
 * Returns per-tenant feature flags for the driver app. Today only
 * `dvirEnabled` is exposed; the today page uses it to gate the
 * Pre-trip / Post-trip DVIR buttons.
 *
 * Source of truth (for now): the `DRIVER_DVIR_ENABLED_TENANTS` env
 * var, a comma-separated list of tenant UUIDs that have opted in.
 * Default = disabled for every tenant.
 *
 * The list is loaded once per process (it's a small in-memory
 * Set), and the response is cached for 5 minutes per driver
 * (private, since the value is tenant-scoped). When the admin UI
 * is built, this endpoint can swap to read from a `tenant_settings`
 * table without changing the contract.
 */

import { NextRequest, NextResponse } from 'next/server';
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
  const { tenantId } = authz;

  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const enabled = getEnabledTenants();
  const dvirEnabled = enabled.has(ctx.tenantId);

  return NextResponse.json(
    { dvirEnabled },
    { headers: { 'Cache-Control': privateCacheControl(300, 300) } },
  );
}
