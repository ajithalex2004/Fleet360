/**
 * Registers the Finance domain's event consumers with the outbox
 * registry. This file is imported (transitively) by the publisher
 * at startup, so all Finance consumers are wired up before the
 * first tick.
 *
 * Adding a new Finance consumer:
 *   1. Create the handler in a new file (e.g. `credit-note-consumer.ts`)
 *   2. Add a `register(...)` call below
 *   3. Add a smoke test in scripts/test-outbox-flow.ts
 *
 * The registry is idempotent — calling register() twice with the
 * same event_type overwrites the prior consumer. Safe to import
 * from anywhere in the Next.js process.
 *
 * Note: this file intentionally does NOT import `@/lib/prisma`.
 * The PrismaClient is injected by the publisher at tick time so
 * the publisher can run in any process (long-lived worker, cron
 * tick, test) without depending on the Next.js-coupled prisma.ts.
 */
import type { PrismaClient } from '@prisma/client';
import { register } from '../../outbox/registry.ts';
import { handleFuelExpenseEvent, FuelExpenseEventSchema } from './fuel-expense-consumer.ts';
import {
  handleTripCompletedEvent,
  TripCompletedEventSchema,
} from './trip-completed-consumer.ts';

// ── finance.fuelExpense ─────────────────────────────────────────
// Fleet emits this when a fuel transaction is recorded. Finance
// consumes it to create a FinanceExpense, which is the Finance
// domain's authoritative record of the spend. Per the data
// ownership work, the Fleet domain cannot write to FinanceExpense
// directly — this consumer is the seam.
register('finance.fuelExpense', {
  consumerName: 'finance-fuel-expense',
  async handle(event, prisma: PrismaClient) {
    // Parse + narrow the payload to the typed event.
    const parsed = FuelExpenseEventSchema.safeParse(event.payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid fuel expense event payload: ${parsed.error.message}`,
      );
    }

    const result = await handleFuelExpenseEvent(parsed.data, {
      db: prisma,
      idGen: () => crypto.randomUUID(),
      clock: { now: () => new Date() },
    });

    if (!result.ok) {
      throw new Error(
        `Fuel expense consumer failed: ${result.code} — ${result.message}`,
      );
    }
  },
});

// ── trip.completed (R5 fix 2026-08-13) ────────────────────────────
// Bus-ops emits this when a TripSchedule transitions to COMPLETED.
// Finance consumes it to mirror operating costs (DRAFT JE on
// 5145 Bus Operations Expense) and (when farePerHead > 0) the
// revenue side (AR invoice). The dispatch is durable and retried
// via the outbox publisher — a failed finance mirror no longer
// leaks the trip from the books.
register('trip.completed', {
  consumerName: 'finance-trip-completed',
  async handle(event, prisma: PrismaClient) {
    const parsed = TripCompletedEventSchema.safeParse(event.payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid trip.completed event payload: ${parsed.error.message}`,
      );
    }
    await handleTripCompletedEvent(parsed.data, prisma);
  },
});
