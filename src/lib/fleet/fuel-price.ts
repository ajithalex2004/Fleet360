/**
 * Shared fleet fuel-price lookup — the fleet's own most recent pump price,
 * not a fixed rate. Originally lived inline in the Single Route optimizer
 * endpoint; extracted so Route Consolidation's Stage 4 scorer can derive
 * `costPerKm` from the same source instead of a second, independently-set
 * admin constant that would silently drift out of sync with this one.
 */

import type { PrismaClient } from '@prisma/client';

export interface LatestFuelPrice {
  /** AED per litre. */
  price: number;
  /** ISO date string of the fuel_logs row this came from. */
  asOf: string;
}

/**
 * cost_per_liter on the newest fuel_logs row (any vehicle, tenant-scoped
 * via the vehicles join) within the last 180 days. Returns null when the
 * tenant has no recent fuel log yet (e.g. brand-new tenant, or logs older
 * than 180 days) — callers fall back to DEFAULT_FUEL_PRICE_AED (mapbox.ts).
 */
export async function getLatestFuelPrice(
  prisma: PrismaClient,
  tenantId: string,
): Promise<LatestFuelPrice | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cost_per_liter: number; fuel_date: string }>>(
    `SELECT fl.cost_per_liter, fl.fuel_date::text
       FROM fuel_logs fl
       JOIN vehicles v ON v.id = fl.vehicle_id
      WHERE v.tenant_id = $1
        AND fl.cost_per_liter IS NOT NULL
        AND fl.fuel_date >= NOW() - INTERVAL '180 days'
      ORDER BY fl.fuel_date DESC
      LIMIT 1`,
    tenantId,
  );
  const row = rows[0];
  if (!row) return null;
  return { price: Number(row.cost_per_liter), asOf: row.fuel_date };
}
