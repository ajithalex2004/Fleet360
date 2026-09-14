/**
 * Logistics — Shipping Request Intake. PostgreSQL Integration Tests.
 *
 * Exercises the full lifecycle in src/lib/logistics/domain.ts against real
 * Postgres: createShippingRequest -> listShippingRequests ->
 * getShippingRequest -> updateShippingRequestStatus -> convertShippingRequest
 * (which creates a real logistics_shipment_orders row + a tracking event).
 *
 * logistics_shipping_requests (like the rest of this domain, per
 * prisma/migrations/20260910000034_logistics_domain_tables's header comment)
 * has no RLS — every query filters by tenant_id at the app layer, so this
 * suite uses the bare prisma client, matching domain.ts itself.
 *
 * Cleanup deletes ONLY the synthetic tenant/customer/rows created here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  createShippingRequest,
  listShippingRequests,
  getShippingRequest,
  updateShippingRequestStatus,
  convertShippingRequest,
  LogisticsValidationError,
} from '@/lib/logistics/domain';

const hasDb = Boolean(process.env.DATABASE_URL);
const suffix = Date.now().toString();
const tenantId = crypto.randomUUID();
const shipperId = crypto.randomUUID();

describe.skipIf(!hasDb)('Logistics shipping requests (Postgres)', () => {
  beforeAll(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `Shipping Request Test Tenant ${suffix}`,
        code: `shipreq-test-${suffix}`,
      },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO customers (id, tenant_id, customer_type, name_en, email, mobile_number)
       VALUES ($1, $2, 'CORPORATE', $3, $4, $5)`,
      shipperId,
      tenantId,
      `Shipping Request Test Shipper ${suffix}`,
      `shipper-${suffix}@example.test`,
      '+971500000000',
    );
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_document_sequences WHERE tenant_id = $1`, tenantId);
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_tracking_events WHERE tenant_id = $1`, tenantId);
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, tenantId);
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_cargo_lines WHERE tenant_id = $1`, tenantId);
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE tenant_id = $1`, tenantId);
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipping_requests WHERE tenant_id = $1`, tenantId);
    await prisma.$executeRawUnsafe(`DELETE FROM customers WHERE tenant_id = $1`, tenantId);
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('creates a shipping request scoped to the tenant/shipper', async () => {
    const req = await createShippingRequest({
      tenantId,
      shipperId,
      originName: 'Jebel Ali Port',
      destinationName: 'Dubai South',
      goodsDescription: 'Palletised electronics',
      totalWeightKg: 1200,
      source: 'OPERATOR',
    });
    expect(req).not.toBeNull();
    expect(req!.tenantId).toBe(tenantId);
    expect(req!.shipperId).toBe(shipperId);
    expect(req!.status).toBe('SUBMITTED');
    expect(req!.requestNo).toMatch(/^SR-\d{2}\d{5}$/);
  });

  it('rejects a shipper that does not belong to the tenant', async () => {
    await expect(
      createShippingRequest({ tenantId, shipperId: crypto.randomUUID(), source: 'OPERATOR' }),
    ).rejects.toBeInstanceOf(LogisticsValidationError);
  });

  it('lists and fetches the created request', async () => {
    const list = await listShippingRequests({ tenantId, limit: 10 });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find(r => r.shipperId === shipperId);
    expect(found).toBeDefined();

    const fetched = await getShippingRequest({ tenantId, requestId: found!.id });
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(found!.id);
    expect(fetched!.shipperName).toContain('Shipping Request Test Shipper');
  });

  it('refuses to convert a request directly from SUBMITTED state without being ACCEPTED', async () => {
    const req = await createShippingRequest({
      tenantId,
      shipperId,
      originName: 'Jebel Ali Free Zone',
      destinationName: 'Dubai Logistics City',
      goodsDescription: 'Unaccepted request test',
      source: 'OPERATOR',
    });
    expect(req?.status).toBe('SUBMITTED');

    await expect(
      convertShippingRequest({ tenantId, requestId: req!.id }),
    ).rejects.toThrowError(/Only ACCEPTED shipping requests can be converted/);
  });

  it('advances status to ACCEPTED then converts into a shipment order with full database state assertions', async () => {
    const target = await createShippingRequest({
      tenantId,
      shipperId,
      originName: 'Abu Dhabi Mina Port',
      destinationName: 'Sharjah Industrial 10',
      goodsDescription: 'Palletized machinery',
      totalWeightKg: 3500,
      totalVolumeCbm: 12,
      source: 'OPERATOR',
      metadata: {
        cargoLines: [
          { description: 'Component A', weightKg: 1500, packageType: 'PALLET' },
          { description: 'Component B', weightKg: 2000, packageType: 'PALLET' },
        ],
      },
    });
    expect(target).toBeDefined();

    const accepted = await updateShippingRequestStatus({
      tenantId,
      requestId: target!.id,
      status: 'ACCEPTED',
      reviewNotes: 'Verified and accepted',
    });
    expect(accepted!.status).toBe('ACCEPTED');

    const result = await convertShippingRequest({ tenantId, requestId: target!.id });
    expect(result.shipmentOrderId).toBeTruthy();
    expect(result.request!.status).toBe('CONVERTED');
    expect(result.request!.shipmentOrderId).toBe(result.shipmentOrderId);

    // 1. Assert exactly one shipment order exists in DB
    const shipmentRows = await prisma.$queryRawUnsafe<Array<{ id: string; tenant_id: string; cargo_owner_customer_id: string; shipment_no: string }>>(
      `SELECT id, tenant_id, cargo_owner_customer_id, shipment_no FROM logistics_shipment_orders WHERE id = $1`,
      result.shipmentOrderId,
    );
    expect(shipmentRows).toHaveLength(1);
    expect(shipmentRows[0]?.tenant_id).toBe(tenantId);
    expect(shipmentRows[0]?.cargo_owner_customer_id).toBe(shipperId);
    expect(shipmentRows[0]?.shipment_no).toMatch(/^SHP-LOG-\d{7}$/);

    // 2. Assert exactly two stops created (PICKUP and DELIVERY)
    const stopRows = await prisma.$queryRawUnsafe<Array<{ stop_type: string; sequence_no: number }>>(
      `SELECT stop_type, sequence_no FROM logistics_shipment_stops WHERE tenant_id = $1 AND shipment_order_id = $2 ORDER BY sequence_no`,
      tenantId,
      result.shipmentOrderId,
    );
    expect(stopRows).toHaveLength(2);
    expect(stopRows[0].stop_type).toBe('PICKUP');
    expect(stopRows[1].stop_type).toBe('DELIVERY');

    // 3. Assert cargo lines created in expected quantity
    const cargoRows = await prisma.$queryRawUnsafe<Array<{ description: string; weight_kg: number }>>(
      `SELECT description, weight_kg FROM logistics_cargo_lines WHERE tenant_id = $1 AND shipment_order_id = $2 ORDER BY description`,
      tenantId,
      result.shipmentOrderId,
    );
    expect(cargoRows).toHaveLength(2);
    expect(cargoRows[0].description).toBe('Component A');
    expect(cargoRows[1].description).toBe('Component B');

    // 4. Assert tracking event created
    const trackingRows = await prisma.$queryRawUnsafe<Array<{ event_type: string }>>(
      `SELECT event_type FROM logistics_tracking_events WHERE tenant_id = $1 AND shipment_order_id = $2 AND event_type = 'SHIPPING_REQUEST_CONVERTED'`,
      tenantId,
      result.shipmentOrderId,
    );
    expect(trackingRows).toHaveLength(1);
  });

  it('refuses to convert an already-converted request', async () => {
    const list = await listShippingRequests({ tenantId, status: 'CONVERTED', limit: 10 });
    const converted = list[0];
    expect(converted).toBeDefined();

    await expect(
      convertShippingRequest({ tenantId, requestId: converted.id }),
    ).rejects.toBeInstanceOf(LogisticsValidationError);
  });

  it('guarantees atomic conversion and blocks concurrent duplicate conversions of the same request', async () => {
    const req = await createShippingRequest({
      tenantId,
      shipperId,
      originName: 'Jebel Ali Free Zone',
      destinationName: 'Abu Dhabi Industrial City',
      goodsDescription: 'High-value equipment',
      totalWeightKg: 4500,
      source: 'OPERATOR',
    });
    expect(req).not.toBeNull();
    await updateShippingRequestStatus({
      tenantId,
      requestId: req!.id,
      status: 'ACCEPTED',
      reviewNotes: 'Approved for conversion',
    });

    // Fire 2 concurrent conversion attempts simultaneously on the same request
    const results = await Promise.allSettled([
      convertShippingRequest({ tenantId, requestId: req!.id, actorUserId: 'user-a' }),
      convertShippingRequest({ tenantId, requestId: req!.id, actorUserId: 'user-b' }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedReason).toBeInstanceOf(LogisticsValidationError);

    // Confirm database has exactly one shipment associated with this request
    const freshReq = await getShippingRequest({ tenantId, requestId: req!.id });
    expect(freshReq?.status).toBe('CONVERTED');
    expect(freshReq?.shipmentOrderId).toBeTruthy();

    const shipmentRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM logistics_shipment_orders WHERE tenant_id = $1 AND id = $2`,
      tenantId,
      freshReq!.shipmentOrderId,
    );
    expect(shipmentRows).toHaveLength(1);
  });

  it('produces strictly unique sequential numbers during concurrent creation of different requests', async () => {
    // Fire 5 concurrent createShippingRequest calls for different requests
    const creations = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createShippingRequest({
          tenantId,
          shipperId,
          originName: `Concurrent Origin ${i}`,
          destinationName: `Concurrent Dest ${i}`,
          goodsDescription: `Concurrent Item ${i}`,
          source: 'OPERATOR',
        }),
      ),
    );

    const requestNos = creations.map(c => c!.requestNo);
    expect(requestNos).toHaveLength(5);
    const uniqueSet = new Set(requestNos);
    expect(uniqueSet.size).toBe(5);
    for (const no of requestNos) {
      expect(no).toMatch(/^SR-\d{7}$/);
    }
  });

  it('produces strictly unique sequential shipment numbers during concurrent conversion of different accepted requests', async () => {
    // 1. Create 3 distinct shipping requests
    const createdRequests = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        createShippingRequest({
          tenantId,
          shipperId,
          originName: `Parallel Origin ${i}`,
          destinationName: `Parallel Dest ${i}`,
          goodsDescription: `Parallel Cargo ${i}`,
          source: 'OPERATOR',
        }),
      ),
    );

    // 2. Accept all 3 requests
    await Promise.all(
      createdRequests.map(r =>
        updateShippingRequestStatus({
          tenantId,
          requestId: r!.id,
          status: 'ACCEPTED',
          reviewNotes: 'Bulk acceptance',
        }),
      ),
    );

    // 3. Fire 3 concurrent conversion attempts simultaneously
    const conversions = await Promise.all(
      createdRequests.map(r =>
        convertShippingRequest({
          tenantId,
          requestId: r!.id,
        }),
      ),
    );

    expect(conversions).toHaveLength(3);
    const shipmentNos = conversions.map(c => c.shipmentNo);
    const uniqueShipmentNos = new Set(shipmentNos);
    expect(uniqueShipmentNos.size).toBe(3);
    for (const no of shipmentNos) {
      expect(no).toMatch(/^SHP-LOG-\d{7}$/);
    }
  });

  it('rolls back entire transaction on forced failure during child record creation', async () => {
    const goodsDescription = `Rollback Test Goods ${Date.now()}`;
    const req = await createShippingRequest({
      tenantId,
      shipperId,
      originName: 'Rollback Origin',
      destinationName: 'Rollback Destination',
      goodsDescription,
      source: 'OPERATOR',
    });
    expect(req).not.toBeNull();

    await updateShippingRequestStatus({
      tenantId,
      requestId: req!.id,
      status: 'ACCEPTED',
      reviewNotes: 'Accepted before forced failure',
    });

    // Conversion must fail inside the transaction during child cargo line creation
    await expect(
      convertShippingRequest({
        tenantId,
        requestId: req!.id,
        shipmentInput: {
          cargoLines: [{ description: null as any, weightKg: 100 }],
        },
      }),
    ).rejects.toThrow();

    // Verify complete transactional rollback in PostgreSQL:
    // 1. Shipping request must still be in ACCEPTED state, not CONVERTED
    const reqAfter = await getShippingRequest({ tenantId, requestId: req!.id });
    expect(reqAfter?.status).toBe('ACCEPTED');
    expect(reqAfter?.shipmentOrderId).toBeNull();

    // 2. No shipment order row must exist for this request
    const shipments = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM logistics_shipment_orders WHERE tenant_id = $1 AND notes ILIKE '%' || $2 || '%'`,
      tenantId,
      goodsDescription,
    );
    expect(shipments).toHaveLength(0);

    // 3. No stops or cargo lines exist for this request
    const cargoLines = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM logistics_cargo_lines WHERE tenant_id = $1 AND weight_kg = 100`,
      tenantId,
    );
    expect(cargoLines).toHaveLength(0);
  });

  it('refuses to convert a rejected request', async () => {
    const req = await createShippingRequest({ tenantId, shipperId, source: 'OPERATOR' });
    await updateShippingRequestStatus({ tenantId, requestId: req!.id, status: 'REJECTED', reviewNotes: 'No capacity' });

    await expect(
      convertShippingRequest({ tenantId, requestId: req!.id }),
    ).rejects.toBeInstanceOf(LogisticsValidationError);
  });

  it('does not leak requests across tenants', async () => {
    const otherTenantId = crypto.randomUUID();
    const otherList = await listShippingRequests({ tenantId: otherTenantId, limit: 10 });
    expect(otherList).toHaveLength(0);

    const list = await listShippingRequests({ tenantId, limit: 50 });
    for (const r of list) {
      expect(r.tenantId).toBe(tenantId);
    }
  });
});

