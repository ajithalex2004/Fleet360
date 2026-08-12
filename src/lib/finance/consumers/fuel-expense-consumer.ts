/**
 * Finance consumer for Fleet fuel events.
 *
 * Closes gap 6 of the mobile-sync doc (docs/architecture/mobile-sync-
 * conflict-resolution.md v0.3).
 *
 * FLOW (when fully wired):
 *   1. Fleet domain emits `finance.fuelExpense` event in the same
 *      Postgres transaction as the FuelTransaction insert. The event
 *      goes into the outbox_events table atomically with the state
 *      change (per the outbox pattern in the data ownership work).
 *   2. The outbox relay picks up the event and dispatches it to
 *      registered consumers.
 *   3. THIS consumer receives the event, validates it, and creates
 *      a FinanceExpense record in the Finance domain.
 *   4. Finance's Command API emits `finance.expenseRecorded` for
 *      downstream consumers (analytics, dashboards, AI workflows).
 *
 * STATUS: Stub only. Full wiring requires:
 *   - The outbox_events table (Phase 4 of data ownership work)
 *   - The outbox relay (background worker)
 *   - The Fleet fuel Command to actually emit the event
 *   - This consumer to be registered with the relay
 *
 * Until those exist, this file is a contract spec, not runnable
 * infrastructure. The handler function CAN be called directly with
 * a mock event for unit testing the Finance-side logic in isolation.
 * That is the recommended use case for this file today.
 */

import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

// ─── Event contract ────────────────────────────────────────────
// The shape of the event emitted by the Fleet domain. Versioned so
// future changes to the contract are explicit and the consumer can
// reject events it doesn't understand.

export const FuelExpenseEventSchema = z.object({
  eventId: z.string().uuid(),
  eventVersion: z.literal("1.0"),
  occurredAt: z.string().datetime(),

  // Tenant scoping
  tenantId: z.string(),

  // Source-of-truth references
  fuelTransactionId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid().optional(),

  // The data needed to create the FinanceExpense
  amount: z.number().int().nonnegative(),       // in minor units (fils/cents)
  currency: z.string().length(3),               // ISO 4217
  fuelType: z.string(),                          // PETROL | DIESEL | etc.
  volumeLiters: z.number().nonnegative(),
  costPerLiter: z.number().nonnegative(),
  vendor: z.string().optional(),
  odometer: z.number().int().nonnegative().optional(),
  receiptPhotoUrl: z.string().url().optional(),
  notes: z.string().max(500).optional(),

  // Audit
  reportedBy: z.string().uuid(),                 // driver or staff
  reportedAt: z.string().datetime(),
});
export type FuelExpenseEvent = z.infer<typeof FuelExpenseEventSchema>;

// ─── Handler ────────────────────────────────────────────────────
// Creates a FinanceExpense from a validated fuel event. Idempotent
// on (tenantId, fuelTransactionId) — re-processing the same event
// returns the existing expense and does not create a duplicate.

export type FuelExpenseConsumerResult =
  | { ok: true; expenseId: string; created: boolean }
  | {
      ok: false;
      code:
        | "INVALID_EVENT"
        | "VEHICLE_NOT_FOUND"
        | "DRIVER_NOT_FOUND"
        | "EXPENSE_CREATION_FAILED";
      message: string;
    };

export type FuelExpenseConsumerContext = {
  db: PrismaClient;
  idGen: () => string;
  clock: { now(): Date };
};

