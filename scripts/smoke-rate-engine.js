/**
 * End-to-end smoke test for the rate-matrix engine (Gap #1).
 *
 * Exercises the production path through the only public-by-default
 * shipper-portal endpoint, so the test doesn't need an operator session:
 *
 *   1. Seed: customer → rate contract → portal user + invitation
 *      (all via Prisma; we'd otherwise need an operator session to call
 *      the invitation API)
 *   2. POST /api/shipper-portal/auth/setup with the raw token —
 *      returns a real shipper-portal-session cookie
 *   3. POST /api/shipper-portal/shipments — the engine runs inside this
 *      request and writes customer_rate_amount + quoted_contract_id +
 *      metadata.rateQuote
 *   4. Verify via Prisma that the engine produced the expected values
 *      AND that the coverage SQL (the same query /rates/coverage uses)
 *      includes our shipment
 *   5. Cleanup
 *
 * Run:
 *   node scripts/smoke-rate-engine.js
 *
 * Requires the Next.js dev server running on http://localhost:3000.
 */

const { PrismaClient } = require('@prisma/client');
const { randomUUID, randomBytes, createHash } = require('crypto');

const TENANT_ID = process.env.SMOKE_TENANT_ID || 'd30be645-4c72-435a-84e1-345337137ba8';
const OPERATOR_USER_ID = process.env.SMOKE_OPERATOR_USER_ID || 'f8f58ad5-b64b-4869-b061-de66c073ec3b';
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

const p = new PrismaClient();

