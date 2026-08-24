/**
 * src/app/api/driver-app/reports/[id]/route.ts
 *
 * GET /api/driver-app/reports/[id]
 *   Driver reads one of their own reports. Returns the full row
 *   including the dispatcher-side state (acknowledged_by, resolved_at,
 *   resolution_notes) so the driver can see what the dispatcher did.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';
import { privateCacheControl } from '@/lib/server-cache';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    tenant_id: string;
    driver_id: string;
    trip_id: string | null;
    shift_id: string | null;
    kind: string;
    type: string;
    subtype: string | null;
    severity: string | null;
    title: string;
    description: string | null;
    location: unknown;
    status: string;
    acknowledged_by: string | null;
    acknowledged_at: Date | null;
    resolved_by: string | null;
    resolved_at: Date | null;
    resolution_notes: string | null;
    cancelled_by: string | null;
    cancelled_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>>`
    SELECT id, tenant_id, driver_id, trip_id, shift_id,
           kind, type, subtype, severity, title, description, location,
           status, acknowledged_by, acknowledged_at,
           resolved_by, resolved_at, resolution_notes,
           cancelled_by, cancelled_at,
           created_at, updated_at
    FROM driver_reports
    WHERE id = ${params.id}::uuid
    LIMIT 1
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: 'report not found' }, { status: 404 });
  }
  const r = rows[0];

  // Tenant + driver scope — drivers can only see their own reports
  if (r.tenant_id !== ctx.tenantId) {
    return NextResponse.json({ error: 'forbidden: report is in a different tenant' }, { status: 403 });
  }
  if (r.driver_id !== ctx.userId) {
    return NextResponse.json({ error: 'forbidden: this report was filed by another driver' }, { status: 403 });
  }

  return NextResponse.json(
    {
      id: r.id,
      kind: r.kind,
      type: r.type,
      subtype: r.subtype,
      severity: r.severity,
      title: r.title,
      description: r.description,
      location: r.location,
      status: r.status,
      tripId: r.trip_id,
      shiftId: r.shift_id,
      acknowledgedBy: r.acknowledged_by,
      acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      resolutionNotes: r.resolution_notes,
      cancelledBy: r.cancelled_by,
      cancelledAt: r.cancelled_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    },
    { headers: { 'Cache-Control': privateCacheControl(15, 30) } },
  );
}
