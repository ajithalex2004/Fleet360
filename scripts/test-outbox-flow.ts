/**
 * End-to-end outbox flow test.
 *
 * Verifies the publisher actually dispatches the finance.fuelExpense
 * event from event_outbox to the fuel-expense consumer, which
 * creates a FinanceExpense in the finance schema.
 *
 * Tests:
 *   1. Happy path — valid fuel event → FinanceExpense created,
 *      outbox row marked published, consumer_inbox row inserted
 *   2. Idempotency — second event with same fuelTransactionId
 *      reference: consumer returns ok (created=false), no duplicate
 *      FinanceExpense created
 *   3. Failure path — invalid event payload → outbox row marked
 *      failed with retry_count = 1
 *   4. No consumer registered → outbox row marked published,
 *      skipped from future ticks
 *
 * The test self-creates a Vehicle + Driver with the TEST_TENANT and
 * uses those real UUIDs in the events. Cleanup deletes all test data
 * in a finally block so reruns are safe.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/test-outbox-flow.ts
 */

import { PrismaClient } from '@prisma/client';
import '../src/lib/finance/consumers/index.ts';
import { tick } from '../src/lib/outbox/publisher.ts';
import { list as listRegisteredEvents } from '../src/lib/outbox/registry.ts';

// Fresh PrismaClient (not the Next.js-coupled global one).
// Makes the test runnable in any Node process.
const prisma = new PrismaClient();

const TEST_TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'; // valid UUID
const uuid = () => crypto.randomUUID();