const fail = (msg, extra) => {
  console.error('\n❌', msg);
  if (extra) console.error('  ', typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
};
const ok = (msg) => console.log('✓', msg);

async function step(name, fn) {
  process.stdout.write(`\n→ ${name}\n`);
  try { return await fn(); }
  catch (e) {
    fail(`${name} threw: ${e.message || JSON.stringify(e)}`, e.stack?.split('\n').slice(0, 4).join('\n'));
  }
}

const RUN_ID = Date.now().toString(36);
const LANE_ORIGIN = `Smoke Origin ${RUN_ID}`;
const LANE_DEST = `Smoke Dest ${RUN_ID}`;
const customerId = randomUUID();
const contractId = randomUUID();
const portalUserId = randomUUID();
const customerEmail = `smoke-rate+${RUN_ID}@example.com`;

let shipmentId;

(async () => {
  // ─── 1. Seed via Prisma ─────────────────────────────────────────────────
  await step('Seed customer + customer-specific rate contract', async () => {
    await p.$executeRawUnsafe(
      `INSERT INTO customers (id, tenant_id, customer_type, name_en, email, mobile_number, portal_tracking_level, created_at, updated_at)
       VALUES ($1, $2, 'CORPORATE', $3, $4, '+971500000000', 'STATUS_AND_ETA', NOW(), NOW())`,
      customerId, TENANT_ID, `Smoke Rate Co ${RUN_ID}`, customerEmail,
    );
    await p.$executeRawUnsafe(
      `INSERT INTO logistics_rate_contracts (
         id, tenant_id, customer_id, customer_name, contract_no,
         lane_origin, lane_destination, vehicle_type, currency,
         base_rate, min_charge, fuel_surcharge_pct, status,
         effective_from, effective_to
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'REEFER','AED',1200,0,10,'ACTIVE','2026-01-01','2026-12-31')`,
      contractId, TENANT_ID, customerId, `Smoke Rate Co ${RUN_ID}`,
      `RC-SMOKE-${RUN_ID}`, LANE_ORIGIN, LANE_DEST,
    );
    ok(`customer ${customerId.slice(0,8)} + contract RC-SMOKE-${RUN_ID} (base 1200 + 10% fuel = 1320)`);
  });

  const rawToken = randomBytes(32).toString('hex');
  await step('Seed portal user + invitation directly via Prisma', async () => {
    await p.$executeRawUnsafe(
      `INSERT INTO customer_portal_users (id, tenant_id, customer_id, email, full_name, role, is_active, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, 'SHIPPER_ADMIN', TRUE, NOW(), NOW())`,
      portalUserId, TENANT_ID, customerId, customerEmail, 'Smoke Rate Shipper',
    );
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await p.$executeRawUnsafe(
      `INSERT INTO customer_portal_invitations (tenant_id, portal_user_id, token_hash, expires_at, invited_by_user_id)
       VALUES ($1, $2::uuid, $3, $4::timestamptz, $5)`,
      TENANT_ID, portalUserId, tokenHash, expiresAt, OPERATOR_USER_ID,
    );
    ok(`portal user ${portalUserId.slice(0,8)} + invitation with raw token`);
  });

  // ─── 2. Shipper accepts invitation → session cookie ─────────────────────
  let sessionCookie;
  await step('POST /api/shipper-portal/auth/setup (public)', async () => {
    const res = await fetch(`${BASE}/api/shipper-portal/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken, password: 'SmokeRate1234!Aa', email: customerEmail }),
    });
    if (!res.ok) fail(`setup failed ${res.status}`, await res.text());
    sessionCookie = res.headers.get('set-cookie')?.match(/shipper-portal-session=[^;]+/)?.[0];
    if (!sessionCookie) fail('no session cookie issued');
    ok(`shipper session established`);
  });

  // ─── 3. Submit a shipment — engine runs inside this request ─────────────
  await step('POST /api/shipper-portal/shipments — engine should auto-price', async () => {
    const res = await fetch(`${BASE}/api/shipper-portal/shipments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({
        pickup: { name: LANE_ORIGIN, address: 'Smoke pickup', city: 'Dubai', country: 'AE' },
        delivery: { name: LANE_DEST, address: 'Smoke delivery', city: 'Abu Dhabi', country: 'AE' },
        cargoLines: [{ description: 'Frozen seafood', quantity: 10, packageType: 'Pallet', weightKg: 250 }],
        priority: 'High',
        requestedVehicleType: 'REEFER',
      }),
    });
    if (!res.ok) fail(`shipment submit failed ${res.status}`, await res.text());
    const data = await res.json();
    shipmentId = data.shipment.id;
    ok(`shipment ${shipmentId.slice(0,8)} created via portal`);
  });

  // ─── 4. Verify the engine wrote everything correctly ────────────────────
  await step('Verify DB: rate + contract id + audit metadata + coverage SQL', async () => {
    const rows = await p.$queryRawUnsafe(
      `SELECT customer_rate_amount::text AS rate,
              quoted_contract_id, currency, metadata
         FROM logistics_shipment_orders WHERE id = $1`,
      shipmentId,
    );
    if (!rows[0]) fail('shipment not found');
    const r = rows[0];
    const rate = Number(r.rate);
    console.log('   DB row:', JSON.stringify({ rate, quoted_contract_id: r.quoted_contract_id, currency: r.currency }));

    if (Math.abs(rate - 1320) > 0.01) fail(`expected rate 1320, got ${rate}`);
    if (r.quoted_contract_id !== contractId) fail(`expected quoted_contract_id=${contractId}, got ${r.quoted_contract_id}`);
    if (r.currency !== 'AED') fail(`expected currency AED, got ${r.currency}`);
    const meta = r.metadata?.rateQuote;
    if (!meta?.matched) fail(`metadata.rateQuote missing or not matched: ${JSON.stringify(meta)}`);
    if (meta.contractNo !== `RC-SMOKE-${RUN_ID}`) fail(`wrong contractNo: ${meta.contractNo}`);
    ok(`rate=${rate} AED, contract id persisted, audit metadata present`);

    // Mirror the /rates/coverage SQL: did our shipment land where the
    // dashboard tile would count it?
    const cov = await p.$queryRawUnsafe(
      `SELECT s.quoted_contract_id, rc.contract_no
         FROM logistics_shipment_orders s
         LEFT JOIN logistics_rate_contracts rc ON rc.id = s.quoted_contract_id
        WHERE s.tenant_id = $1 AND s.id = $2`,
      TENANT_ID, shipmentId,
    );
    if (!cov[0]?.quoted_contract_id) fail('coverage SQL would not count this shipment');
    if (cov[0].contract_no !== `RC-SMOKE-${RUN_ID}`) fail(`coverage join returned wrong contract_no: ${cov[0].contract_no}`);
    ok(`coverage SQL counts this shipment under ${cov[0].contract_no}`);
  });

  // ─── 5. Cleanup ─────────────────────────────────────────────────────────
  await step('Cleanup', async () => {
    if (shipmentId) await p.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = $1`, shipmentId);
    await p.$executeRawUnsafe(`DELETE FROM logistics_rate_contracts WHERE id = $1`, contractId);
    await p.$executeRawUnsafe(`DELETE FROM customer_portal_invitations WHERE portal_user_id = $1::uuid`, portalUserId);
    await p.$executeRawUnsafe(`DELETE FROM customer_portal_users WHERE id = $1::uuid`, portalUserId);
    await p.$executeRawUnsafe(`DELETE FROM customers WHERE id = $1`, customerId);
    ok('test data removed');
  });

  console.log('\n🎉 ALL STEPS PASSED — rate-matrix engine is end-to-end functional.\n');
  await p.$disconnect();
})().catch(async e => {
  // Best-effort cleanup if we crashed partway through
  try {
    if (shipmentId) await p.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = $1`, shipmentId);
    await p.$executeRawUnsafe(`DELETE FROM logistics_rate_contracts WHERE id = $1`, contractId).catch(() => {});
    await p.$executeRawUnsafe(`DELETE FROM customer_portal_invitations WHERE portal_user_id = $1::uuid`, portalUserId).catch(() => {});
    await p.$executeRawUnsafe(`DELETE FROM customer_portal_users WHERE id = $1::uuid`, portalUserId).catch(() => {});
    await p.$executeRawUnsafe(`DELETE FROM customers WHERE id = $1`, customerId).catch(() => {});
  } catch { /* ignore */ }
  fail('uncaught', e);
});
