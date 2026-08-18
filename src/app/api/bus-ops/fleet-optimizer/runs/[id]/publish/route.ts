/**
 * POST /api/bus-ops/fleet-optimizer/runs/:id/publish
 *
 * Turns a solved fleet-optimizer run into concrete TripSchedule rows for
 * the target date. Wraps everything in a single transaction — either all
 * schedules land + the run flips to PUBLISHED, or nothing changes.
 *
 * Semantics:
 *   • One TripSchedule created per FleetOptimizationRunRoute.
 *   • departureTime = route.startTime, arrivalTime = route.endTime.
 *   • vehicleId comes from the solver's assignment.
 *   • routeId is picked by MOST-COMMON-PARENT heuristic: look at all
 *     passenger ids across the route's stops, load their RoutePassenger
 *     rows, tally their .routeId, pick the winner. This gives the trip
 *     a sensible "parent route" for dispatch board grouping without
 *     forcing the operator to create a new BusRoute per solve.
 *   • Original TripSchedules for the target date are LEFT UNTOUCHED.
 *     The operator can manually cancel them from the Schedules page
 *     after reviewing — matches the existing "publish, don't clobber"
 *     pattern in Route Consolidation.
 *
 * Rejected when: run doesn't exist, run.status !== 'SUCCESS', or run
 * is already PUBLISHED (idempotent — no accidental double-publish).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { RunStatus } from '@/lib/planning/fleet-routing/types';

export const runtime = 'nodejs';

type IdCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const publishedBy = req.headers.get('x-user-id') ?? 'unknown';

  const run = await prisma.fleetOptimizationRun.findFirst({
    where: { id, tenantId },
    include: {
      routes: {
        orderBy: { sequenceInRun: 'asc' },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      },
    },
  });
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  if (run.status !== 'SUCCESS') {
    return NextResponse.json(
      { error: `Only SUCCESS runs can be published (current status: ${run.status})` },
      { status: 409 },
    );
  }
  if (run.publishedAt) {
    return NextResponse.json(
      { error: 'Run is already published', publishedAt: run.publishedAt },
      { status: 409 },
    );
  }
  if (run.routes.length === 0) {
    return NextResponse.json({ error: 'Run has no routes to publish' }, { status: 409 });
  }

  // Collect every passenger id referenced by any stop — one query gives us
  // routeId per passenger, then we tally per solver-route.
  const allPassengerIds = new Set<string>();
  for (const r of run.routes) {
    for (const s of r.stops) {
      for (const pid of s.passengerIds as string[]) allPassengerIds.add(pid);
    }
  }
  const passengerRows = allPassengerIds.size > 0
    ? await prisma.routePassenger.findMany({
        where: { id: { in: [...allPassengerIds] }, tenantId },
        select: { id: true, routeId: true },
      })
    : [];
  const passengerRoute = new Map(passengerRows.map(p => [p.id, p.routeId]));

  // Fallback: if a solver-route has zero identifiable passengers (edge case
  // with ad-hoc shipments), use the first RoutePassenger.routeId in the run
  // — better than failing the whole publish.
  const anyRouteId = passengerRows[0]?.routeId ?? null;

  // Build each TripSchedule spec + reject early if we can't pick a parent
  // route (would happen only when NO passengers on ANY solver-route can be
  // resolved to a routeId — unusual but worth failing loudly).
  interface ScheduleSpec {
    routeId:       string;
    vehicleId:     string;
    departureTime: Date;
    arrivalTime:   Date;
    notes:         string;
  }
  const specs: ScheduleSpec[] = [];
  for (const r of run.routes) {
    const tally = new Map<string, number>();
    for (const s of r.stops) {
      for (const pid of s.passengerIds as string[]) {
        const rid = passengerRoute.get(pid);
        if (rid) tally.set(rid, (tally.get(rid) ?? 0) + 1);
      }
    }
    const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? anyRouteId;
    if (!winner) {
      return NextResponse.json({
        error: `Solver-route ${r.sequenceInRun} has no resolvable parent route (no passengers mapped to any BusRoute).`,
      }, { status: 409 });
    }
    specs.push({
      routeId:       winner,
      vehicleId:     r.vehicleId,
      departureTime: r.startTime,
      arrivalTime:   r.endTime,
      notes:         `Published by Fleet Optimizer run ${run.id.slice(0, 8)} on ${new Date().toISOString().slice(0, 10)} — ${r.totalDistanceKm} km, ${r.totalPassengers} pax.`,
    });
  }

  // Transactional publish. Either everything lands or nothing changes —
  // an operator interrupting halfway shouldn't leave the DB with 2 of 5
  // schedules + a still-SUCCESS run.
  const result = await prisma.$transaction(async (tx) => {
    const created: string[] = [];
    for (const spec of specs) {
      const s = await tx.tripSchedule.create({
        data: {
          tenantId,
          routeId:       spec.routeId,
          vehicleId:     spec.vehicleId,
          departureTime: spec.departureTime,
          arrivalTime:   spec.arrivalTime,
          notes:         spec.notes,
          status:        'SCHEDULED',
          frequency:     'ONCE',
        },
        select: { id: true },
      });
      created.push(s.id);
    }
    await tx.fleetOptimizationRun.update({
      where: { id: run.id },
      data: {
        status:       'PUBLISHED' satisfies RunStatus,
        statusReason: `Published ${created.length} trip schedule(s) at ${new Date().toISOString()}`,
        publishedAt:  new Date(),
        publishedBy,
      },
    });
    return { publishedCount: created.length, tripScheduleIds: created };
  });

  return NextResponse.json(result);
}
