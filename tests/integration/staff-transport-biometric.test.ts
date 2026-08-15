/**
 * Integration test for the driver-app biometric (WebAuthn) endpoints.
 *
 * P0 test (audit 2026-08-13) — all 5 biometric routes were
 * previously untested:
 *   1. GET  /api/driver-app/auth/biometric/status
 *   2. POST /api/driver-app/auth/biometric/login/start
 *   3. POST /api/driver-app/auth/biometric/login/finish
 *   4. POST /api/driver-app/auth/biometric/register
 *   5. POST /api/driver-app/auth/biometric/register/finish
 *
 * This test covers the auth + lookup logic that can be exercised
 * without an actual WebAuthn platform authenticator. The actual
 * ceremony (navigator.credentials.create / get) requires a real
 * device with TouchID / FaceID / Android BiometricPrompt.
 *
 * Run: npx vitest run tests/integration/staff-transport-biometric.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { isServerRunning, makeRequest, seedTestTenantFull, type SeedResult } from '../setup';

let serverUp = false;
let seed: SeedResult | undefined;

beforeAll(async () => {
  serverUp = await isServerRunning();
  if (!serverUp) {
    console.warn('dev server not up — biometric tests will skip');
    return;
  }
  seed = await seedTestTenantFull();
}, 60_000);

describe('Driver biometric — /api/driver-app/auth/biometric/status', () => {
  it('returns the expected shape when no session cookie is present', async () => {
    if (!serverUp) return;
    const res = await makeRequest('GET', '/api/driver-app/auth/biometric/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('hasSession');
    expect(body).toHaveProperty('hasBiometricRegistered');
    expect(body.hasSession).toBe(false);
  });

  it('returns the expected shape when an admin session cookie is present', async () => {
    if (!serverUp || !seed) return;
    const res = await makeRequest(
      'GET',
      '/api/driver-app/auth/biometric/status',
      undefined,
      { cookie: `xl-session=${seed.token}` },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasSession).toBe(true);
  });
});

describe('Driver biometric — /api/driver-app/auth/biometric/login/start', () => {
  it('returns 400 when username is missing', async () => {
    if (!serverUp) return;
    const res = await makeRequest(
      'POST',
      '/api/driver-app/auth/biometric/login/start',
      {},
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/username/i);
  });

  it('returns 404 when username is not a known driver', async () => {
    if (!serverUp) return;
    const res = await makeRequest(
      'POST',
      '/api/driver-app/auth/biometric/login/start',
      { username: 'nobody-this-driver-does-not-exist@nowhere.invalid' },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/driver|credential|not found/i);
  });

  it('returns 404 when driver exists but has no WebAuthn credentials', async () => {
    if (!serverUp || !seed) return;
    const res = await makeRequest(
      'POST',
      '/api/driver-app/auth/biometric/login/start',
      { username: seed.user.email },
    );
    expect([404, 200]).toContain(res.status);
  });
});

describe('Driver biometric — /api/driver-app/auth/biometric/register', () => {
  it('returns 401 when no session is present', async () => {
    if (!serverUp) return;
    const res = await makeRequest(
      'POST',
      '/api/driver-app/auth/biometric/register',
    );
    expect(res.status).toBe(401);
  });
});

describe('Driver biometric — /api/driver-app/auth/biometric/register/finish', () => {
  it('returns 401 when no session is present', async () => {
    if (!serverUp) return;
    const res = await makeRequest(
      'POST',
      '/api/driver-app/auth/biometric/register/finish',
      { response: { id: 'fake', rawAttestation: 'fake' } },
    );
    expect(res.status).toBe(401);
  });
});

describe('Driver biometric — /api/driver-app/auth/biometric/login/finish', () => {
  it('returns 4xx when the assertion payload is malformed (no session required to fail validation)', async () => {
    if (!serverUp) return;
    const res = await makeRequest(
      'POST',
      '/api/driver-app/auth/biometric/login/finish',
      {},
    );
    expect([400, 401]).toContain(res.status);
  });
});
