/**
 * GET /api/bus-ops/analytics/cost-breakdown?groupBy=trip|route&days=30
 *
 * Per-trip or per-route cost breakdown. Same cost model as the summary
 * KPIs on /api/bus-ops/analytics (fuel + driver + vehicle) but not
 * aggregated — one row per trip or per route.
 *
 * Response: {
 *   groupBy, windowDays, currency: 'AED', unitCosts: { fuelPerL, driverPerHr, vehiclePerKm },
 *   rows: [{ id, label, trips?, fuelL, km, minutes, passengers, fuelCost, driverCost, vehicleCost, totalCost, costPerPax? }]
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
interface TripRow {
  id: string;                trip_number: string | null;
  route_name: string | null; departure_time: Date;
  fuel_l: number | null;     km: number | null;
  minutes: number | null;    passengers: bigint;
}
interface RouteRow {
  route_id: string;          route_name: string | null;
  trips: bigint;             fuel_l: number | null;
  km: number | null;         minutes: number | null;
  passengers: bigint;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const groupBy = (sp.get('groupBy') === 'route' ? 'route' : 'trip') as 'trip' | 'route';
  const windowDays = Math.max(1, Math.min(365, Number(sp.get('days') ?? 30)));
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const FUEL_COST_AED_PER_LITRE = Number(process.env.BUS_FUEL_AED_PER_L ?? 2.95);
  const DRIVER_AED_PER_HOUR     = Number(process.env.BUS_DRIVER_AED_PER_HR ?? 30);
  const VEHICLE_AED_PER_KM      = Number(process.env.BUS_VEHICLE_AED_PER_KM ?? 0.50);

  try {
    if (groupBy === 'trip') {
      const rows = await prisma.$queryRawUnsafe<TripRow[]>(`
        SELECT
          ts.id, ts.trip_number, r.name AS route_name, ts.departure_time,
          tl.fuel_used AS fuel_l,
          GREATEST(tl.end_mileage - tl.start_mileage, 0)::float AS km,
          EXTRACT(EPOCH FROM (tl.actual_arrival_time - tl.actual_departure_time))/60 AS minutes,
          COALESCE(tl.passengers_boarded, 0) AS passengers
        FROM trip_schedules ts
        JOIN trip_logs tl ON tl.schedule_id = ts.id
        LEFT JOIN bus_routes r ON r.id = ts.route_id
        WHERE ts.deleted_at IS NULL
          AND ts.tenant_id = $1
          AND ts.departure_time >= $2
          AND ts.status = 'COMPLETED'
          AND tl.actual_departure_time IS NOT NULL
          AND tl.actual_arrival_time IS NOT NULL
        ORDER BY ts.departure_time DESC
        LIMIT 500
      `, tenantId, windowStart);

      const shaped = rows.map(r => {
        const fuelCost    = (r.fuel_l ?? 0) * FUEL_COST_AED_PER_LITRE;
        const driverCost  = ((r.minutes ?? 0) / 60) * DRIVER_AED_PER_HOUR;
        const vehicleCost = (r.km ?? 0) * VEHICLE_AED_PER_KM;
        const totalCost   = fuelCost + driverCost + vehicleCost;
        const pax = Number(r.passengers);
        return {
          id:          r.id,
          label:       r.trip_number ?? r.id.slice(0, 8),
          routeName:   r.route_name,
          departureAt: r.departure_time.toISOString(),
          fuelL:       Math.round((r.fuel_l ?? 0) * 100) / 100,
          km:          Math.round((r.km ?? 0) * 10) / 10,
          minutes:     Math.round(r.minutes ?? 0),
          passengers:  pax,
          fuelCost:    Math.round(fuelCost * 100) / 100,
          driverCost:  Math.round(driverCost * 100) / 100,
          vehicleCost: Math.round(vehicleCost * 100) / 100,
          totalCost:   Math.round(totalCost * 100) / 100,
          costPerPax:  pax > 0 ? Math.round((totalCost / pax) * 100) / 100 : null,
        };
      });

      return NextResponse.json({
        groupBy, windowDays, currency: 'AED',
        unitCosts: { fuelPerL: FUEL_COST_AED_PER_LITRE, driverPerHr: DRIVER_AED_PER_HOUR, vehiclePerKm: VEHICLE_AED_PER_KM },
        rows: shaped,
      });
    }

    // groupBy === 'route'
    const rows = await prisma.$queryRawUnsafe<RouteRow[]>(`
      SELECT
        r.id AS route_id, r.name AS route_name,
        COUNT(DISTINCT ts.id) AS trips,
        COALESCE(SUM(tl.fuel_used), 0)::float AS fuel_l,
        COALESCE(SUM(GREATEST(tl.end_mileage - tl.start_mileage, 0)), 0)::float AS km,
        COALESCE(SUM(EXTRACT(EPOCH FROM (tl.actual_arrival_time - tl.actual_departure_time))/60), 0)::float AS minutes,
        COALESCE(SUM(tl.passengers_boarded), 0) AS passengers
      FROM trip_schedules ts
      JOIN trip_logs tl ON tl.schedule_id = ts.id
      JOIN bus_routes r  ON r.id = ts.route_id
      WHERE ts.deleted_at IS NULL
        AND ts.tenant_id = $1
        AND ts.departure_time >= $2
        AND ts.status = 'COMPLETED'
        AND tl.actual_departure_time IS NOT NULL
        AND tl.actual_arrival_time IS NOT NULL
      GROUP BY r.id, r.name
      ORDER BY (COALESCE(SUM(tl.fuel_used),0) * $3
              + COALESCE(SUM(EXTRACT(EPOCH FROM (tl.actual_arrival_time - tl.actual_departure_time))/3600),0) * $4
              + COALESCE(SUM(GREATEST(tl.end_mileage - tl.start_mileage,0)),0) * $5) DESC
      LIMIT 100
    `, tenantId, windowStart, FUEL_COST_AED_PER_LITRE, DRIVER_AED_PER_HOUR, VEHICLE_AED_PER_KM);

    const shaped = rows.map(r => {
      const fuelCost    = (r.fuel_l ?? 0) * FUEL_COST_AED_PER_LITRE;
      const driverCost  = ((r.minutes ?? 0) / 60) * DRIVER_AED_PER_HOUR;
      const vehicleCost = (r.km ?? 0) * VEHICLE_AED_PER_KM;
      const totalCost   = fuelCost + driverCost + vehicleCost;
      const pax = Number(r.passengers);
      const trips = Number(r.trips);
      return {
        id:          r.route_id,
        label:       r.route_name ?? r.route_id.slice(0, 8),
        trips,
        fuelL:       Math.round((r.fuel_l ?? 0) * 100) / 100,
        km:          Math.round((r.km ?? 0) * 10) / 10,
        minutes:     Math.round(r.minutes ?? 0),
        passengers:  pax,
        fuelCost:    Math.round(fuelCost * 100) / 100,
        driverCost:  Math.round(driverCost * 100) / 100,
        vehicleCost: Math.round(vehicleCost * 100) / 100,
        totalCost:   Math.round(totalCost * 100) / 100,
        costPerTrip: trips > 0 ? Math.round((totalCost / trips) * 100) / 100 : null,
        costPerPax:  pax > 0 ? Math.round((totalCost / pax) * 100) / 100 : null,
      };
    });

    return NextResponse.json({
      groupBy, windowDays, currency: 'AED',
      unitCosts: { fuelPerL: FUEL_COST_AED_PER_LITRE, driverPerHr: DRIVER_AED_PER_HOUR, vehiclePerKm: VEHICLE_AED_PER_KM },
      rows: shaped,
    });
  } catch (e) {
    console.error('[analytics/cost-breakdown]', e);
    return NextResponse.json({ error: 'Failed to compute cost breakdown' }, { status: 500 });
  }
}
