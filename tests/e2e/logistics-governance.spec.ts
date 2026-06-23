import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server';

import { POST as validateShipmentTimeline } from '../../src/app/api/logistics/shipments/validate/route';
import { POST as createShipment } from '../../src/app/api/logistics/shipments/route';
import { POST as createRfq } from '../../src/app/api/logistics/rfqs/route';
import { POST as awardRfq } from '../../src/app/api/logistics/rfqs/[id]/award/route';
import { POST as assignShipment } from '../../src/app/api/logistics/shipments/[id]/assignments/route';
import { PATCH as updateException } from '../../src/app/api/logistics/exceptions/[id]/route';
import { POST as updateManifest } from '../../src/app/api/logistics/trips/[id]/manifest/route';
import { POST as attachTripDocument } from '../../src/app/api/logistics/trips/[id]/documents/route';
import { GET as directCarrierRfqs } from '../../src/app/api/logistics/carrier-portal/rfqs/route';
import { POST as directCarrierBid } from '../../src/app/api/logistics/carrier-portal/rfqs/[id]/bid/route';
import { POST as submitPod } from '../../src/app/api/logistics/trips/[id]/pod/route';
import { POST as postSettlement } from '../../src/app/api/logistics/shipments/[id]/finance-posting/route';
import { PATCH as reverseSettlementPosting } from '../../src/app/api/logistics/shipments/[id]/finance-posting/[postingId]/route';

const testHeaders = {
  'x-tenant-id': 'e2e-logistics-governance',
  'x-user-id': 'e2e-logistics-governance-user',
  'x-user-role': 'SUPER_ADMIN',
  'content-type': 'application/json',
};

function request(url: string, init: { method?: string; body?: BodyInit | null; headers?: Record<string, string> } = {}) {
  return new NextRequest(url, {
    method: init.method,
    body: init.body,
    headers: {
      ...testHeaders,
      ...(init?.headers ?? {}),
    },
  });
}

function anonymousRequest(url: string, init: { method?: string; body?: BodyInit | null; headers?: Record<string, string> } = {}) {
  return new NextRequest(url, {
    method: init.method,
    body: init.body,
    headers: init.headers ?? { 'content-type': 'application/json' },
  });
}

