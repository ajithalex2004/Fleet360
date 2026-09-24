/**
 * tests/unit/partner-portal-auth.test.ts
 *
 * The Stripe webhook and the shipper / carrier portal routes are public
 * (PUBLIC_PREFIXES in src/lib/auth-route-policies.ts) and authenticate with
 * their own credential, not a staff session. They used to call
 * requireAuthorizedTenant() first, which can never pass for Stripe, a
 * shipper or a carrier, so every real request was rejected.
 *
 * These tests pin the intended behaviour:
 *  - without the route's own credential the request is refused, even when
 *    the caller forges staff identity headers;
 *  - the refusal comes from the route's own check (portal session, device
 *    token, invite/offer token, Stripe signature), not a staff-session check.
 * Every case returns before any database access.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// vitest.config.ts aliases next/server to a stub whose NextResponse.json
// returns a plain Response and whose requests have no cookies API. The
// routes use `instanceof NextResponse` and read cookies, so use the real one.
vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';
import { POST as stripeWebhook } from '@/app/api/stripe/webhook/route';
import { POST as shipperLogin } from '@/app/api/shipper-portal/auth/login/route';
import { POST as shipperLogout } from '@/app/api/shipper-portal/auth/logout/route';
import { POST as shipperSetup } from '@/app/api/shipper-portal/auth/setup/route';
import { GET as shipperMe } from '@/app/api/shipper-portal/me/route';
import { GET as shipperStats } from '@/app/api/shipper-portal/stats/route';
import { GET as shipperMasterData } from '@/app/api/shipper-portal/master-data/route';
import { POST as shipperQuote } from '@/app/api/shipper-portal/rates/quote/route';
import { GET as shipperList, POST as shipperCreate } from '@/app/api/shipper-portal/shipments/route';
import { GET as shipperDetail } from '@/app/api/shipper-portal/shipments/[id]/route';
import { GET as carrierLoads, POST as carrierBidFromApp } from '@/app/api/carrier-portal/app/loads/route';
import { GET as carrierLoad, POST as carrierLoadUpdate } from '@/app/api/carrier-portal/app/loads/[id]/route';
import { POST as carrierPod } from '@/app/api/carrier-portal/app/loads/[id]/pod/route';
import { POST as carrierDocs } from '@/app/api/carrier-portal/app/loads/[id]/documents/route';
import { POST as carrierResolve } from '@/app/api/carrier-portal/resolve/route';
import { POST as carrierBid } from '@/app/api/carrier-portal/bid/route';
import { POST as offerResolve } from '@/app/api/carrier-portal/offer/resolve/route';
import { POST as offerAccept } from '@/app/api/carrier-portal/offer/accept/route';

const TENANT = '11111111-1111-4111-8111-111111111111';

// What a caller could send to impersonate a staff session. Middleware
// strips these on public routes; the handlers must not depend on them.
const FORGED_STAFF = {
  'x-tenant-id': TENANT,
  'x-user-id': 'attacker',
  'x-user-role': 'SUPER_ADMIN',
};

// A real shipper, carrier or Stripe sends no staff headers; an attacker
// may send forged ones. Both must reach the route's own credential check.
const CALLERS: Array<[string, Record<string, string>]> = [
  ['no staff headers', {}],
  ['forged staff headers', FORGED_STAFF],
];

function req(path: string, method: string, headers: Record<string, string> = {}, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const idParams = { params: Promise.resolve({ id: 'shipment-1' }) };

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_test_partner_portal_auth';
});

describe('Stripe webhook', () => {
  it('rejects a request without a Stripe signature (400), not with a staff-session error', async () => {
    const res = await stripeWebhook(req('/api/stripe/webhook', 'POST', FORGED_STAFF, {}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Webhook signature missing' });
  });

  it('rejects a request with an invalid signature', async () => {
    const res = await stripeWebhook(req('/api/stripe/webhook', 'POST', { 'stripe-signature': 't=1,v1=bad' }, {}));
    expect(res.status).toBe(400);
  });
});

describe('Shipper portal', () => {
  const dataRoutes = (H: Record<string, string>): Array<[string, () => Promise<Response>]> => [
    ['GET me', () => shipperMe(req('/api/shipper-portal/me', 'GET', H))],
    ['GET stats', () => shipperStats(req('/api/shipper-portal/stats', 'GET', H))],
    ['GET master-data', () => shipperMasterData(req('/api/shipper-portal/master-data', 'GET', H))],
    ['POST rates/quote', () => shipperQuote(req('/api/shipper-portal/rates/quote', 'POST', H, {}))],
    ['GET shipments', () => shipperList(req('/api/shipper-portal/shipments', 'GET', H))],
    ['POST shipments', () => shipperCreate(req('/api/shipper-portal/shipments', 'POST', H, {}))],
    ['GET shipments/[id]', () => shipperDetail(req('/api/shipper-portal/shipments/shipment-1', 'GET', H), idParams)],
  ];

  for (const [label, H] of CALLERS) for (const [name, call] of dataRoutes(H)) {
    it(`${name}: 401 from the portal session check (${label})`, async () => {
      const res = await call();
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'Not authenticated' });
    });
  }

  it('login: rejects missing credentials with the generic error', async () => {
    const res = await shipperLogin(req('/api/shipper-portal/auth/login', 'POST', {}, {}));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'Invalid email or password' });
  });

  it('setup: requires an invitation token', async () => {
    const res = await shipperSetup(req('/api/shipper-portal/auth/setup', 'POST', {}, { password: 'x' }));
    expect(res.status).toBe(400);
  });

  it('logout: clears the session cookie without a staff session', async () => {
    const res = await shipperLogout();
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeTruthy();
  });
});

describe('Carrier portal', () => {
  // withTenantRls types its result as possibly undefined, so these handlers'
  // declared return type includes undefined.
  const deviceRoutes = (H: Record<string, string>): Array<[string, () => Promise<Response | undefined>]> => [
    ['GET app/loads', () => carrierLoads(req('/api/carrier-portal/app/loads', 'GET', H))],
    ['POST app/loads', () => carrierBidFromApp(req('/api/carrier-portal/app/loads', 'POST', H, {}))],
    ['GET app/loads/[id]', () => carrierLoad(req('/api/carrier-portal/app/loads/shipment-1', 'GET', H), idParams)],
    ['POST app/loads/[id]', () => carrierLoadUpdate(req('/api/carrier-portal/app/loads/shipment-1', 'POST', H, {}), idParams)],
    ['POST app/loads/[id]/pod', () => carrierPod(req('/api/carrier-portal/app/loads/shipment-1/pod', 'POST', H, {}), idParams)],
    ['POST app/loads/[id]/documents', () => carrierDocs(req('/api/carrier-portal/app/loads/shipment-1/documents', 'POST', H, {}), idParams)],
  ];

  for (const [label, H] of CALLERS) for (const [name, call] of deviceRoutes(H)) {
    it(`${name}: 401 from the device-token check (${label})`, async () => {
      const res = (await call())!;
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'Invalid carrier app token' });
    });
  }

  const tokenRoutes = (H: Record<string, string>): Array<[string, () => Promise<Response>]> => [
    ['POST resolve', () => carrierResolve(req('/api/carrier-portal/resolve', 'POST', H, {}))],
    ['POST bid', () => carrierBid(req('/api/carrier-portal/bid', 'POST', H, {}))],
    ['POST offer/resolve', () => offerResolve(req('/api/carrier-portal/offer/resolve', 'POST', H, {}))],
    ['POST offer/accept', () => offerAccept(req('/api/carrier-portal/offer/accept', 'POST', H, {}))],
  ];

  for (const [label, H] of CALLERS) for (const [name, call] of tokenRoutes(H)) {
    it(`${name}: requires the invite/offer token (${label})`, async () => {
      const res = await call();
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'token is required' });
    });
  }
});
