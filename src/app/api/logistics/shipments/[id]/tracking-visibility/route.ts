/**
 * POST /api/logistics/shipments/[id]/tracking-visibility
 *
 * Operator action — set or clear the per-shipment tracking-visibility
 * override for a single logistics shipment.
 *
 *   Body: { level: TrackingLevel | null, reason?: string }
 *
 *   level=null clears the override → shipment inherits the customer-level
 *   default again (or, failing that, the tenant default).
 *
 *   When the new level is a DOWNGRADE (FULL_TRACKING → NONE etc.) the
 *   UI should prompt for a reason; the server logs whatever is provided
 *   into portal_tracking_override_reason and the audit log.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  setShipmentTrackingOverride,
  resolveTrackingLevel,
  TRACKING_LEVELS,
  isTrackingLevel,
} from '@/lib/shipper-portal/visibility';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  const userId   = req.headers.get('x-user-id');
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id: shipmentId } = await params;
    const body = await req.json().catch(() => ({})) as { level?: string | null; reason?: string };

    // null/empty string explicitly clears the override.
    const newLevel = (body.level === null || body.level === '' || body.level === undefined)
      ? null
      : body.level;
    if (newLevel !== null && !isTrackingLevel(newLevel)) {
      return NextResponse.json({
        error: `level must be one of: ${TRACKING_LEVELS.join(', ')} or null to clear`,
      }, { status: 400 });
    }

    // Verify the shipment belongs to this tenant before mutating.
    const own = await prisma.$queryRawUnsafe<Array<{ id: string; customer_id: string; current_level: string | null; no: string | null }>>(
      `SELECT id::text, cargo_owner_customer_id AS customer_id,
              portal_tracking_level AS current_level,
              shipment_no AS no
         FROM logistics_shipment_orders
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      shipmentId, tenantId,
    );
    if (!own[0]) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    }
    const previousLevel = own[0].current_level;
    const customerId = own[0].customer_id;
    const shipmentNo = own[0].no;

    const ok = await setShipmentTrackingOverride({
      tenantId,
      shipmentId,
      level: newLevel,
      reason: body.reason?.trim() || null,
    });
    if (!ok) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    // Audit log so the change has a trail beyond the row itself.
    void logAudit({
      tenantId,
      userId,
      userRole: req.headers.get('x-user-role') ?? 'OPERATOR',
      entityType: 'LogisticsShipmentOrder',
      entityId: shipmentId,
      entityName: shipmentNo ?? shipmentId,
      action: 'UPDATE',
      details: newLevel === null
        ? `Cleared tracking-visibility override (was ${previousLevel ?? 'inherited'})`
        : `Set tracking-visibility to ${newLevel} (was ${previousLevel ?? 'inherited'})${
            body.reason ? `: ${body.reason}` : ''
          }`,
    });

    // Echo back the new effective level so the operator UI can update its pill.
    const effective = await resolveTrackingLevel(tenantId, customerId, shipmentId);
    return NextResponse.json({
      ok: true,
      shipmentId,
      effectiveLevel: effective,
      shipmentOverride: newLevel,
    });
  } catch (e) {
    console.error('[shipments/tracking-visibility] POST', e);
    return NextResponse.json({ error: 'Failed to update visibility' }, { status: 500 });
  }
}