test.describe('Logistics governance route boundaries', () => {
  test('blocks invalid shipment timeline payloads at the API boundary', async () => {
    const res = await validateShipmentTimeline(request('http://localhost/api/logistics/shipments/validate', {
      method: 'POST',
      body: JSON.stringify({
        originName: 'Dubai Logistics City',
        destinationName: 'Abu Dhabi Industrial Zone',
        pickupWindowFrom: '2026-06-20T10:00:00.000Z',
        pickupWindowTo: '2026-06-20T09:00:00.000Z',
        deliveryWindowFrom: '2026-06-20T08:00:00.000Z',
        deliveryWindowTo: '2026-06-20T07:00:00.000Z',
      }),
    }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.issues.join(' ')).toContain('Shipment pickup window end cannot be earlier than pickup window start.');
    expect(body.issues.join(' ')).toContain('Shipment delivery ETA cannot be earlier than pickup deadline.');
  });

  test('blocks cross-tenant shipment creation before persistence', async () => {
    const res = await createShipment(request('http://localhost/api/logistics/shipments', {
      method: 'POST',
      headers: { 'x-user-role': 'TENANT_ADMIN' },
      body: JSON.stringify({
        tenantId: 'another-tenant',
        customerName: 'ABC Cargo',
        originName: 'Dubai',
        destinationName: 'Abu Dhabi',
      }),
    }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Forbidden',
      message: 'Tenant boundary violation',
    });
  });

  test('requires shipment linkage before creating marketplace RFQs', async () => {
    const res = await createRfq(request('http://localhost/api/logistics/rfqs', {
      method: 'POST',
      body: JSON.stringify({
        inviteScope: 'SELECTED_CARRIERS',
        bidDeadlineAt: '2026-07-01T10:00:00.000Z',
      }),
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'shipmentOrderId is required' });
  });

  test('requires a bid before carrier award execution', async () => {
    const res = await awardRfq(
      request('http://localhost/api/logistics/rfqs/rfq-1/award', {
        method: 'POST',
        body: JSON.stringify({ notes: 'award without bid should fail fast' }),
      }),
      { params: Promise.resolve({ id: 'rfq-1' }) },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'bidId is required' });
  });

  test('requires tenant context before shipment assignment or dispatch setup', async () => {
    const res = await assignShipment(
      anonymousRequest('http://localhost/api/logistics/shipments/shipment-1/assignments', {
        method: 'POST',
        body: JSON.stringify({ carrierId: 'carrier-1' }),
      }),
      { params: { id: 'shipment-1' } },
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'Tenant context is required' });
  });

  test('requires an explicit exception lifecycle action', async () => {
    const res = await updateException(
      request('http://localhost/api/logistics/exceptions/exception-1', {
        method: 'PATCH',
        body: JSON.stringify({ note: 'missing action' }),
      }),
      { params: { id: 'exception-1' } },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Exception lifecycle action is required' });
  });

  test('rejects invalid manifest stops before creating or mutating manifest records', async () => {
    const res = await updateManifest(
      request('http://localhost/api/logistics/trips/trip-1/manifest', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reorder',
          order: [{ stopId: '', stopNumber: 0 }],
          cargoItems: [{ desc: '', qty: 0, unit: 'BOX', weightKg: -5 }],
        }),
      }),
      { params: { id: 'trip-1' } },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.issues.join(' ')).toContain('Stop order row 1 is missing stopId.');
    expect(body.issues.join(' ')).toContain('Stop order row 1 must use a positive whole stop number.');
    expect(body.issues.join(' ')).toContain('Cargo item 1 description is required.');
    expect(body.issues.join(' ')).toContain('Cargo item 1 quantity must be greater than zero.');
    expect(body.issues.join(' ')).toContain('Cargo item 1 weight cannot be negative.');
  });

  test('rejects invalid trip document metadata before file persistence', async () => {
    const res = await attachTripDocument(
      request('http://localhost/api/logistics/trips/trip-1/documents', {
        method: 'POST',
        body: JSON.stringify({
          docType: '',
          docName: '',
          issueDate: '2026-07-10',
          expiryDate: '2026-07-01',
          validFrom: '2026-07-10',
          validTo: '2026-07-01',
          fileSize: -1,
        }),
      }),
      { params: { id: 'trip-1' } },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.issues.join(' ')).toContain('Document type is required.');
    expect(body.issues.join(' ')).toContain('Document name is required.');
    expect(body.issues.join(' ')).toContain('Document file size cannot be negative.');
    expect(body.issues.join(' ')).toContain('Attach a file or provide a file URL.');
    expect(body.issues.join(' ')).toContain('Document expiry date cannot be before issue date.');
    expect(body.issues.join(' ')).toContain('Document valid-to date cannot be before valid-from date.');
  });

  test('requires secure carrier invite tokens for carrier RFQ access and bid submission', async () => {
    const rfqs = await directCarrierRfqs(request('http://localhost/api/logistics/carrier-portal/rfqs?tenantId=t-1&carrierId=c-1'));
    expect(rfqs.status).toBe(410);
    await expect(rfqs.json()).resolves.toMatchObject({ error: 'Secure invite token is required' });

    const bid = await directCarrierBid(
      request('http://localhost/api/logistics/carrier-portal/rfqs/rfq-1/bid', {
        method: 'POST',
        body: JSON.stringify({ tenantId: 't-1', carrierId: 'c-1', amount: 1200 }),
      }),
      { params: Promise.resolve({ id: 'rfq-1' }) },
    );
    expect(bid.status).toBe(410);
    await expect(bid.json()).resolves.toMatchObject({ error: 'Secure invite token is required' });
  });

  test('rejects incomplete POD payloads before mutating a trip', async () => {
    const res = await submitPod(
      request('http://localhost/api/logistics/trips/not-a-real-booking/pod', {
        method: 'POST',
        body: JSON.stringify({
          recipientName: '',
          recipientSignature: '',
          gpsLat: 100,
          gpsLng: 200,
        }),
      }),
      { params: { id: 'not-a-real-booking' } },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.issues.join(' ')).toContain('POD recipient name is required.');
    expect(body.issues.join(' ')).toContain('POD recipient signature is required.');
    expect(body.issues.join(' ')).toContain('POD GPS latitude must be between -90 and 90.');
  });

  test('prevents duplicate settlement posting across tenant boundaries', async () => {
    const res = await postSettlement(
      request('http://localhost/api/logistics/shipments/shipment-1/finance-posting', {
        method: 'POST',
        headers: { 'x-user-role': 'TENANT_ADMIN' },
        body: JSON.stringify({ tenantId: 'another-tenant' }),
      }),
      { params: Promise.resolve({ id: 'shipment-1' }) },
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Forbidden',
      message: 'Tenant boundary violation',
    });
  });

  test('requires valid reversal action before settlement reversal', async () => {
    const res = await reverseSettlementPosting(
      request('http://localhost/api/logistics/shipments/shipment-1/finance-posting/posting-1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'delete', reason: 'wrong action' }),
      }),
      { params: Promise.resolve({ id: 'shipment-1', postingId: 'posting-1' }) },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Unsupported action' });
  });
});
