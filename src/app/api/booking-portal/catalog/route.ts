export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/booking-portal/catalog
 *
 * Read-only endpoint for Internal Booking Portal staff (/booking-portal,
 * /booking-portal/new, /booking-portal/customer-requests) returning the
 * tenant's dynamic Transport Services catalogue: enabled categories (built-in
 * and custom), dynamic module mapping (SERVICE_MODULE_MAP overrides), field
 * overrides, custom sections/fields, effective forms, and default values.
 *
 * Guarded by standard booking-portal module policy + requireAuthorizedTenant().
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { getTenantCatalog } from '@/lib/transport-catalog/store';
import { captureException } from '@/lib/sentry';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const categories = await getTenantCatalog(authz.tenantId);
    return NextResponse.json({ ok: true, categories });
  } catch (err) {
    captureException(err, { context: 'booking-portal.catalog.list', extra: { tenantId: authz.tenantId } });
    return NextResponse.json({ ok: false, error: 'Failed to load booking portal catalogue' }, { status: 500 });
  }
}
