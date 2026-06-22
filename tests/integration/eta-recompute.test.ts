/**
 * Integration test for recomputeShipmentEta — seeds a shipment + delivery
 * stop + a trail of GPS pings, runs the recompute, and verifies the
 * prediction plus that the ETA was persisted where customer-tracking reads it
 * (the latest tracking event's metadata.etaAt).
 *
 * Notifications are suppressed (suppressNotifications: true) so the test
 * never hits Twilio/SendGrid — the decision is still computed and asserted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { recomputeShipmentEta } from '@/lib/logistics/eta-notifier';

const prisma = new PrismaClient();
const TENANT = randomUUID();
const SHIP = randomUUID();

// A trip heading north toward a destination ~10km away.
const DEST = { lat: 25.3600, lng: 55.3100 };

beforeAll(async () => {
  // Shipment with a customer contact + a planned delivery window.
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_orders
       (id, tenant_id, shipment_no, status, currency, destination_name,
        cargo_owner_name, cargo_owner_email, cargo_owner_phone,
        delivery_window_to, created_at, updated_at)
     VALUES ($1,$2,$3,'DISPATCHED','AED','Dubai Warehouse',
        'Acme Co', 'acme@example.com', '+971500000000',
        '2026-06-22T12:00:00Z'::timestamptz, NOW(), NOW())`,
    SHIP, TENANT, `ETA-${SHIP.slice(0, 6)}`,
  );
  // Delivery stop with destination coordinates + a planned arrival.
  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_shipment_stops
       (tenant_id, shipment_order_id, sequence_no, stop_type,
        latitude, longitude, planned_arrival_at, created_at, updated_at)
     VALUES ($1,$2,2,'DELIVERY',$3,$4,'2026-06-22T11:30:00Z'::timestamptz,NOW(),NOW())`,
    TENANT, SHIP, DEST.lat, DEST.lng,
  );
  // Three GPS pings moving north over 4 minutes (~1km → ~15km/h-ish).
  const pings = [
    { lat: 25.2700, lng: 55.31, at: '2026-06-22T08:00:00Z' },
    { lat: 25.2745, lng: 55.31, at: '2026-06-22T08:02:00Z' },
    { lat: 25.2790, lng: 55.31, at: '2026-06-22T08:04:00Z' },
  ];
  for (const p of pings) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_tracking_events
         (tenant_id, shipment_order_id, event_type, latitude, longitude, source, occurred_at, created_at)
       VALUES ($1,$2,'GPS_PING',$3,$4,'gps',$5::timestamptz,NOW())`,
      TENANT, SHIP, p.lat, p.lng, p.at,
    );
  }
}, 60_000);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_tracking_events WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_stops WHERE tenant_id = $1`, TENANT).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM logistics_shipment_orders WHERE id = $1`, SHIP).catch(() => {});
  await prisma.$disconnect();
});

describe('recomputeShipmentEta (live DB)', () => {
  it('predicts from GPS, persists etaAt to the latest event, decides to notify (first ETA)', async () => {
    const r = await recomputeShipmentEta({
      tenantId: TENANT,
      shipmentOrderId: SHIP,
      now: '2026-06-22T08:05:00Z',
      suppressNotifications: true,
    });

    expect(r.prediction).not.toBeNull();
    expect(r.prediction!.method).toBe('observed-speed');
    expect(r.prediction!.etaAt).not.toBeNull();
    expect(r.notifyDecision?.notify).toBe(true);       // first ETA → would notify
    expect(r.notifyDecision?.reason).toMatch(/first ETA/i);
    expect(r.notified).toBe(false);                    // suppressed

    // ETA persisted to the latest tracking event's metadata
    const ev = await prisma.$queryRawUnsafe<Array<{ metadata: Record<string, unknown> }>>(
      `SELECT metadata FROM logistics_tracking_events
        WHERE shipment_order_id = $1 AND tenant_id = $2
        ORDER BY occurred_at DESC LIMIT 1`,
      SHIP, TENANT,
    );
    expect(ev[0]?.metadata?.etaAt).toBeTruthy();
    expect(ev[0]?.metadata?.etaMethod).toBe('observed-speed');
  }, 60_000);

  it('returns a "shipment not found" result for an unknown id without throwing', async () => {
    const r = await recomputeShipmentEta({
      tenantId: TENANT, shipmentOrderId: randomUUID(), suppressNotifications: true,
    });
    expect(r.prediction).toBeNull();
    expect(r.reason).toMatch(/not found/i);
  }, 30_000);

  it('does not re-notify when the ETA barely moves (writes lastNotifiedEtaAt, then a near-identical recompute stays quiet)', async () => {
    // First real (non-suppressed) recompute records lastNotifiedEtaAt.
    // sendEmail/sendSms are no-ops in test (no SendGrid/Twilio env) so this is safe.
    const first = await recomputeShipmentEta({
      tenantId: TENANT, shipmentOrderId: SHIP, now: '2026-06-22T08:05:00Z',
    });
    expect(first.notifyDecision?.notify).toBe(true);

    // Second recompute a few seconds later — same pings, ETA essentially unchanged.
    const second = await recomputeShipmentEta({
      tenantId: TENANT, shipmentOrderId: SHIP, now: '2026-06-22T08:05:30Z',
      thresholdMinutes: 15,
    });
    expect(second.notifyDecision?.notify).toBe(false);
    expect(second.notifyDecision?.reason).toMatch(/moved only|< 15/i);
  }, 60_000);
});
