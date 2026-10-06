import { requireBusOpsRequest } from '@/lib/bus-ops/access';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/bus-ops/schedules/[id]/pretrip-check
 *      Returns the most recent pre-trip check for this trip, or null.
 *
 * POST /api/bus-ops/schedules/[id]/pretrip-check
 *      Body: { items: [{ key, ok, note? }], notes?, signatureData? }
 *      Records the inspection. If a blocking item failed, the trip's notes
 *      are appended with an "UNSAFE TO DEPART" warning so dispatch sees it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { assessChecklist, PRETRIP_CHECKLIST, ChecklistValidationError } from '@/lib/bus-pretrip-checklist';
import { writeRequiredAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const policyError = await requireBusOpsRequest(_req);
  if (policyError) return policyError;
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    // Unlike the depart and complete handlers, nothing here resolves the
    // schedule within the tenant first, so scheduleId arrives from the URL
    // unchecked. tenantId is what stops this returning another organisation's
    // safety inspection.
    const latest = await tx.busPreTripCheck.findFirst({
        where: { scheduleId: params.id, tenantId },
        orderBy: { performedAt: 'desc' },
      });
      return NextResponse.json({ check: latest, checklist: PRETRIP_CHECKLIST });
  });
}


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const items = Array.isArray(body?.items) ? body.items : [];
        if (items.length === 0) {
          return NextResponse.json({ error: 'items[] is required' }, { status: 400 });
        }

        // findFirst with tenantId, not findUnique on the id alone: this
        // previously accepted any schedule id and recorded a pre-trip safety
        // check against another organisation's trip.
        await tx.$queryRawUnsafe('SELECT id FROM trip_schedules WHERE id::text = $1 AND tenant_id::text = $2 FOR UPDATE', params.id, tenantId);
        const schedule = await tx.tripSchedule.findFirst({
          where: { id: params.id, tenantId, deletedAt: null },
        });
        if (!schedule) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

        if (schedule.status !== 'SCHEDULED') return NextResponse.json({ error: 'Inspection requires a scheduled trip' }, { status: 409 });
        const assessment = assessChecklist(items);

        const check = await tx.busPreTripCheck.create({
          data: {
            tenantId,
            scheduleId: params.id,
            vehicleId: schedule.vehicleId ?? null,
            driverId: schedule.driverId ?? null,
            performedBy: authz.userId,
            checkItems: items,
            overallPass: assessment.overallPass,
            failCount: assessment.failCount,
            notes: body.notes ?? null,
            signatureData: body.signatureData ?? null,
          },
        });

        if (!assessment.overallPass) {
          const warning = `[${new Date().toISOString().slice(0, 16)}] UNSAFE TO DEPART — pre-trip check FAILED on: ${assessment.blockingFailures.map(f => f.label).join('; ')}`;
          await tx.tripSchedule.update({
            where: { id: params.id },
            data: { notes: [schedule.notes, warning].filter(Boolean).join('\n') },
          });
        }

        await writeRequiredAudit({
          tenantId,
          userId: authz.userId ?? undefined,
          userRole: req.headers.get('x-user-role') ?? 'DRIVER',
          entityType: 'TripSchedule',
          entityId: params.id,
          action: 'UPDATE',
          details: `Pre-trip check ${assessment.overallPass ? 'PASS' : `FAIL (${assessment.blockingFailures.length} blocking)`} — ${items.filter((i: { ok: boolean }) => i.ok).length}/${items.length} items OK.`,
        }, tx);

        return NextResponse.json({ check, assessment }, { status: 201 });
    });
  } catch (err) {
    if (err instanceof ChecklistValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    captureException(err, { context: 'bus-ops.pretrip-check.create', tags: { scheduleId: params.id } });
    return NextResponse.json({ error: 'Failed to record check' }, { status: 500 });
  }
}