export async function handleFuelExpenseEvent(
  event: FuelExpenseEvent,
  ctx: FuelExpenseConsumerContext,
): Promise<FuelExpenseConsumerResult> {
  // 1. Idempotency: re-processing the same event returns the existing
  //    expense. The `referenceNo` field carries the source event id,
  //    so we can dedup without a separate idempotency table.
  // Idempotency key: referenceNo carries the source fuelTransactionId,
  // which is a UUID unique across tenants. tenantId is not a Prisma
  // filter field on FinanceExpense, so we rely on referenceNo alone.
  const existing = await ctx.db.financeExpense.findFirst({
    where: {
      referenceNo: event.fuelTransactionId,
    },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, expenseId: existing.id, created: false };
  }

  // 2. Verify the vehicle exists and is in the right tenant. Fleet
  //    owns the vehicle; this is a sanity check, not an authorization
  //    check (the Fleet event emission should already be tenant-scoped).
  const vehicle = await ctx.db.vehicle.findUnique({
    where: { id: event.vehicleId },
    select: { id: true, tenantId: true },
  });
  if (!vehicle || vehicle.tenantId !== event.tenantId) {
    return {
      ok: false,
      code: "VEHICLE_NOT_FOUND",
      message: `Vehicle ${event.vehicleId} not found or wrong tenant`,
    };
  }

  // 3. If a driver is specified, verify the driver is in the right tenant.
  if (event.driverId) {
    const driver = await ctx.db.driver.findUnique({
      where: { id: event.driverId },
      select: { id: true, tenantId: true },
    });
    if (!driver || driver.tenantId !== event.tenantId) {
      return {
        ok: false,
        code: "DRIVER_NOT_FOUND",
        message: `Driver ${event.driverId} not found or wrong tenant`,
      };
    }
  }

  // 4. Create the FinanceExpense. Per the data ownership work, the
  //    Finance domain is the SOLE writer of finance_expenses. This
  //    consumer is the seam through which operational data becomes
  //    a financial record.
  try {
    const amountMajor = event.amount / 100;  // convert minor → major units
    const expense = await ctx.db.financeExpense.create({
      data: {
        id: ctx.idGen(),
        expenseNo: `FUEL-${event.fuelTransactionId.slice(0, 8).toUpperCase()}`,
        category: "FUEL",
        subCategory: event.fuelType,
        description: `Fuel: ${event.volumeLiters}L @ ${event.costPerLiter} ${event.currency}/L from ${event.vendor ?? "unknown"}`,
        amount: amountMajor,
        currency: event.currency,
        totalAmount: amountMajor,
        expenseDate: new Date(event.reportedAt),
        paymentMethod: null, // set later by Finance's payment flow
        referenceNo: event.fuelTransactionId,
        status: "SUBMITTED",
        vehicleId: event.vehicleId,
        driverId: event.driverId ?? null,
        costCentre: "FLEET",
        receiptUrl: event.receiptPhotoUrl,
        submittedBy: event.reportedBy,
        submittedAt: ctx.clock.now(),
        notes: event.notes,
        // Tenant scope — FinanceExpense.tenantId is the canonical
        // ownership field. The Fleet-side event already encodes the
        // tenant, and we copy it onto the Finance row so downstream
        // queries (and RLS, when it lands) can isolate by tenant.
        tenantId: event.tenantId,
      },
    });
    return { ok: true, expenseId: expense.id, created: true };
  } catch (err) {
    return {
      ok: false,
      code: "EXPENSE_CREATION_FAILED",
      message: String(err),
    };
  }
}

// ─── Future wiring (DO NOT IMPLEMENT UNTIL OUTBOX IS BUILT) ───
// When the outbox infrastructure is in place, the relay will call
// handleFuelExpenseEvent for events with type === "finance.fuelExpense".
// Until then, this consumer is invoked only by direct unit tests.
//
// Example future wiring:
//
//   import { outboxRelay } from "@/infra/outbox";
//   import { prisma } from "@/lib/prisma";
//   import { uuidIdGen, systemClock } from "@/infra/runtime";
//
//   outboxRelay.register("finance.fuelExpense", async (rawEvent) => {
//     const parsed = FuelExpenseEventSchema.safeParse(rawEvent);
//     if (!parsed.success) {
//       return { ok: false, code: "INVALID_EVENT", message: parsed.error.message };
//     }
//     return handleFuelExpenseEvent(parsed.data, {
//       db: prisma,
//       idGen: uuidIdGen,
//       clock: systemClock,
//     });
//   });
//
// Until then, test the handler directly:
//
//   import { handleFuelExpenseEvent } from "./fuel-expense-consumer";
//   const result = await handleFuelExpenseEvent(mockEvent, testContext);
//   expect(result.ok).toBe(true);
