/**
 * POST /api/logistics/accessorials/preview
 *
 * Preview which accessorial rules would auto-apply for a given shipment,
 * WITHOUT writing to logistics_freight_charges. Two callers:
 *
 *   - The new-shipment form (so the operator sees "this booking will
 *     pick up FUEL +80 AED and MULTI_DROP +60 AED automatically")
 *   - The accessorial rule editor (so the rate manager can write a
 *     rule and immediately see "this fires on shipment X but not on
 *     shipment Y" before saving)
 *
 * Body: AccessorialContext (see accessorial-engine.ts) — every field
 *       optional, but rules with conditions on a missing field won't fire.
 *
 * Response: { applied: AppliedAccessorial[] }
 *
 * Auth: tenant operator session. Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAccessorialCatalog } from '@/lib/logistics/domain';
import {
  applyAccessorialCatalog,
  type AccessorialContext,
  type CatalogEntry,
} from '@/lib/logistics/accessorial-engine';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: Partial<AccessorialContext>;
  try { body = (await req.json()) as Partial<AccessorialContext>; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  try {
    const rawCatalog = await listAccessorialCatalog({
      tenantId, status: 'ACTIVE', limit: 500,
    });
    const catalog: CatalogEntry[] = rawCatalog.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      chargeType: r.chargeType,
      defaultAmount: r.defaultAmount,
      currency: r.currency,
      taxable: r.taxable,
      autoApplyRule: r.autoApplyRule,
      status: r.status,
    }));

    const applied = applyAccessorialCatalog(catalog, body as AccessorialContext);

    // Roll up totals so the UI doesn't have to.
    const subtotal = applied.reduce((s, a) => s + a.amount, 0);
    return NextResponse.json({
      applied,
      subtotal: Math.round(subtotal * 100) / 100,
      currency: applied[0]?.currency ?? 'AED',
    }, {
      headers: { 'Cache-Control': 'private, max-age=10' },
    });
  } catch (e) {
    console.error('[accessorials/preview]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'preview failed' },
      { status: 500 },
    );
  }
}
