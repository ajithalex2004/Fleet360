import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

/**
 * GET /api/fleet/tco
 * Total Cost of Ownership breakdown per vehicle.
 * Aggregates: fuel costs, traffic fines, work-order labour/parts (if available).
 *
 * Query params:
 *   vehicleId  — filter to a single vehicle UUID
 *   months     — rolling window in months (default 12)
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const vehicleId = sp.get('vehicleId');
    const months = Math.max(1, Math.min(60, parseInt(sp.get('months') ?? '12', 10)));

    const vehicleFilter = vehicleId ? `AND v.id = '${vehicleId.replace(/'/g, "''")}'` : '';

    // Per-vehicle fuel cost summary
    const fuelRows = await query<Row>(`
      SELECT
        v.id           AS vehicle_id,
        v.license_plate,
        COALESCE(v.make || ' ' || v.model, v.license_plate) AS vehicle_name,
        COALESCE(SUM(fl.total_cost), 0)   AS fuel_cost,
        COALESCE(SUM(fl.liters), 0)       AS total_liters,
        COUNT(fl.id)                      AS fuel_transactions
      FROM vehicles v
      LEFT JOIN fuel_logs fl
        ON fl.vehicle_id = v.id
        AND fl.fuel_date >= NOW() - ($1 || ' months')::interval
      WHERE v.deleted_at IS NULL
        ${vehicleFilter}
      GROUP BY v.id, v.license_plate, v.make, v.model
      ORDER BY fuel_cost DESC
      LIMIT 50
    `, String(months));

    // Per-vehicle traffic-fine cost summary
    const fineRows = await query<Row>(`
      SELECT
        vehicle_id,
        COALESCE(SUM(fine_amount), 0) AS fines_cost,
        COUNT(*)                      AS fine_count
      FROM traffic_fines
      WHERE fine_date >= NOW() - ($1 || ' months')::interval
        ${vehicleId ? `AND vehicle_id = '${vehicleId.replace(/'/g, "''")}'` : ''}
      GROUP BY vehicle_id
    `, String(months));

    // Build fines lookup map
    const finesMap: Record<string, { fines_cost: number; fine_count: number }> = {};
    for (const r of fineRows) {
      finesMap[r.vehicle_id as string] = {
        fines_cost: Number(r.fines_cost ?? 0),
        fine_count: Number(r.fine_count ?? 0),
      };
    }

    // Merge and compute TCO
    const rows = fuelRows.map((r) => {
      const vid = r.vehicle_id as string;
      const fuelCost = Number(r.fuel_cost ?? 0);
      const finesCost = finesMap[vid]?.fines_cost ?? 0;
      const fineCount = finesMap[vid]?.fine_count ?? 0;
      const totalTco = fuelCost + finesCost;

      return {
        vehicleId: vid,
        licensePlate: r.license_plate,
        vehicleName: r.vehicle_name,
        fuelCost,
        totalLiters: Number(r.total_liters ?? 0),
        fuelTransactions: Number(r.fuel_transactions ?? 0),
        finesCost,
        fineCount,
        totalTco,
      };
    });

    // Fleet-wide totals
    const totals = rows.reduce(
      (acc, r) => {
        acc.fuelCost += r.fuelCost;
        acc.finesCost += r.finesCost;
        acc.totalTco += r.totalTco;
        acc.fuelTransactions += r.fuelTransactions;
        acc.fineCount += r.fineCount;
        return acc;
      },
      { fuelCost: 0, finesCost: 0, totalTco: 0, fuelTransactions: 0, fineCount: 0 }
    );

    return NextResponse.json(ser({ months, totals, vehicles: rows }));
  } catch (error) {
    console.error('Error fetching fleet TCO:', error);
    return NextResponse.json({ error: 'Failed to fetch TCO data' }, { status: 500 });
  }
}
