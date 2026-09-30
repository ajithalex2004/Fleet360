/**
 * tests/unit/logistics-emails.test.ts
 *
 * Logistics emails through the tenant email templates:
 *  - shipment milestones to the customer contact (confirmed, dispatched with
 *    driver and vehicle, out for delivery with ETA, delivered, cancelled
 *    with reason); other statuses send nothing; bad addresses are skipped
 *  - proof of delivery with recipient, time (GST) and attachments
 *  - replies go to the tenant's contact email; the work runs as the tenant
 *  - the status route emails only when the status actually changes
 *  - every logistics template renders in both languages
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-a';

const state = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  acting: [] as string[],
  shipment: null as null | Record<string, unknown>,
  eta: null as string | null,
  notified: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/rls-scope', () => {
  let current: string | undefined;
  return {
    runOutsideRlsScope: <T>(fn: () => Promise<T>) => fn(),
    runAsTenant: async <T>(t: string, fn: () => Promise<T>) => {
      const prev = current; current = t;
      try { return await fn(); } finally { current = prev; }
    },
    actingTenantId: () => current,
    __current: () => current,
  };
});
vi.mock('@/lib/prisma', async () => {
  const scope = await import('@/lib/rls-scope') as unknown as { __current: () => string | undefined };
  return {
    prisma: {
      $queryRawUnsafe: async (sql: string) => {
        state.acting.push(String(scope.__current()));
        if (sql.includes('FROM logistics_shipment_orders')) return state.shipment ? [state.shipment] : [];
        if (sql.includes('logistics_telematics_events')) return state.eta ? [{ eta_at: state.eta }] : [];
        return [];
      },
      driver: { findUnique: async () => ({ name: null, firstName: 'Rashid', lastName: 'Ahmed' }) },
      vehicle: { findUnique: async () => ({ licensePlate: 'DXB K 48213' }) },
    },
  };
});
vi.mock('@/lib/tenant-contact', () => ({ tenantContact: async () => ({ email: 'ops@acme.test', name: 'Acme' }) }));
vi.mock('@/lib/email-templates', async () => {
  const { getTemplateDef, templateVariables } = await import('@/lib/email-templates/catalogue');
  const { renderEmailContent } = await import('@/lib/email-templates/render');
  return {
    appUrl: (p: string) => `https://app.test${p}`,
    tenantEmailContext: async () => ({ companyName: 'Acme Logistics', locale: 'en', productName: null, logoUrl: null, primaryColor: null }),
    sendTemplatedEmail: async (args: { key: string; to: string; replyTo?: string; values: (l: string) => Record<string, string> }) => {
      const def = getTemplateDef(args.key)!;
      const raw: Record<string, string> = { companyName: 'Acme Logistics', ...args.values('en') };
      const values = Object.fromEntries(templateVariables(def).map((v) => [v.name, raw[v.name] || v.fallback?.en || '']));
      const email = renderEmailContent({ ...def.defaults.en, values, locale: 'en', branding: { companyName: 'Acme Logistics' } });
      state.sent.push({ key: args.key, to: args.to, replyTo: args.replyTo, ...email });
      return { sent: true };
    },
  };
});
vi.mock('@/lib/logistics/domain', () => ({
  updateShipmentOrder: async () => ({ id: 'ship-1', status: 'X' }),
}));
vi.mock('@/events/event-bus', () => ({ getEventBus: () => ({ publish: async () => {} }) }));
vi.mock('@/lib/rls', () => ({ withTenantRls: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));

import { NextRequest } from 'next/server';
import { notifyProofOfDelivery, notifyShipmentStatus, formatGst } from '@/lib/logistics/customer-notifications';
import { EMAIL_TEMPLATES, templateVariables } from '@/lib/email-templates/catalogue';
import { renderEmailContent, sampleValues } from '@/lib/email-templates/render';

const shipment = (extra: Record<string, unknown> = {}) => ({
  shipment_no: 'SHP-2026-0198', cargo_owner_name: 'Gulf Trading LLC', cargo_owner_email: 'Buyer@Gulf.test',
  origin_name: 'Jebel Ali Free Zone', destination_name: 'Al Quoz Industrial 3',
  assigned_driver_id: 'd1', assigned_vehicle_id: 'v1', ...extra,
});

beforeEach(() => {
  state.sent = []; state.acting = []; state.notified = [];
  state.shipment = shipment(); state.eta = null;
});

describe('shipment milestone emails', () => {
  it('emails the customer when a shipment is dispatched, with driver and vehicle', async () => {
    await notifyShipmentStatus({ tenantId: TENANT, shipmentOrderId: 'ship-1', status: 'DISPATCHED' });
    expect(state.sent).toHaveLength(1);
    const [m] = state.sent;
    expect(m).toMatchObject({ key: 'logistics.shipment_dispatched', to: 'buyer@gulf.test', replyTo: 'ops@acme.test', subject: 'Shipment SHP-2026-0198 is on its way' });
    expect(m.text).toContain('Dear Gulf Trading LLC,');
    expect(m.text).toContain('Driver: Rashid Ahmed');
    expect(m.text).toContain('Vehicle: DXB K 48213');
    expect(new Set(state.acting)).toEqual(new Set([TENANT]));
  });

  it('gives the ETA when out for delivery, or says it is to be confirmed', async () => {
    state.eta = '2026-09-30T10:30:00Z';
    await notifyShipmentStatus({ tenantId: TENANT, shipmentOrderId: 'ship-1', status: 'ENROUTE_DELIVERY' });
    expect(state.sent[0].text).toContain(`Estimated arrival: ${formatGst('2026-09-30T10:30:00Z', 'en')}`);
    expect(state.sent[0].text).toContain('14:30 GST');
    state.sent = []; state.eta = null;
    await notifyShipmentStatus({ tenantId: TENANT, shipmentOrderId: 'ship-1', status: 'ENROUTE_DELIVERY' });
    expect(state.sent[0].text).toContain('Estimated arrival: to be confirmed');
  });

  it('includes the reason when cancelled', async () => {
    await notifyShipmentStatus({ tenantId: TENANT, shipmentOrderId: 'ship-1', status: 'CANCELLED', reason: 'Requested by customer' });
    expect(state.sent[0]).toMatchObject({ key: 'logistics.shipment_cancelled', subject: 'Shipment SHP-2026-0198 cancelled' });
    expect(state.sent[0].text).toContain('Reason: Requested by customer');
  });

  it('sends confirmed and delivered too, and nothing for internal statuses', async () => {
    for (const status of ['APPROVED', 'ASSIGNED', 'ENROUTE_PICKUP', 'LOADED', 'DELIVERED', 'POD_SUBMITTED', 'CLOSED']) {
      await notifyShipmentStatus({ tenantId: TENANT, shipmentOrderId: 'ship-1', status });
    }
    expect(state.sent.map((m) => m.key)).toEqual(['logistics.shipment_confirmed', 'logistics.shipment_delivered']);
  });

  it('skips a shipment without a valid customer email, and never throws', async () => {
    state.shipment = shipment({ cargo_owner_email: 'not-an-email' });
    await notifyShipmentStatus({ tenantId: TENANT, shipmentOrderId: 'ship-1', status: 'APPROVED' });
    state.shipment = null;
    await expect(notifyShipmentStatus({ tenantId: TENANT, shipmentOrderId: 'gone', status: 'APPROVED' })).resolves.toBeUndefined();
    expect(state.sent).toHaveLength(0);
  });
});

describe('proof of delivery email', () => {
  it('names who received it, when (GST), remarks and attachments', async () => {
    await notifyProofOfDelivery({
      tenantId: TENANT, shipmentOrderId: 'ship-1', recipientName: 'Omar Hassan',
      deliveredAt: new Date('2026-09-30T10:42:00Z'), note: '2 pallets, no damage', attachmentCount: 3,
    });
    const [m] = state.sent;
    expect(m).toMatchObject({ key: 'logistics.proof_of_delivery', to: 'buyer@gulf.test', subject: 'Proof of delivery: shipment SHP-2026-0198' });
    expect(m.text).toContain('Received by: Omar Hassan');
    expect(m.text).toContain(`Delivered at: ${formatGst('2026-09-30T10:42:00Z', 'en')}`);
    expect(m.text).toContain('14:42 GST');
    expect(m.text).toContain('Remarks: 2 pallets, no damage');
    expect(m.text).toContain('Photos and documents: 3');
  });

  it('says None when there are no remarks', async () => {
    await notifyProofOfDelivery({ tenantId: TENANT, shipmentOrderId: 'ship-1', recipientName: 'Omar', deliveredAt: new Date(), attachmentCount: 0 });
    expect(state.sent[0].text).toContain('Remarks: None');
  });
});

describe('shipment status route', () => {
  const headers = { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };
  const patch = async (body: Record<string, unknown>) => {
    const { PATCH } = await import('@/app/api/logistics/shipments/[id]/status/route');
    return PATCH(new NextRequest('http://localhost/api/logistics/shipments/ship-1/status', { method: 'PATCH', headers, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: 'ship-1' }) });
  };

  it('emails the customer on a milestone transition', async () => {
    const res = await patch({ currentStatus: 'ASSIGNED', status: 'DISPATCHED' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(state.sent.map((m) => m.key)).toEqual(['logistics.shipment_dispatched']);
  });

  it('refuses an invalid transition without emailing', async () => {
    const res = await patch({ currentStatus: 'DELIVERED', status: 'DISPATCHED' });
    expect(res.status).toBe(422);
    expect(state.sent).toHaveLength(0);
  });
});

describe('logistics templates', () => {
  it('render in both languages with sample values', () => {
    const keys = EMAIL_TEMPLATES.filter((t) => t.module === 'Logistics').map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining([
      'logistics.shipment_confirmed', 'logistics.shipment_dispatched', 'logistics.out_for_delivery',
      'logistics.eta_update', 'logistics.shipment_delivered', 'logistics.proof_of_delivery',
      'logistics.shipment_cancelled', 'logistics.route_deviation',
    ]));
    for (const def of EMAIL_TEMPLATES.filter((t) => t.module === 'Logistics')) {
      for (const locale of ['en', 'ar'] as const) {
        const { values, blocks } = sampleValues(templateVariables(def), 'Acme');
        const out = renderEmailContent({ ...def.defaults[locale], values, blocks, locale, branding: { companyName: 'Acme' } });
        expect(out.subject, `${def.key}/${locale}`).not.toMatch(/\{\{/);
        expect(out.text, `${def.key}/${locale}`).not.toMatch(/\{\{/);
      }
    }
  });
});
