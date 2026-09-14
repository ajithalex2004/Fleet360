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

  it('advances status to ACCEPTED then converts into a shipment order', async () => {
    const list = await listShippingRequests({ tenantId, status: 'SUBMITTED', limit: 10 });
    const target = list[0];
    expect(target).toBeDefined();

    const accepted = await updateShippingRequestStatus({
      tenantId,
      requestId: target.id,
      status: 'ACCEPTED',
      reviewNotes: 'Looks good',
    });
    expect(accepted!.status).toBe('ACCEPTED');

    const result = await convertShippingRequest({ tenantId, requestId: target.id });
    expect(result.shipmentOrderId).toBeTruthy();
    expect(result.request!.status).toBe('CONVERTED');
    expect(result.request!.shipmentOrderId).toBe(result.shipmentOrderId);

    const shipmentRows = await prisma.$queryRawUnsafe<Array<{ id: string; tenant_id: string; cargo_owner_customer_id: string }>>(
      `SELECT id, tenant_id, cargo_owner_customer_id FROM logistics_shipment_orders WHERE id = $1`,
      result.shipmentOrderId,
    );
    expect(shipmentRows[0]?.tenant_id).toBe(tenantId);
    expect(shipmentRows[0]?.cargo_owner_customer_id).toBe(shipperId);

    const trackingRows = await prisma.$queryRawUnsafe<Array<{ event_type: string }>>(
      `SELECT event_type FROM logistics_tracking_events WHERE tenant_id = $1 AND shipment_order_id = $2 AND event_type = 'SHIPPING_REQUEST_CONVERTED'`,
      tenantId,
      result.shipmentOrderId,
    );
    expect(trackingRows.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses to convert an already-converted request', async () => {
    const list = await listShippingRequests({ tenantId, status: 'CONVERTED', limit: 10 });
    const converted = list[0];
    expect(converted).toBeDefined();

    await expect(
      convertShippingRequest({ tenantId, requestId: converted.id }),
    ).rejects.toBeInstanceOf(LogisticsValidationError);
  });

  it('guarantees atomic conversion and blocks concurrent duplicate conversions', async () => {
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

    // Fire 2 concurrent conversion attempts simultaneously
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
    expect(rejectedReason.issues).toContain('This request has already been converted into a job order.');

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

