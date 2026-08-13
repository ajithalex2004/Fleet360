/**
 * src/app/api/driver-app/shift/[id]/route.ts
 *
 * GET /api/driver-app/shift/[id] — return the full shift with the
 * checklist items, fuel entries, and expense entries for the detail
 * view on the shift history page.
 *
 * Returns 404 if the shift doesn't belong to this driver (tenant
 * + driver_id mismatch). The endpoint doesn't enforce a status
 * (ACTIVE / CLOSED) — both states are valid for the detail view.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDriverSession } from '@/lib/driver-session';

export async function GET(req: NextRequest, ctx2: { params: Promise<{ id: string }> }) {
  const { id: shiftId } = await ctx2.params;
  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  // Verify the shift belongs to this driver.
  const shiftRow = await prisma.$queryRaw<Array<{
    id: string;
    started_at: Date;
    ended_at: Date | null;
    status: string;
    checklist: unknown;
    checklist_signed_at: Date | null;
  }>>`
    SELECT id, started_at, ended_at, status, checklist, checklist_signed_at
    FROM shifts
    WHERE id = ${shiftId}::uuid
      AND tenant_id = ${ctx.tenantId}::uuid
      AND driver_id = ${ctx.userId}::uuid
    LIMIT 1
  `;
  if (shiftRow.length === 0) {
    return NextResponse.json({ error: 'shift not found' }, { status: 404 });
  }
  const s = shiftRow[0];

  const fuelRows = await prisma.$queryRaw<Array<{
    id: string;
    liters: unknown;
    cost_minor: number;
    currency: string;
    location_name: string | null;
    filled_at: Date;
  }>>`
    SELECT id, liters, cost_minor, currency, location_name, filled_at
    FROM fuel_entries
    WHERE shift_id = ${shiftId}::uuid
      AND tenant_id = ${ctx.tenantId}::uuid
      AND driver_id = ${ctx.userId}::uuid
    ORDER BY filled_at DESC
  `;

  const expenseRows = await prisma.$queryRaw<Array<{
    id: string;
    category: string;
    amount_minor: number;
    currency: string;
    description: string | null;
    incurred_at: Date;
  }>>`
    SELECT id, category, amount_minor, currency, description, incurred_at
    FROM expense_entries
    WHERE shift_id = ${shiftId}::uuid
      AND tenant_id = ${ctx.tenantId}::uuid
      AND driver_id = ${ctx.userId}::uuid
    ORDER BY incurred_at DESC
  `;

  return NextResponse.json({
    shift: {
      id: s.id,
      startedAt: s.started_at.toISOString(),
      endedAt: s.ended_at?.toISOString() ?? null,
      status: s.status,
      checklist: s.checklist,
      checklistSignedAt: s.checklist_signed_at?.toISOString() ?? null,
      fuelEntries: fuelRows.map((f) => ({
        id: f.id,
        liters: Number(f.liters),
        costMinor: f.cost_minor,
        currency: f.currency,
        locationName: f.location_name,
        filledAt: f.filled_at.toISOString(),
      })),
      expenseEntries: expenseRows.map((e) => ({
        id: e.id,
        category: e.category,
        amountMinor: e.amount_minor,
        currency: e.currency,
        description: e.description,
        incurredAt: e.incurred_at.toISOString(),
      })),
    },
  });
}
