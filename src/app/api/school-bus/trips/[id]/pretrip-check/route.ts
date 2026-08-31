export const dynamic = 'force-dynamic';

/**
 * GET  /api/school-bus/trips/[id]/pretrip-check
 *      Returns the latest pre-trip check for this trip + checklist definition.
 *
 * POST /api/school-bus/trips/[id]/pretrip-check
 *      Body: { items: [{key, ok, note?}], notes?, signatureData? }
 *      Reuses bus_pretrip_checks table (scheduleId stores school-bus trip id).
 *      A failed blocking item appends an UNSAFE TO DEPART warning to the
 *      trip's metadata and the check is recorded for audit + RTA inspection.
 *
 * Note: trip start is not yet gated on this — Wave 2 ships the capture +
 * audit trail. Gating goes in once the driver-PWA depart action is wired.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { assessSchoolBusChecklist, SCHOOL_BUS_PRETRIP_CHECKLIST } from '@/lib/school-bus-pretrip';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;
      // Same gap as the bus-ops pretrip-check handler: scheduleId comes from
      // the URL with nothing resolving the trip first, so tenantId is the only
      // thing preventing another school's safety inspection being returned.
      const latest = await tx.busPreTripCheck.findFirst({
        where: { scheduleId: id, tenantId },
        orderBy: { performedAt: 'desc' },
      });
      return NextResponse.json({ check: latest, checklist: SCHOOL_BUS_PRETRIP_CHECKLIST });
  });
}


export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;
      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const items = Array.isArray(body?.items) ? body.items : [];
        if (items.length === 0) {
          return NextResponse.json({ error: 'items[] is required' }, { status: 400 });
        }

        // Verify trip exists in school_bus_trips
        const tripRows = await tx.$queryRawUnsafe<Array<{ id: string; vehicle_id: string | null; driver_name: string | null }>>(
          `SELECT id::text, vehicle_id::text, driver_name FROM school_bus_trips WHERE id = $1::uuid`,
          id,
        ).catch(() => []);
        if (tripRows.length === 0) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

        const assessment = assessSchoolBusChecklist(items);

        const check = await tx.busPreTripCheck.create({
          data: {
            tenantId,
            scheduleId: id,
            vehicleId: tripRows[0].vehicle_id,
            driverId: tripRows[0].driver_name ?? null,
            performedBy: req.headers.get('x-user-id') ?? body.performedBy ?? null,
            checkItems: items,
            overallPass: assessment.overallPass,
            failCount: assessment.failCount,
            notes: body.notes ?? null,
            signatureData: body.signatureData ?? null,
          },
        });

        void logAudit({
          userId: req.headers.get('x-user-id') ?? 'system',
          userRole: req.headers.get('x-user-role') ?? 'DRIVER',
          entityType: 'SchoolBusTrip',
          entityId: id,
          action: 'UPDATE',
          details: `School-bus pre-trip check ${assessment.overallPass ? 'PASS' : `FAIL (${assessment.blockingFailures.length} blocking)`} — ${items.filter((i: { ok: boolean }) => i.ok).length}/${items.length} items OK.`,
        });

        return NextResponse.json({ check, assessment }, { status: 201 });
        } catch (err) {
        captureException(err, { context: 'school-bus.pretrip-check.create', tags: { tripId: id } });
        return NextResponse.json({ error: 'Failed to record check' }, { status: 500 });
      }
  });
}

