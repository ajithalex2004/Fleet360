/**
 * End-to-end smoke for lane profitability analytics (Gap #10).
 *
 * Seeds three shipments on two lanes with known margin numbers, calls
 * the aggregate query the API endpoint runs, verifies the rollup.
 * Hitting the HTTP endpoint requires an operator session which our
 * smokes don't have, so we run the same SQL the route runs.
 */

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

const TENANT_ID = randomUUID();  // unique tenant per run so other data doesn't bleed in
const p = new PrismaClient();
const fail = (msg, extra) => {
  console.error('\n❌', msg);
  if (extra) console.error('  ', typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
};
const ok = (m) => console.log('✓', m);

async function step(name, fn) {
  process.stdout.write(`\n→ ${name}\n`);
  try { return await fn(); }
  catch (e) { fail(`${name} threw: ${e.message || e}`, e.stack?.split('\n').slice(0, 4).join('\n')); }
}

const shipmentIds = [];

async function seedShipment(args) {
  const id = randomUUID();
  const shipmentNo = `LANE-SMK-${args.label}-${id.slice(0,6)}`;
  await p.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders (
       id, tenant_id, shipment_no, status, currency,
       origin_name, destination_name,
       customer_rate_amount, carrier_cost_amount, margin_amount,
       quoted_contract_id,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'PENDING', 'AED', $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
    id, TENANT_ID, shipmentNo,
    args.origin, args.destination,
    args.customerRate, args.carrierCost, args.customerRate - args.carrierCost,
    args.contractId ?? null,
  );
  shipmentIds.push(id);
  return id;
}

(async () => {
  // Three shipments on two lanes:
  //   Dubai → Abu Dhabi : 2 shipments, +200 margin each = +400, with contract
  //   Sharjah → RAK     : 1 shipment, -150 margin (loss), no contract
  const contractId = randomUUID();

  await step('Seed 3 shipments across 2 lanes', async () => {
    // Need a contract row that the lanes endpoint can reference
    await p.$executeRawUnsafe(
      `INSERT INTO logistics_rate_contracts (id, tenant_id, customer_id, customer_name, contract_no,
         lane_origin, lane_destination, vehicle_type, currency, base_rate, min_charge, fuel_surcharge_pct, status, effective_from, effective_to)
       VALUES ($1, $2, NULL, NULL, 'RC-LANE-SMK', 'Dubai', 'Abu Dhabi', NULL, 'AED', 1000, 0, 0, 'ACTIVE', '2026-01-01', '2026-12-31')`,
      contractId, TENANT_ID,
    );
    await seedShipment({ label: 'a', origin: 'Dubai',   destination: 'Abu Dhabi',   customerRate: 1200, carrierCost: 1000, contractId });
    await seedShipment({ label: 'b', origin: 'Dubai',   destination: 'Abu Dhabi',   customerRate: 1100, carrierCost:  900, contractId });
    await seedShipment({ label: 'c', origin: 'Sharjah', destination: 'Ras Al Khaimah', customerRate: 350, carrierCost: 500 });
    ok('3 shipments seeded — 2 on Dubai→AD (profitable), 1 on Sharjah→RAK (loss)');
  });

  await step('Run the lane analytics SQL', async () => {
    const days = 90;
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const rows = await p.$queryRawUnsafe(
      `SELECT
         COALESCE(NULLIF(TRIM(origin_name), ''), '(unknown)')      AS origin,
         COALESCE(NULLIF(TRIM(destination_name), ''), '(unknown)') AS destination,
         COUNT(*)::bigint                            AS shipments,
         SUM(COALESCE(customer_rate_amount, 0))::text AS revenue,
         SUM(COALESCE(carrier_cost_amount, 0))::text  AS carrier_cost,
         SUM(
           COALESCE(margin_amount,
                    COALESCE(customer_rate_amount, 0) - COALESCE(carrier_cost_amount, 0))
         )::text                                      AS margin_sum,
         BOOL_OR(quoted_contract_id IS NOT NULL)      AS has_contract
       FROM logistics_shipment_orders
       WHERE tenant_id = $1
         AND deleted_at IS NULL
         AND created_at >= $2::timestamptz
         AND created_at <  $3::timestamptz
         AND COALESCE(customer_rate_amount, 0) > 0
       GROUP BY origin, destination
       ORDER BY shipments DESC`,
      TENANT_ID, from, to,
    );
    console.log('   raw rows:', JSON.stringify(rows.map(r => ({
      lane: `${r.origin}→${r.destination}`,
      shipments: Number(r.shipments),
      revenue: Number(r.revenue),
      margin: Number(r.margin_sum),
      hasContract: r.has_contract,
    }))));

    if (rows.length !== 2) fail(`expected 2 lanes, got ${rows.length}`);

    const dubai = rows.find(r => r.origin === 'Dubai');
    if (!dubai) fail('Dubai→Abu Dhabi lane not found');
    if (Number(dubai.shipments) !== 2) fail(`Dubai lane shipments ${dubai.shipments} != 2`);
    if (Math.abs(Number(dubai.revenue) - 2300) > 0.01) fail(`Dubai revenue ${dubai.revenue} != 2300`);
    if (Math.abs(Number(dubai.margin_sum) - 400) > 0.01) fail(`Dubai margin ${dubai.margin_sum} != 400`);
    if (!dubai.has_contract) fail('Dubai lane should be flagged hasContract=true');

    const sharjah = rows.find(r => r.origin === 'Sharjah');
    if (!sharjah) fail('Sharjah→RAK lane not found');
    if (Math.abs(Number(sharjah.margin_sum) - (-150)) > 0.01) fail(`Sharjah margin ${sharjah.margin_sum} != -150`);
    if (sharjah.has_contract) fail('Sharjah lane should be flagged hasContract=false');

    ok('aggregation correct: Dubai 2 ships +400 margin (contract), Sharjah 1 ship -150 (no contract)');
  });

  await step('Cleanup', async () => {
    if (shipmentIds.length) {
      await p.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = ANY($1::text[])`, shipmentIds);
    }
    await p.$executeRawUnsafe(`DELETE FROM logistics_rate_contracts WHERE id = $1`, contractId);
    ok('test data removed');
  });

  console.log('\n🎉 ALL STEPS PASSED — lane analytics rollup is correct.\n');
  await p.$disconnect();
})().catch(async (e) => {
  try {
    if (shipmentIds.length) {
      await p.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = ANY($1::text[])`, shipmentIds).catch(() => {});
    }
  } catch {}
  fail('uncaught', e);
});
