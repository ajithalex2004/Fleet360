import { describe, it, expect, vi, beforeEach } from 'vitest';

// The public drayage tracking link: a signed capability token is the only
// way in, and the POST cannot alert recipients the caller did not give.
const h = vi.hoisted(() => ({
  updatePrefs: vi.fn(async (_db: unknown, args: Record<string, unknown>) => args),
  dispatchAlert: vi.fn(async () => ({ sent: true })),
}));

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({})),
}));
vi.mock('@/lib/logistics/drayage-domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logistics/drayage-domain')>();
  return {
    ...actual,
    ensureDrayageSchema: vi.fn(async () => undefined),
    getPublicCustomerTrackingByToken: vi.fn(async () => ({ job: { id: 'job-1', customerName: 'ACME' } })),
    updateDrayageCustomerAlertPreferences: h.updatePrefs,
    dispatchDrayageCustomerMilestoneAlert: h.dispatchAlert,
  };
});

const { generateDrayageCustomerTrackingToken } = await import('@/lib/logistics/drayage-domain');
const { GET, POST } = await import('@/app/api/driver-app/customer-tracking/route');

function req(url: string, body?: unknown) {
  const r = new Request(url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return Object.assign(r, { nextUrl: new URL(url) }) as never;
}

describe('drayage customer tracking link', () => {
  beforeEach(() => {
    h.updatePrefs.mockClear();
    h.dispatchAlert.mockClear();
  });

  it('refuses a missing, forged or tampered token', async () => {
    const token = generateDrayageCustomerTrackingToken({ tenantId: 'tenant-a', jobCode: 'DRY-1', containerNumber: 'MSCU1234567' });
    expect((await GET(req('http://localhost/api/driver-app/customer-tracking'))).status).toBe(401);
    expect((await GET(req('http://localhost/api/driver-app/customer-tracking?token=trk_abc.def'))).status).toBe(401);

    // Same payload for another tenant, old signature: refused.
    const [payload, sig] = token.slice(4).split('.');
    const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), t: 'tenant-b' })).toString('base64url');
    expect((await GET(req(`http://localhost/api/driver-app/customer-tracking?token=trk_${other}.${sig}`))).status).toBe(401);

    expect((await GET(req(`http://localhost/api/driver-app/customer-tracking?token=${encodeURIComponent(token)}`))).status).toBe(200);
  });

  it('does not send alerts to recipients the caller did not give', async () => {
    const token = generateDrayageCustomerTrackingToken({ tenantId: 'tenant-a', jobCode: 'DRY-1', containerNumber: 'MSCU1234567' });
    const none = await POST(req('http://localhost/api/driver-app/customer-tracking', { token, action: 'update_subscriptions' }));
    expect(none.status).toBe(400);
    expect(h.dispatchAlert).not.toHaveBeenCalled();

    const injected = await POST(req('http://localhost/api/driver-app/customer-tracking', { token, action: 'update_subscriptions', customerEmail: 'a@b.co] [CUST_AUTO_ALERTS:OFF' }));
    expect(injected.status).toBe(400);

    const ok = await POST(req('http://localhost/api/driver-app/customer-tracking', { token, action: 'update_subscriptions', customerEmail: 'ops@consignee.ae' }));
    expect(ok.status).toBe(200);
    expect(h.updatePrefs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: 'tenant-a', customerEmail: 'ops@consignee.ae', customerWhatsApp: '' }));
  });
});
