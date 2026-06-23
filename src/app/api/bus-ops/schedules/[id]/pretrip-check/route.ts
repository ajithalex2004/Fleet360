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
import { prisma } from '@/lib/prisma';
import { assessChecklist, PRETRIP_CHECKLIST } from '@/lib/bus-pretrip-checklist';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { requireBusEntity, requireBusOpsContext } from '@/lib/bus-ops-route-guards';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireBusOpsContext(_req);
  if (ctx instanceof NextResponse) return ctx;
  const boundary = await requireBusEntity(ctx, 'trip_schedules', id, 'Trip');
  if (boundary) return boundary;
  const latest = await prisma.busPreTripCheck.findFirst({
    where: { scheduleId: id },
    orderBy: { performedAt: 'desc' },
  });
  return NextResponse.json({ check: latest, checklist: PRETRIP_CHECKLIST });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await requireBusOpsContext(req, { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const boundary = await requireBusEntity(ctx, 'trip_schedules', id, 'Trip');
    if (boundary) return boundary;
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ error: 'items[] is required' }, { status: 400 });
    }

    const schedule = await prisma.tripSchedule.findUnique({ where: { id } });
    if (!schedule) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const assessment = assessChecklist(items);

    const check = await prisma.busPreTripCheck.create({
      data: {
        scheduleId: id,
        vehicleId: schedule.vehicleId ?? null,
        driverId: schedule.driverId ?? null,
        performedBy: ctx.userId ?? body.performedBy ?? null,
        checkItems: items,
        overallPass: assessment.overallPass,
        failCount: assessment.failCount,
        notes: body.notes ?? null,
        signatureData: body.signatureData ?? null,
      },
    });

    if (!assessment.overallPass) {
      const warning = `[${new Date().toISOString().slice(0, 16)}] UNSAFE TO DEPART — pre-trip check FAILED on: ${assessment.blockingFailures.map(f => f.label).join('; ')}`;
      await prisma.tripSchedule.update({
        where: { id },
        data: { notes: [schedule.notes, warning].filter(Boolean).join('\n') },
      });
    }

    void logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userRole: ctx.role,
      entityType: 'TripSchedule',
      entityId: id,
      action: 'UPDATE',
      details: `Pre-trip check ${assessment.overallPass ? 'PASS' : `FAIL (${assessment.blockingFailures.length} blocking)`} — ${items.filter((i: { ok: boolean }) => i.ok).length}/${items.length} items OK.`,
    });

    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'STAFF_TRIP_SCHEDULING',
      referenceType: 'TripSchedule',
      referenceId: id,
      referenceNumber: schedule.tripNumber ?? id,
      contextData: {
        scheduleId: id,
        tripNumber: schedule.tripNumber ?? null,
        overallPass: assessment.overallPass,
        failCount: assessment.failCount,
        blockingFailures: assessment.blockingFailures.map(f => f.label),
      },
      force: !assessment.overallPass,
    });

    return NextResponse.json({ check, assessment, workflow }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'bus-ops.pretrip-check.create', tags: { scheduleId: id } });
    return NextResponse.json({ error: 'Failed to record check' }, { status: 500 });
  }
}
