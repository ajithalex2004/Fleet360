/**
 * src/app/api/driver-app/shift/[id]/recent-entries/route.ts
 *
 * GET /api/driver-app/shift/[id]/recent-entries?limit=3
 *
 * Returns the most recent N fuel + expense entries for a shift,
 * plus totals. Powers the "Recent entries" widget on the driver
 * menu page (#13 in the roadmap).
 *
 * Auth: requireDriverSession, plus the shift must belong to the
 * current driver. Drivers can't peek at each other's shifts.
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
  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  // Validate shift ownership
  const shiftRows = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status
    FROM shifts
    WHERE id = ${params.id}::uuid
      AND tenant_id = ${ctx.tenantId}::uuid
      AND driver_id = ${ctx.userId}::uuid
    LIMIT 1
  `;
  if (shiftRows.length === 0) {
    return NextResponse.json({ error: 'shift not found' }, { status: 404 });
  }

  const limit = Math.min(
    Math.max(Number(new URL(req.url).searchParams.get('limit') ?? '3'), 1),
    50,
  );

  // Top-N fuel
  const fuel = await prisma.$queryRaw<
    Array<{
      id: string;
      liters: unknown;
      cost_minor: number;
      currency: string;
      odometer: number | null;
      location_name: string | null;
      filled_at: Date;
    }>
  >`
    SELECT id, liters, cost_minor, currency, odometer, location_name, filled_at
    FROM fuel_entries
    WHERE shift_id = ${params.id}::uuid
    ORDER BY filled_at DESC
    LIMIT ${limit}
  `;

  // Top-N expenses
  const expenses = await prisma.$queryRaw<
    Array<{
      id: string;
      category: string;
      amount_minor: number;
      currency: string;
      description: string | null;
      incurred_at: Date;
      trip_id: string | null;
    }>
  >`
    SELECT id, category, amount_minor, currency, description, incurred_at, trip_id
    FROM expense_entries
    WHERE shift_id = ${params.id}::uuid
    ORDER BY incurred_at DESC
    LIMIT ${limit}
  `;

  // Totals for the whole shift
  const totals = await prisma.$queryRaw<
    Array<{ fuel_minor: number | null; expense_minor: number | null }>
  >`
    SELECT
      (SELECT COALESCE(SUM(cost_minor), 0)::bigint FROM fuel_entries WHERE shift_id = ${params.id}::uuid) AS fuel_minor,
      (SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM expense_entries WHERE shift_id = ${params.id}::uuid) AS expense_minor
  `;

  // Counts for the badges
  const counts = await prisma.$queryRaw<
    Array<{ fuel: number; expense: number }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM fuel_entries WHERE shift_id = ${params.id}::uuid) AS fuel,
      (SELECT COUNT(*)::int FROM expense_entries WHERE shift_id = ${params.id}::uuid) AS expense
  `;

  const NO_TRIP_SENTINEL = '00000000-0000-0000-0000-000000000000';

  return NextResponse.json(
    {
      shiftId: params.id,
      shiftStatus: shiftRows[0].status,
      fuel: fuel.map((f) => ({
        id: f.id,
        liters: Number(f.liters),
        costMinor: Number(f.cost_minor),
        currency: f.currency,
        odometer: f.odometer,
        locationName: f.location_name,
        filledAt: f.filled_at.toISOString(),
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        category: e.category,
        amountMinor: Number(e.amount_minor),
        currency: e.currency,
        description: e.description,
        tripId: e.trip_id === NO_TRIP_SENTINEL ? null : e.trip_id,
        incurredAt: e.incurred_at.toISOString(),
      })),
      totals: {
        fuelMinor: Number(totals[0]?.fuel_minor ?? 0),
        expenseMinor: Number(totals[0]?.expense_minor ?? 0),
      },
      counts: {
        fuel: counts[0]?.fuel ?? 0,
        expense: counts[0]?.expense ?? 0,
      },
    },
    { headers: { 'Cache-Control': privateCacheControl(15, 30) } },
  );
}
