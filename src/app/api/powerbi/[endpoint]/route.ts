export const dynamic = 'force-dynamic';

/**
 * /api/powerbi/* — Power BI connector endpoints.
 *
 * Power BI consumes data via either:
 *   - Web connector (Power Query M) — point at a JSON endpoint
 *   - OData feed
 *   - CSV import
 *
 * We expose a set of JSON endpoints that follow the shape Power BI's
 * "Get Data → Web" expects. Each endpoint returns a top-level
 * `value` array of rows (the OData convention Power BI understands
 * without an OData wrapper).
 *
 * Endpoints:
 *   GET /api/powerbi/schedule     — flattened trip_schedules
 *   GET /api/powerbi/stops        — bus_route stops with sequence
 *   GET /api/powerbi/drivers      — driver roster + per-trip assignments
 *   GET /api/powerbi/runs         — saved plan runs (planning core)
 *   GET /api/powerbi/blocks       — saved plan blocks (vehicle groupings)
 *   GET /api/powerbi/incidents    — incident log
 *
 * Auth: same as the rest of the API — xl-session cookie sets the tenant
 * context. Power BI users authenticate via the standard Fleet360 login,
 * then point their data source at /api/powerbi/[endpoint].
 *
 * Each response is a JSON envelope:
 *   { "value": [ rows... ], "@odata.context": "...", "tenantId": "..." }
 *
 * Power BI's "Web" connector flattens `value` automatically. For
 * power-bi-desktop users, importing /api/powerbi/schedule directly
 * creates a flat table with one row per trip.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const ENDPOINTS = new Set(['schedule', 'stops', 'drivers', 'runs', 'blocks', 'incidents']);

export async function GET(req: NextRequest, { params }: { params: Promise<{ endpoint: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const { endpoint } = await params;
  if (!ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: 'Unknown endpoint' }, { status: 404 });
  }
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ? new Date(sp.get('from')!) : null;
  const to   = sp.get('to')   ? new Date(sp.get('to')!)   : null;

  const ctx: Ctx = { tenantId, endpoint, from, to };

  try {
    let value: unknown[] = [];
    switch (endpoint) {
      case 'schedule':  value = await loadSchedule(ctx);  break;
      case 'stops':     value = await loadStops(ctx);     break;
      case 'drivers':   value = await loadDrivers(ctx);   break;
      case 'runs':      value = await loadRuns(ctx);      break;
      case 'blocks':    value = await loadBlocks(ctx);    break;
      case 'incidents': value = await loadIncidents(ctx); break;
    }
    return NextResponse.json(
      {
        '@odata.context': `$metadata#${endpoint}`,
        tenantId,
        endpoint,
        rowCount: value.length,
        value,
      },
      {
        headers: {
          // Power BI connectors poll — keep cache modest and let the
          // browser respect it.
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (e) {
    console.error(`[powerbi/${endpoint}]`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

interface Ctx {
  tenantId: string;
  endpoint: string;
  from: Date | null;
  to: Date | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function loadSchedule(ctx: Ctx) {
  return withTenantRls(prisma, ctx.tenantId, async (tx) => {
    const rows = await tx.tripSchedule.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        ...(ctx.from || ctx.to ? {
          departureTime: {
            ...(ctx.from ? { gte: ctx.from } : {}),
            ...(ctx.to   ? { lte: ctx.to   } : {}),
          },
        } : {}),
      },
      include: {
        route: { select: { name: true, origin: true, destination: true, routeType: true } },
        tripLogs: { orderBy: { createdAt: 'desc' }, take: 1, select: {
          actualDepartureTime: true, actualArrivalTime: true,
          passengersBoarded: true,
        } },
      },
      orderBy: { departureTime: 'asc' },
      take: 100000,
    });
    return rows.map((t) => ({
      tripId: t.id,
      tripNumber: t.tripNumber,
      routeId: t.routeId,
      routeName: t.route.name,
      routeType: t.route.routeType,
      origin: t.route.origin,
      destination: t.route.destination,
      scheduledDeparture: iso(t.departureTime),
      scheduledArrival:   iso(t.arrivalTime),
      actualDeparture:     iso(t.tripLogs?.[0]?.actualDepartureTime ?? null),
      actualArrival:       iso(t.tripLogs?.[0]?.actualArrivalTime   ?? null),
      direction: t.direction,
      shiftType: t.shiftType,
      capacity: t.capacity,
      confirmedCount: t.confirmedCount,
      passengersBoarded:  num(t.tripLogs?.[0]?.passengersBoarded  ?? null),
      status: t.status,
      schedulingMode: t.schedulingMode,
      vehicleId: t.vehicleId,
      driverId:  t.driverId,
    }));
  });
}

async function loadStops(ctx: Ctx) {
  return withTenantRls(prisma, ctx.tenantId, async (tx) => {
    const rows = await tx.routeStop.findMany({
      where: { tenantId: ctx.tenantId, route: { deletedAt: null } },
      include: { route: { select: { name: true, origin: true, destination: true } } },
      orderBy: [{ routeId: 'asc' }, { sequence: 'asc' }],
      take: 100000,
    });
    return rows.map((s) => ({
      stopId: s.id,
      routeId: s.routeId,
      routeName: s.route.name,
      routeOrigin: s.route.origin,
      routeDestination: s.route.destination,
      stopName: s.stopName,
      sequence: s.sequence,
      estimatedArrivalMins: s.estimatedArrivalMins,
      landmark: s.landmark,
      gpsLat: s.gpsLat,
      gpsLng: s.gpsLng,
    }));
  });
}

async function loadDrivers(ctx: Ctx) {
  return withTenantRls(prisma, ctx.tenantId, async (tx) => {
    const drivers = await tx.driver.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, name: true, firstName: true, lastName: true, licenseType: true, status: true, driverType: true },
      orderBy: [{ name: 'asc' }],
    });
    // Count trips per driver in the date range
    const tripCounts = await tx.tripSchedule.groupBy({
      by: ['driverId'],
      where: {
        tenantId: ctx.tenantId, deletedAt: null,
        driverId: { not: null },
        ...(ctx.from || ctx.to ? {
          departureTime: {
            ...(ctx.from ? { gte: ctx.from } : {}),
            ...(ctx.to   ? { lte: ctx.to   } : {}),
          },
        } : {}),
      },
      _count: { _all: true },
    });
    const countMap = new Map(tripCounts.map((c) => [c.driverId, c._count._all]));
    return drivers.map((d) => ({
      driverId: d.id,
      name: d.name ?? ([d.firstName, d.lastName].filter(Boolean).join(' ') || null),
      firstName: d.firstName,
      lastName: d.lastName,
      licenseType: d.licenseType,
      status: d.status,
      driverType: d.driverType,
      tripCount: countMap.get(d.id) ?? 0,
    }));
  });
}

async function loadRuns(ctx: Ctx) {
  return withTenantRls(prisma, ctx.tenantId, async (tx) => {
    const plans = await tx.staffTransportPlan.findMany({
      where: { tenantId: ctx.tenantId, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const out: unknown[] = [];
    for (const p of plans) {
      const runs = (p.runs as unknown as Array<Record<string, unknown>>) ?? [];
      for (const r of runs) {
        out.push({
          planId: p.id,
          planName: p.name,
          runDate: r.date,
          shiftType: r.shiftType,
          workMins: r.workMins,
          spreadMins: r.spreadMins,
          straightTimeMins: r.straightTimeMins,
          overtimeMins: r.overtimeMins,
          payMins: r.payMins,
          payCost: r.payCost,
          tripCount: Array.isArray(r.tripIds) ? (r.tripIds as string[]).length : 0,
          planCreatedAt: iso(p.createdAt),
          planAppliedAt:  iso(p.appliedAt),
        });
      }
    }
    return out;
  });
}

async function loadBlocks(ctx: Ctx) {
  return withTenantRls(prisma, ctx.tenantId, async (tx) => {
    const plans = await tx.staffTransportPlan.findMany({
      where: { tenantId: ctx.tenantId, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const out: unknown[] = [];
    for (const p of plans) {
      const blocks = (p.blocks as unknown as Array<Record<string, unknown>>) ?? [];
      for (const b of blocks) {
        out.push({
          planId: p.id,
          planName: p.name,
          blockDate: b.date,
          vehicleLabel: b.vehicleLabel,
          workMins: b.workMins,
          spanMins: b.spanMins,
          deadheadMins: b.deadheadMins,
          tripCount: Array.isArray(b.tripIds) ? (b.tripIds as string[]).length : 0,
          planCreatedAt: iso(p.createdAt),
          planAppliedAt:  iso(p.appliedAt),
        });
      }
    }
    return out;
  });
}

async function loadIncidents(ctx: Ctx) {
  return withTenantRls(prisma, ctx.tenantId, async (tx) => {
    const rows = await tx.tripIncident.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(ctx.from || ctx.to ? {
          incidentDate: {
            ...(ctx.from ? { gte: ctx.from } : {}),
            ...(ctx.to   ? { lte: ctx.to   } : {}),
          },
        } : {}),
      },
      orderBy: { incidentDate: 'desc' },
      take: 10000,
    });
    return rows.map((i) => ({
      incidentId: i.id,
      incidentNo: i.incidentNo,
      incidentType: i.incidentType,
      severity: i.severity,
      status: i.status,
      description: i.description,
      location: i.location,
      vehicleId: i.vehicleId,
      driverId:  i.driverId,
      scheduleId: i.scheduleId,
      incidentDate: iso(i.incidentDate),
      actionTaken: i.actionTaken,
    }));
  });
}
