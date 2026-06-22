/**
 * PATCH /api/admin/customers/[id]/tracking-visibility
 *
 * Operator sets the default tracking-visibility level for one customer.
 * This level applies to every shipment of the customer EXCEPT those with
 * a per-shipment override (which is set via /api/logistics/shipments/[id]/tracking-visibility).
 *
 *   Body: { level: TrackingLevel }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  setCustomerTrackingDefault,
  TRACKING_LEVELS,
  isTrackingLevel,
} from '@/lib/shipper-portal/visibility';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  const userId   = req.headers.get('x-user-id');
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id: customerId } = await params;
    const body = await req.json().catch(() => ({})) as { level?: string };
    if (!body.level || !isTrackingLevel(body.level)) {
      return NextResponse.json({
        error: `level must be one of: ${TRACKING_LEVELS.join(', ')}`,
      }, { status: 400 });
    }

    // Confirm the customer belongs to this tenant + capture the previous
    // level for the audit entry.
    const own = await prisma.$queryRawUnsafe<Array<{ name_en: string; current: string | null }>>(
      `SELECT name_en, portal_tracking_level AS current
         FROM customers
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      customerId, tenantId,
    );
    if (!own[0]) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }
    const previousLevel = own[0].current;
    const customerName = own[0].name_en;

    const ok = await setCustomerTrackingDefault({
      tenantId, customerId, level: body.level,
    });
    if (!ok) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    void logAudit({
      tenantId,
      userId,
      userRole: req.headers.get('x-user-role') ?? 'OPERATOR',
      entityType: 'Customer',
      entityId: customerId,
      entityName: customerName,
      action: 'UPDATE',
      details: `Set portal tracking visibility default to ${body.level} (was ${previousLevel ?? 'STATUS_ONLY (default)'})`,
    });

    return NextResponse.json({ ok: true, customerId, level: body.level });
  } catch (e) {
    console.error('[admin/customers/tracking-visibility] PATCH', e);
    return NextResponse.json({ error: 'Failed to update visibility' }, { status: 500 });
  }
}
