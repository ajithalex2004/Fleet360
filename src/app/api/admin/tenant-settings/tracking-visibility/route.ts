/**
 * GET   /api/admin/tenant-settings/tracking-visibility
 * PUT   /api/admin/tenant-settings/tracking-visibility
 *
 * Tenant-wide default tracking-visibility level — the bottom of the
 * resolution chain. Applies to any customer that hasn't had a per-customer
 * default explicitly set.
 *
 *   PUT body: { level: TrackingLevel }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  setTenantTrackingDefault,
  TRACKING_LEVELS,
  isTrackingLevel,
  DEFAULT_TRACKING_LEVEL,
} from '@/lib/shipper-portal/visibility';
import { ensureShipperPortalTables } from '@/lib/shipper-portal/schema';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    await ensureShipperPortalTables();
    const rows = await prisma.$queryRawUnsafe<Array<{ level: string | null }>>(
      `SELECT default_portal_tracking_level AS level
         FROM tenant_settings
        WHERE tenant_id = $1
        LIMIT 1`,
      tenantId,
    );
    return NextResponse.json({
      level: rows[0]?.level ?? DEFAULT_TRACKING_LEVEL,
    });
  } catch (e) {
    console.error('[admin/tenant-settings/tracking-visibility] GET', e);
    return NextResponse.json({ level: DEFAULT_TRACKING_LEVEL });
  }
}

export async function PUT(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  const userId   = req.headers.get('x-user-id');
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({})) as { level?: string };
    if (!body.level || !isTrackingLevel(body.level)) {
      return NextResponse.json({
        error: `level must be one of: ${TRACKING_LEVELS.join(', ')}`,
      }, { status: 400 });
    }

    // Read the previous value for the audit entry.
    await ensureShipperPortalTables();
    const prevRows = await prisma.$queryRawUnsafe<Array<{ level: string | null }>>(
      `SELECT default_portal_tracking_level AS level FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
      tenantId,
    );
    const previousLevel = prevRows[0]?.level ?? DEFAULT_TRACKING_LEVEL;

    await setTenantTrackingDefault({ tenantId, level: body.level });

    void logAudit({
      tenantId,
      userId,
      userRole: req.headers.get('x-user-role') ?? 'TENANT_ADMIN',
      entityType: 'TenantSettings',
      entityId: tenantId,
      entityName: 'Portal tracking default',
      action: 'UPDATE',
      details: `Set tenant-wide default portal tracking visibility to ${body.level} (was ${previousLevel})`,
    });

    return NextResponse.json({ ok: true, level: body.level });
  } catch (e) {
    console.error('[admin/tenant-settings/tracking-visibility] PUT', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