// Pre-allocated test entity IDs. Created in setup, deleted in cleanup.
const TEST_VEHICLE_ID = uuid();
const TEST_DRIVER_ID = uuid();
const TEST_REPORTED_BY = uuid();
const TEST_LICENSE_PLATE = `SMOKE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

let passed = 0, failed = 0;
const failMessages: string[] = [];
function ok(msg: string) { console.log(`  ✅ ${msg}`); passed++; }
function bad(msg: string, e?: unknown) {
  const m = e instanceof Error ? e.message : String(e ?? '');
  console.log(`  ❌ ${msg}${m ? `: ${m}` : ''}`);
  failed++;
  failMessages.push(msg);
}
function expectEq<T>(actual: T, expected: T, what: string) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function setupTestEntities() {
  console.log('\n[setup]');
  // Tenant must exist first — Vehicle/Driver have FK to tenants(id)
  await prisma.tenant.upsert({
    where: { id: TEST_TENANT },
    update: { name: 'Smoke Test Tenant' },
    create: {
      id: TEST_TENANT,
      name: 'Smoke Test Tenant',
      plan: 'STANDARD',
      isActive: true,
    },
  });
  await prisma.vehicle.create({
    data: {
      id: TEST_VEHICLE_ID,
      tenantId: TEST_TENANT,
      make: 'SmokeTest',
      model: 'FuelTest',
      type: 'CAR',
      licensePlate: TEST_LICENSE_PLATE,
    },
  });
  await prisma.driver.create({
    data: {
      id: TEST_DRIVER_ID,
      tenantId: TEST_TENANT,
      firstName: 'Smoke',
      lastName: 'Driver',
      status: 'ACTIVE',
    },
  });
  console.log(`  tenant   ${TEST_TENANT}`);
  console.log(`  vehicle  ${TEST_VEHICLE_ID} (plate ${TEST_LICENSE_PLATE})`);
  console.log(`  driver   ${TEST_DRIVER_ID}`);
  console.log(`  reportedBy ${TEST_REPORTED_BY}`);
  console.log(`  registered consumers: ${listRegisteredEvents().join(', ')}`);
  if (!listRegisteredEvents().includes('finance.fuelExpense')) {
    throw new Error('fuel-expense consumer is not registered');
  }
  ok('test entities + fuel-expense consumer ready');
}

async function teardownTestEntities() {
  console.log('\n[cleanup]');
  try {
    // Clean in dependency-safe order:
    // 1. FinanceExpense (text tenant_id) — uses referenceNo from test events
    await prisma.$executeRaw`DELETE FROM finance.finance_expenses WHERE tenant_id = ${TEST_TENANT}`;
    // 2. consumer_inbox + outbox (uuid tenant_id)
    await prisma.$executeRaw`DELETE FROM event_consumer_inbox WHERE tenant_id = ${TEST_TENANT}::uuid`;
    await prisma.$executeRaw`DELETE FROM event_outbox WHERE tenant_id = ${TEST_TENANT}::uuid`;
    // 3. Driver + Vehicle
    await prisma.driver.delete({ where: { id: TEST_DRIVER_ID } }).catch(() => {});
    await prisma.vehicle.delete({ where: { id: TEST_VEHICLE_ID } }).catch(() => {});
    // 4. Tenant (last; other rows FK to it)
    await prisma.tenant.delete({ where: { id: TEST_TENANT } }).catch(() => {});
    ok(`swept test data for tenant ${TEST_TENANT}`);
  } catch (e) { bad('cleanup', e); }
}

try {
  await setupTestEntities();

  // ── 1. Happy path ──────────────────────────────────────────────
  console.log('\n[1] Happy path — valid fuel event → FinanceExpense');
  let happyEventId: string | undefined;
  let happyFuelTxId: string | undefined;
  try {
    const eventId = uuid();
    happyEventId = eventId;
    const fuelTransactionId = uuid();
    happyFuelTxId = fuelTransactionId;
    const fuelEvent = {
      eventId,
      eventVersion: '1.0',
      occurredAt: new Date().toISOString(),
      tenantId: TEST_TENANT,
      fuelTransactionId,
      vehicleId: TEST_VEHICLE_ID,
      driverId: TEST_DRIVER_ID,
      amount: 5000, // 50.00 AED in fils
      currency: 'AED',
      fuelType: 'PETROL',
      volumeLiters: 12.5,
      costPerLiter: 4.0,
      vendor: 'Smoke Fuel Station',
      odometer: 50000,
      receiptPhotoUrl: 'https://example.com/receipt.jpg',
      notes: 'smoke test fuel',
      reportedBy: TEST_REPORTED_BY,
      reportedAt: new Date().toISOString(),
    };

    await prisma.$executeRaw`
      INSERT INTO event_outbox
        (event_id, event_type, event_version, aggregate_type, aggregate_id,
         source_module, tenant_id, actor, payload, occurred_at)
      VALUES
        (${eventId}::uuid, 'finance.fuelExpense', '1.0', 'FuelTransaction',
         ${fuelTransactionId}::text, 'fleet',
         ${TEST_TENANT}::uuid, ${TEST_REPORTED_BY},
         ${JSON.stringify(fuelEvent)}::jsonb, NOW())
    `;

    const result = await tick(prisma, { batchSize: 10, maxRetries: 10 });
    expectEq(result.total, 1, 'events considered');
    expectEq(result.dispatched, 1, 'events dispatched');
    expectEq(result.failed, 0, 'events failed');
    ok('tick dispatched the fuel event');

    // Outbox row → published
    const ob = await prisma.$queryRaw<{ published_at: Date | null; failed_at: Date | null; retry_count: number }[]>`
      SELECT published_at, failed_at, retry_count FROM event_outbox WHERE event_id = ${eventId}::uuid
    `;
    expectEq(ob.length, 1, 'outbox row found');
    expectEq(ob[0].published_at !== null, true, 'outbox row published_at set');
    expectEq(ob[0].failed_at, null, 'outbox row failed_at is null');
    expectEq(ob[0].retry_count, 0, 'outbox row retry_count is 0');
    ok('outbox row marked published with no failures');

    // consumer_inbox row → PROCESSED
    const ci = await prisma.$queryRaw<{ status: string }[]>`
      SELECT status FROM event_consumer_inbox
       WHERE consumer_name = 'finance-fuel-expense' AND event_id = ${eventId}::uuid
    `;
    expectEq(ci.length, 1, 'consumer_inbox rows');
    expectEq(ci[0].status, 'PROCESSED', 'consumer_inbox status');
    ok('consumer_inbox has PROCESSED row');

    // FinanceExpense actually created
    const expenses = await prisma.$queryRaw<{ expense_no: string; amount: number; description: string; reference_no: string }[]>`
      SELECT expense_no, amount::float, description, reference_no
        FROM finance.finance_expenses
       WHERE tenant_id = ${TEST_TENANT}
         AND reference_no = ${fuelTransactionId}::text
    `;
    expectEq(expenses.length, 1, 'FinanceExpenses created');
    expectEq(expenses[0].description.includes('12.5L'), true, 'expense description includes volume');
    expectEq(expenses[0].reference_no, fuelTransactionId, 'reference_no matches fuelTransactionId');
    ok('FinanceExpense was created from the event');
  } catch (e) { bad('happy path', e); }

  // ── 2. Idempotency — duplicate fuelTransactionId, different event_id ──
  // The consumer's dedup is keyed on FinanceExpense.referenceNo ==
  // event.fuelTransactionId. A new outbox event with the same ref
  // should be dispatched (different event_id → new consumer_inbox row)
  // but the consumer should NOT create a second FinanceExpense.
  console.log('\n[2] Idempotency — duplicate fuelTransactionId is deduped');
  try {
    if (!happyFuelTxId) throw new Error('no happyFuelTxId from test 1');

    // Snapshot the FinanceExpense count for this ref BEFORE the duplicate
    const beforeCount = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.finance_expenses
       WHERE tenant_id = ${TEST_TENANT} AND reference_no = ${happyFuelTxId}::text
    `;
    expectEq(beforeCount[0].n, 1, 'FinanceExpense count before duplicate');

    const dupEventId = uuid();
    const dupFuelEvent = {
      eventId: dupEventId,
      eventVersion: '1.0',
      occurredAt: new Date().toISOString(),
      tenantId: TEST_TENANT,
      fuelTransactionId: happyFuelTxId, // SAME as test 1 — triggers dedup
      vehicleId: TEST_VEHICLE_ID,
      driverId: TEST_DRIVER_ID,
      amount: 7500, // different amount, should be ignored
      currency: 'AED',
      fuelType: 'PETROL',
      volumeLiters: 18.0,
      costPerLiter: 4.17,
      vendor: 'Smoke Fuel Station 2',
      reportedBy: TEST_REPORTED_BY,
      reportedAt: new Date().toISOString(),
    };

    await prisma.$executeRaw`
      INSERT INTO event_outbox
        (event_id, event_type, event_version, aggregate_type, aggregate_id,
         source_module, tenant_id, actor, payload, occurred_at)
      VALUES
        (${dupEventId}::uuid, 'finance.fuelExpense', '1.0', 'FuelTransaction',
         ${happyFuelTxId}::text, 'fleet',
         ${TEST_TENANT}::uuid, ${TEST_REPORTED_BY},
         ${JSON.stringify(dupFuelEvent)}::jsonb, NOW())
    `;

    const result2 = await tick(prisma, { batchSize: 10, maxRetries: 10 });
    expectEq(result2.total, 1, 'second tick considered 1 event');
    expectEq(result2.dispatched, 1, 'second tick dispatched the duplicate event');
    expectEq(result2.failed, 0, 'second tick failed = 0 (consumer dedup returned ok)');
    ok('second event dispatched (consumer deduped by referenceNo)');

    // No second FinanceExpense created
    const afterCount = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM finance.finance_expenses
       WHERE tenant_id = ${TEST_TENANT} AND reference_no = ${happyFuelTxId}::text
    `;
    expectEq(afterCount[0].n, 1, 'FinanceExpense count after duplicate (still 1)');
    ok('no duplicate FinanceExpense created');

    // Third tick — nothing pending, no-op
    const result3 = await tick(prisma, { batchSize: 10, maxRetries: 10 });
    expectEq(result3.total, 0, 'third tick considered 0 events');
    expectEq(result3.dispatched, 0, 'third tick dispatched 0');
    ok('third tick is a no-op (no pending events)');
  } catch (e) { bad('idempotency', e); }

  // ── 3. Failure path — invalid event payload ────────────────────────
  console.log('\n[3] Failure path — invalid event payload');
  let failureEventId: string | undefined;
  try {
    const eventId = uuid();
    failureEventId = eventId;
    // Missing required field "amount" → Zod parse fails → consumer throws
    const invalidPayload = {
      eventId,
      eventVersion: '1.0',
      occurredAt: new Date().toISOString(),
      tenantId: TEST_TENANT,
      fuelTransactionId: uuid(),
      vehicleId: TEST_VEHICLE_ID,
      // amount intentionally missing
      currency: 'AED',
      fuelType: 'PETROL',
      volumeLiters: 1,
      costPerLiter: 1,
      reportedBy: TEST_REPORTED_BY,
      reportedAt: new Date().toISOString(),
    };

    await prisma.$executeRaw`
      INSERT INTO event_outbox
        (event_id, event_type, event_version, aggregate_type, aggregate_id,
         source_module, tenant_id, actor, payload, occurred_at)
      VALUES
        (${eventId}::uuid, 'finance.fuelExpense', '1.0', 'FuelTransaction',
         ${invalidPayload.fuelTransactionId}::text, 'fleet',
         ${TEST_TENANT}::uuid, ${TEST_REPORTED_BY},
         ${JSON.stringify(invalidPayload)}::jsonb, NOW())
    `;

    const result = await tick(prisma, { batchSize: 10, maxRetries: 10 });
    expectEq(result.total, 1, 'failure tick considered 1 event');
    expectEq(result.failed, 1, 'events failed');
    expectEq(result.dispatched, 0, 'no successful dispatch');
    ok('invalid event marked as failed');

    const ob = await prisma.$queryRaw<{ failed_at: Date | null; retry_count: number; failure_reason: string }[]>`
      SELECT failed_at, retry_count, failure_reason
        FROM event_outbox
       WHERE event_id = ${eventId}::uuid
    `;
    expectEq(ob[0].failed_at !== null, true, 'failed_at set');
    expectEq(ob[0].retry_count, 1, 'retry_count incremented');
    expectEq(
      ob[0].failure_reason?.includes('Invalid fuel expense'),
      true,
      'failure reason recorded',
    );
    ok('outbox row has failed_at, retry_count=1, failure_reason recorded');
  } catch (e) { bad('failure path', e); }

  // Clean up the failed event so it doesn't keep re-firing in test 4
  if (failureEventId) {
    await prisma.$executeRaw`DELETE FROM event_outbox WHERE event_id = ${failureEventId}::uuid`;
  }

  // ── 4. No consumer registered ─────────────────────────────────────
  console.log('\n[4] No consumer registered — event skipped');
  try {
    const eventId = uuid();
    await prisma.$executeRaw`
      INSERT INTO event_outbox
        (event_id, event_type, event_version, aggregate_type, aggregate_id,
         source_module, tenant_id, actor, payload, occurred_at)
      VALUES
        (${eventId}::uuid, 'unknown.event.type', '1.0', 'Test', 'x',
         'test', ${TEST_TENANT}::uuid, ${TEST_REPORTED_BY},
         '{}'::jsonb, NOW())
    `;

    const result = await tick(prisma, { batchSize: 10, maxRetries: 10 });
    expectEq(result.total, 1, 'no-consumer tick considered 1 event');
    expectEq(result.skipped, 1, 'events skipped');
    expectEq(result.dispatched, 0, 'events dispatched');
    expectEq(result.failed, 0, 'events failed');
    ok('unknown event_type marked as skipped');

    const ob = await prisma.$queryRaw<{ published_at: Date | null }[]>`
      SELECT published_at FROM event_outbox WHERE event_id = ${eventId}::uuid
    `;
    expectEq(ob[0].published_at !== null, true, 'unknown event marked published');
    ok('skipped event has published_at set (so it won\'t re-poll)');
  } catch (e) { bad('no consumer', e); }

} finally {
  await teardownTestEntities();
  await prisma.$disconnect();
}

console.log('\n=========================================');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('=========================================');
if (failed > 0) {
  console.log('\nFailures:');
  failMessages.forEach((m) => console.log(`  - ${m}`));
  process.exit(1);
}
process.exit(0);
