/**
 * HTTP-layer proof that the CBA and Headway APIs deny roles without
 * bus-ops:admin access.
 *
 * Both endpoints shipped with tenant scoping but NO role gate — any
 * authenticated user in the tenant could read and rewrite union pay
 * rules, hours-of-service limits, and the published timetable. The unit
 * test (tests/unit/bus-ops-admin-resources.test.ts) pins the permission
 * matrix; this file proves the routes actually enforce it end to end,
 * because a correct permission table wired to an unguarded handler
 * would still leave the hole open.
 *
 * Every method is exercised, not just GET. A guard applied to the read
 * path while a write path stays open is the more dangerous half.
 *
 * Prerequisites:
 *   - Next.js dev server running on localhost:3000
 *   - DATABASE_URL set
 *
 * Run: npx vitest run tests/integration/bus-ops-planning-engine-rbac.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTestTenantFull,
  cleanupTenant,
  cleanupUser,
  makeRequest,
  isServerRunning,
  type SeedResult,
} from '../setup';

const hasDb = Boolean(process.env.DATABASE_URL);
let serverAvailable = false;

/** Holds bus-ops:admin:* — should reach both surfaces. */
let manager: SeedResult | null = null;
/** No bus-ops permissions at all — should be refused everywhere. */
let outsider: SeedResult | null = null;

beforeAll(async () => {
  serverAvailable = await isServerRunning();
  if (!serverAvailable || !hasDb) return;
  manager  = await seedTestTenantFull('ENTERPRISE', 'TRANSPORT_MANAGER');
  outsider = await seedTestTenantFull('ENTERPRISE', 'FLEET_MANAGER');
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  for (const s of [manager, outsider]) {
    if (!s) continue;
    await cleanupTenant(s.tenant.id).catch(() => {});
    await cleanupUser(s.user.id).catch(() => {});
  }
}, 60_000);

const cookie = (s: SeedResult) => ({ cookie: `xl-session=${s.token}` });

/** Every mutating and reading entry point on the two guarded routes. */
const ENDPOINTS: Array<{
  label: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}> = [
  { label: 'CBA list',      method: 'GET',    path: '/api/bus-ops/cba' },
  { label: 'CBA default',   method: 'GET',    path: '/api/bus-ops/cba?default=true' },
  { label: 'CBA create',    method: 'POST',   path: '/api/bus-ops/cba', body: { name: 'rbac-probe' } },
  { label: 'CBA update',    method: 'PATCH',  path: '/api/bus-ops/cba?id=00000000-0000-0000-0000-000000000000', body: { name: 'x' } },
  { label: 'CBA delete',    method: 'DELETE', path: '/api/bus-ops/cba?id=00000000-0000-0000-0000-000000000000' },
  { label: 'Headway list',  method: 'GET',    path: '/api/bus-ops/headway?routeId=00000000-0000-0000-0000-000000000000' },
  { label: 'Headway create',method: 'POST',   path: '/api/bus-ops/headway', body: { routeId: '00000000-0000-0000-0000-000000000000', startTime: '06:00', endTime: '09:00', headwayMinutes: 15 } },
  { label: 'Headway delete',method: 'DELETE', path: '/api/bus-ops/headway?id=00000000-0000-0000-0000-000000000000' },
];

describe('CBA + Headway APIs reject roles without bus-ops:admin', () => {
  it.each(ENDPOINTS)('$label → 403 for FLEET_MANAGER', async ({ method, path, body }) => {
    if (!serverAvailable || !hasDb || !outsider) return;

    const res = await makeRequest(method, path, body, cookie(outsider));

    expect(res.status).toBe(403);

    // The refusal must come from the role gate, not incidentally from a
    // bad id or validation error further down the handler.
    const payload = await res.json().catch(() => null);
    expect(payload?.error ?? '').toMatch(/Tenant Administrator/i);
  }, 60_000);

  it.each(ENDPOINTS)('$label is not refused by the role gate for TRANSPORT_MANAGER', async ({ method, path, body }) => {
    if (!serverAvailable || !hasDb || !manager) return;

    const res = await makeRequest(method, path, body, cookie(manager));

    // Positive control: proves the guard is not simply refusing everyone.
    // These requests use deliberately nonexistent ids, so 400/404/500 are
    // all legitimate downstream outcomes — the assertion is specifically
    // that the caller got PAST the role gate.
    expect(res.status).not.toBe(403);
  }, 60_000);
});

describe('unauthenticated access is refused', () => {
  it.each(ENDPOINTS)('$label rejects a request with no session', async ({ method, path, body }) => {
    if (!serverAvailable || !hasDb) return;

    const res = await makeRequest(method, path, body, {});
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(201);
    expect([400, 401, 403]).toContain(res.status);
  }, 60_000);
});
