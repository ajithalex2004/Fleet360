/**
 * End-to-end smoke for the accessorial auto-applier (Gap #2 Day 2).
 *
 * 1. Seed a customer + contract (so the rate engine quotes a base rate)
 * 2. Seed two accessorial catalog entries with auto_apply_rule:
 *      FUEL_SMOKE - 8% of base_rate (always applies)
 *      CUSTOMS_SMOKE - flat 200 AED, requiresCrossBorder
 * 3. Seed portal user + invitation; accept via API
 * 4. Submit two shipments via the portal:
 *      a. AE → AE (domestic) — fuel should fire, customs should NOT
 *      b. AE → SA (cross-border) — both fire
 * 5. Verify logistics_freight_charges has the auto-applied rows
 *    with the correct amounts and metadata.autoApplied=true
 * 6. Cleanup
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
const ok = (m) => console.log('✓', m);

async function step(name, fn) {
  process.stdout.write(`\n→ ${name}\n`);
  try { return await fn(); }
  catch (e) { fail(`${name} threw: ${e.message || e}`, e.stack?.split('\n').slice(0, 4).join('\n')); }
}

const RUN_ID = Date.now().toString(36);
const customerId = randomUUID();
const contractId = randomUUID();
const portalUserId = randomUUID();
const fuelCatalogId = randomUUID();
const customsCatalogId = randomUUID();
const customerEmail = `smoke-accessorial+${RUN_ID}@example.com`;
const LANE_ORIGIN = `Smoke A ${RUN_ID}`;
const LANE_DEST_DOMESTIC = `Smoke B ${RUN_ID}`;
const LANE_DEST_FOREIGN = `Smoke C ${RUN_ID}`;
const shipmentIds = [];

(async () => {
  await step('Seed customer + rate contract', async () => {
    await p.$executeRawUnsafe(
      `INSERT INTO customers (id, tenant_id, customer_type, name_en, email, mobile_number, portal_tracking_level, created_at, updated_at)
       VALUES ($1, $2, 'CORPORATE', $3, $4, '+971500000000', 'STATUS_AND_ETA', NOW(), NOW())`,
      customerId, TENANT_ID, `Smoke Accessorial Co ${RUN_ID}`, customerEmail,
    );
    // Cover both lanes with the same contract
    await p.$executeRawUnsafe(
      `INSERT INTO logistics_rate_contracts (id, tenant_id, customer_id, customer_name, contract_no,
         lane_origin, lane_destination, vehicle_type, currency, base_rate, min_charge, fuel_surcharge_pct, status, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,'AED',1000,0,0,'ACTIVE','2026-01-01','2026-12-31')`,
      contractId, TENANT_ID, customerId, `Smoke Accessorial Co ${RUN_ID}`,
      `RC-AX-${RUN_ID}`, LANE_ORIGIN, LANE_DEST_DOMESTIC,
    );
    await p.$executeRawUnsafe(
      `INSERT INTO logistics_rate_contracts (id, tenant_id, customer_id, customer_name, contract_no,
         lane_origin, lane_destination, vehicle_type, currency, base_rate, min_charge, fuel_surcharge_pct, status, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,'AED',1000,0,0,'ACTIVE','2026-01-01','2026-12-31')`,
      randomUUID(), TENANT_ID, customerId, `Smoke Accessorial Co ${RUN_ID}`,
      `RC-AX-FOREIGN-${RUN_ID}`, LANE_ORIGIN, LANE_DEST_FOREIGN,
    );
    ok(`customer + 2 contracts (both base 1000, no fuel surcharge in contract itself)`);
  });

  await step('Seed two accessorial catalog entries with auto_apply_rule', async () => {
    // FUEL — 8% of base_rate, always applies
    await p.$executeRawUnsafe(
      `INSERT INTO logistics_accessorial_catalog
         (id, tenant_id, code, name, charge_type, default_amount, currency, taxable, auto_apply_rule, status)
       VALUES ($1, $2, $3, 'Smoke Fuel Surcharge', 'FUEL', 0, 'AED', TRUE,
               $4::jsonb, 'ACTIVE')`,
      fuelCatalogId, TENANT_ID, `FUEL_SMK_${RUN_ID.toUpperCase()}`,
      JSON.stringify({ type: 'percentage', basis: 'base_rate', percentage: 8 }),
    );
    // CUSTOMS — flat 200, requiresCrossBorder
    await p.$executeRawUnsafe(
      `INSERT INTO logistics_accessorial_catalog
         (id, tenant_id, code, name, charge_type, default_amount, currency, taxable, auto_apply_rule, status)
       VALUES ($1, $2, $3, 'Smoke Customs', 'CUSTOMS', 0, 'AED', FALSE,
               $4::jsonb, 'ACTIVE')`,
      customsCatalogId, TENANT_ID, `CUSTOMS_SMK_${RUN_ID.toUpperCase()}`,
      JSON.stringify({ type: 'flat', amount: 200, taxable: false, conditions: { requiresCrossBorder: true } }),
    );
    ok(`fuel (8% of base) + customs (flat 200, cross-border) catalog entries seeded`);
  });

  const rawToken = randomBytes(32).toString('hex');
  await step('Seed portal user + invitation', async () => {
    await p.$executeRawUnsafe(
      `INSERT INTO customer_portal_users (id, tenant_id, customer_id, email, full_name, role, is_active, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, 'SHIPPER_ADMIN', TRUE, NOW(), NOW())`,
      portalUserId, TENANT_ID, customerId, customerEmail, 'Smoke Accessorial Shipper',
    );
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await p.$executeRawUnsafe(
      `INSERT INTO customer_portal_invitations (tenant_id, portal_user_id, token_hash, expires_at, invited_by_user_id)
       VALUES ($1, $2::uuid, $3, $4::timestamptz, $5)`,
      TENANT_ID, portalUserId, tokenHash, expiresAt, OPERATOR_USER_ID,
    );
    ok('portal user + invitation seeded');
  });

  let sessionCookie;
  await step('POST /api/shipper-portal/auth/setup', async () => {
    const res = await fetch(`${BASE}/api/shipper-portal/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rawToken, password: 'SmokeAxr1234!Aa', email: customerEmail }),
    });
    if (!res.ok) fail(`setup failed ${res.status}`, await res.text());
    sessionCookie = res.headers.get('set-cookie')?.match(/shipper-portal-session=[^;]+/)?.[0];
    ok('session established');
  });

  async function submitShipment(label, destination, destinationCountry) {
    return step(`POST shipment: ${label}`, async () => {
      const res = await fetch(`${BASE}/api/shipper-portal/shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
        body: JSON.stringify({
          pickup: { name: LANE_ORIGIN, address: 'A', city: 'A', country: 'AE' },
          delivery: { name: destination, address: 'B', city: 'B', country: destinationCountry },
          cargoLines: [{ description: 'Test cargo', quantity: 1, packageType: 'Pallet', weightKg: 100 }],
          priority: 'Medium',
        }),
      });
      if (!res.ok) fail(`submit failed ${res.status}`, await res.text());
      const data = await res.json();
      shipmentIds.push(data.shipment.id);
      ok(`shipment ${data.shipment.id.slice(0,8)} created`);
      return data.shipment.id;
    });
  }

  const domesticId = await submitShipment('domestic AE → AE', LANE_DEST_DOMESTIC, 'AE');
  const foreignId  = await submitShipment('cross-border AE → SA', LANE_DEST_FOREIGN,  'SA');

  // The auto-applier writes freight_charges asynchronously inside the
  // .catch-d block — the API returns BEFORE the inserts settle. Give
  // it a beat.
  await new Promise(r => setTimeout(r, 500));

  await step('Verify domestic shipment: only fuel applied', async () => {
    const charges = await p.$queryRawUnsafe(
      `SELECT charge_type, amount::text, tax_amount::text, metadata
         FROM logistics_freight_charges
        WHERE shipment_order_id = $1 AND tenant_id = $2
          AND (metadata->>'autoApplied') = 'true'`,
      domesticId, TENANT_ID,
    );
    console.log('   charges:', JSON.stringify(charges.map(c => ({ type: c.charge_type, amount: c.amount }))));
    const fuel = charges.find(c => c.charge_type === `FUEL_SMK_${RUN_ID.toUpperCase()}`);
    if (!fuel) fail('fuel charge not auto-applied on domestic shipment');
    if (Math.abs(Number(fuel.amount) - 80) > 0.01) fail(`fuel amount ${fuel.amount} != 80 (8% of 1000)`);
    if (Math.abs(Number(fuel.tax_amount) - 4) > 0.01) fail(`fuel tax ${fuel.tax_amount} != 4 (5% of 80)`);
    if (charges.some(c => c.charge_type === `CUSTOMS_SMK_${RUN_ID.toUpperCase()}`)) fail('customs leaked into domestic shipment');
    ok(`fuel = 80 AED + 4 AED VAT, no customs ✓`);
  });

  await step('Verify cross-border shipment: fuel + customs applied', async () => {
    const charges = await p.$queryRawUnsafe(
      `SELECT charge_type, amount::text, tax_amount::text, metadata
         FROM logistics_freight_charges
        WHERE shipment_order_id = $1 AND tenant_id = $2
          AND (metadata->>'autoApplied') = 'true'`,
      foreignId, TENANT_ID,
    );
    console.log('   charges:', JSON.stringify(charges.map(c => ({ type: c.charge_type, amount: c.amount }))));
    const fuel = charges.find(c => c.charge_type === `FUEL_SMK_${RUN_ID.toUpperCase()}`);
    const customs = charges.find(c => c.charge_type === `CUSTOMS_SMK_${RUN_ID.toUpperCase()}`);
    if (!fuel) fail('fuel not applied on cross-border shipment');
    if (!customs) fail('customs not applied on cross-border shipment');
    if (Math.abs(Number(customs.amount) - 200) > 0.01) fail(`customs amount ${customs.amount} != 200`);
    if (Math.abs(Number(customs.tax_amount)) > 0.01) fail(`customs tax ${customs.tax_amount} != 0 (taxable=false)`);
    if (!customs.metadata?.reason) fail('audit reason missing');
    ok(`fuel + customs applied; customs.metadata.reason="${customs.metadata.reason}"`);
  });

  await step('Cleanup', async () => {
    for (const id of shipmentIds) {
      await p.$executeRawUnsafe(`DELETE FROM logistics_freight_charges WHERE shipment_order_id = $1`, id);
      await p.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = $1`, id);
    }
    await p.$executeRawUnsafe(`DELETE FROM logistics_accessorial_catalog WHERE id = ANY($1::text[])`, [fuelCatalogId, customsCatalogId]);
    await p.$executeRawUnsafe(`DELETE FROM logistics_rate_contracts WHERE tenant_id = $1 AND customer_id = $2`, TENANT_ID, customerId);
    await p.$executeRawUnsafe(`DELETE FROM customer_portal_invitations WHERE portal_user_id = $1::uuid`, portalUserId);
    await p.$executeRawUnsafe(`DELETE FROM customer_portal_users WHERE id = $1::uuid`, portalUserId);
    await p.$executeRawUnsafe(`DELETE FROM customers WHERE id = $1`, customerId);
    ok('test data removed');
  });

  console.log('\n🎉 ALL STEPS PASSED — accessorial auto-applier works end-to-end.\n');
  await p.$disconnect();
})().catch(async (e) => {
  try {
    for (const id of shipmentIds) {
      await p.$executeRawUnsafe(`DELETE FROM logistics_freight_charges WHERE shipment_order_id = $1`, id).catch(() => {});
      await p.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = $1`, id).catch(() => {});
    }
    await p.$executeRawUnsafe(`DELETE FROM logistics_accessorial_catalog WHERE id = ANY($1::text[])`, [fuelCatalogId, customsCatalogId]).catch(() => {});
    await p.$executeRawUnsafe(`DELETE FROM logistics_rate_contracts WHERE tenant_id = $1 AND customer_id = $2`, TENANT_ID, customerId).catch(() => {});
    await p.$executeRawUnsafe(`DELETE FROM customer_portal_invitations WHERE portal_user_id = $1::uuid`, portalUserId).catch(() => {});
    await p.$executeRawUnsafe(`DELETE FROM customer_portal_users WHERE id = $1::uuid`, portalUserId).catch(() => {});
    await p.$executeRawUnsafe(`DELETE FROM customers WHERE id = $1`, customerId).catch(() => {});
  } catch {}
  fail('uncaught', e);
});
