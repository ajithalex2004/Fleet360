/**
 * Integration tests for applyAutoAccessorialsToShipment — exercises the
 * full path: load catalog from Postgres → evaluate → write freight_charges
 * rows. Uses a unique tenant_id per run so it doesn't fight with seeded
 * data or with the smoke script.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  applyAutoAccessorialsToShipment,
} from '@/lib/logistics/accessorial-engine';
import { listAccessorialCatalog } from '@/lib/logistics/domain';

const prisma = new PrismaClient();
const TENANT_ID = randomUUID();
const shipmentIds: string[] = [];
const catalogIds: string[] = [];

async function seedCatalog(args: {
  code: string;
  name: string;
  chargeType: string;
  taxable: boolean;
  rule: unknown;
}): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_accessorial_catalog (
       id, tenant_id, code, name, charge_type, default_amount, currency,
       taxable, auto_apply_rule, status
     ) VALUES ($1, $2, $3, $4, $5, 0, 'AED', $6, $7::jsonb, 'ACTIVE')`,
    id, TENANT_ID, args.code, args.name, args.chargeType,
    args.taxable, JSON.stringify(args.rule),
  );
  catalogIds.push(id);
  return id;
}

async function seedShipment(label: string): Promise<string> {
  // Minimal valid row: relies on column defaults for the rest. We use
  // the same TENANT_ID across seeds so the auto-applier picks it up.
  const id = randomUUID();
  const shipmentNo = `INT-AX-${label}-${id.slice(0,8)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders (id, tenant_id, shipment_no, status, currency, created_at, updated_at)
     VALUES ($1, $2, $3, 'PENDING', 'AED', NOW(), NOW())`,
    id, TENANT_ID, shipmentNo,
  );
  shipmentIds.push(id);
  return id;
}

beforeAll(async () => {
  // Touch the table once to trigger ensureLogisticsDomainTables on cold start.
  await listAccessorialCatalog({ tenantId: TENANT_ID });
}, 60_000);

afterAll(async () => {
  if (shipmentIds.length) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_freight_charges WHERE shipment_order_id = ANY($1::text[])`,
      shipmentIds,
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_shipment_orders WHERE id = ANY($1::text[])`,
      shipmentIds,
    ).catch(() => {});
  }
  if (catalogIds.length) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_accessorial_catalog WHERE id = ANY($1::text[])`,
      catalogIds,
    ).catch(() => {});
  }
  await prisma.$disconnect();
});

describe('applyAutoAccessorialsToShipment (live DB)', () => {
  it('writes a freight_charges row for each rule that fires', async () => {
    await seedCatalog({
      code: 'INT_FUEL', name: 'Int Fuel', chargeType: 'FUEL', taxable: true,
      rule: { type: 'percentage', basis: 'base_rate', percentage: 10 },
    });
    await seedCatalog({
      code: 'INT_CUSTOMS', name: 'Int Customs', chargeType: 'CUSTOMS', taxable: false,
      rule: { type: 'flat', amount: 150, conditions: { requiresCrossBorder: true } },
    });
    const shipmentId = await seedShipment('cross-border');

    const r = await applyAutoAccessorialsToShipment({
      tenantId: TENANT_ID,
      shipmentOrderId: shipmentId,
      actorUserId: 'integration-test',
      context: {
        baseRate: 500,
        originCountry: 'AE',
        destinationCountry: 'OM',
      },
    });

    expect(r.applied.map(a => a.code).sort()).toEqual(['INT_CUSTOMS', 'INT_FUEL']);
    expect(r.totalAmount).toBe(200); // fuel 50 + customs 150
    // Fuel taxable=true, 50 × 5% = 2.5; customs taxable=false, no tax.
    expect(r.totalTax).toBe(2.5);
    expect(r.chargeIds.length).toBe(2);

    // Verify rows landed in freight_charges with the right metadata.
    const rows = await prisma.$queryRawUnsafe<Array<{
      charge_type: string; amount: string; tax_amount: string; metadata: Record<string, unknown>;
    }>>(
      `SELECT charge_type, amount::text, tax_amount::text, metadata
         FROM logistics_freight_charges WHERE shipment_order_id = $1`,
      shipmentId,
    );
    expect(rows.length).toBe(2);
    expect(rows.every(row => (row.metadata as { autoApplied?: boolean }).autoApplied === true)).toBe(true);
    const customs = rows.find(row => row.charge_type === 'INT_CUSTOMS');
    expect(customs).toBeDefined();
    expect(Number(customs!.tax_amount)).toBe(0);
  });

  it('does not fire customs when origin and destination are the same country', async () => {
    const shipmentId = await seedShipment('domestic');
    const r = await applyAutoAccessorialsToShipment({
      tenantId: TENANT_ID,
      shipmentOrderId: shipmentId,
      actorUserId: 'integration-test',
      context: {
        baseRate: 500,
        originCountry: 'AE',
        destinationCountry: 'AE',
      },
    });
    expect(r.applied.map(a => a.code).sort()).toEqual(['INT_FUEL']);
  });

  it('returns empty applied list when context provides no usable basis', async () => {
    const shipmentId = await seedShipment('empty');
    const r = await applyAutoAccessorialsToShipment({
      tenantId: TENANT_ID,
      shipmentOrderId: shipmentId,
      actorUserId: 'integration-test',
      context: {},  // no baseRate, no countries → fuel + customs both skip
    });
    expect(r.applied).toEqual([]);
    expect(r.totalAmount).toBe(0);
    expect(r.chargeIds).toEqual([]);
  });

  it('survives an inactive catalog entry without applying it', async () => {
    // Mark the fuel rule inactive
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_accessorial_catalog SET status = 'INACTIVE'
        WHERE tenant_id = $1 AND code = 'INT_FUEL'`,
      TENANT_ID,
    );
    const shipmentId = await seedShipment('inactive-fuel');
    const r = await applyAutoAccessorialsToShipment({
      tenantId: TENANT_ID,
      shipmentOrderId: shipmentId,
      actorUserId: 'integration-test',
      context: { baseRate: 500, originCountry: 'AE', destinationCountry: 'OM' },
    });
    // Only customs should fire now
    expect(r.applied.map(a => a.code)).toEqual(['INT_CUSTOMS']);
  });
});
