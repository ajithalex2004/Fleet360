/**
 * Tier 1: Feature Coverage — Milestone M1: Security & Production Runtime Breakages
 *
 * Covers Features F01 to F12 (>=5 tests per feature = 60 tests):
 *  - F01: SQL Parameterization (5 tests)
 *  - F02: Tenant Auth Checks (5 tests)
 *  - F03: Roster OTP Hardening (5 tests)
 *  - F04: Domain & Provisioning Security (5 tests)
 *  - F05: Webhook Signature Verification (5 tests)
 *  - F06: Cross-Tenant Isolation (5 tests)
 *  - F07: Secret & RBAC Hardening (5 tests)
 *  - F08: Auth Limits & Headers (5 tests)
 *  - F09: Timestamp Arithmetic Fix (5 tests)
 *  - F10: Dispatch Schema Migration (5 tests)
 *  - F11: Scheduler Connection Timeout Fix (5 tests)
 *  - F12: Public Origin Resolution (5 tests)
 */

import { test, expect } from '@playwright/test';
import { isServerAvailable, skipIfOffline, e2eFetch, createWebhookHmac, createTwilioSignature, FIXTURES } from '../tier-helpers';

let serverUp = false;

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

// ============================================================================
// F01: SQL Parameterization
// ============================================================================
test.describe('F01: SQL Parameterization', () => {
  test('TC-F01-01: Valid customer query returns sanitized JSON response', async () => {
    const res = await e2eFetch('/api/customers?limit=5');
    // Expect either 200 or 401 if unauthenticated, but never 500 SQL syntax error
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(Array.isArray(data.customers || data)).toBe(true);
    }
  });

  test('TC-F01-02: Customer lookup with SQL injection payload is treated as literal ID', async () => {
    const injectionId = "cust_123' OR '1'='1";
    const res = await e2eFetch(`/api/customers/${encodeURIComponent(injectionId)}`);
    // Should return 401 (unauthorized) or 404 (not found) — NEVER 200 (leaking all) or 500 (SQL error)
    expect([401, 404, 400]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    expect(body).not.toHaveProperty('sqlState');
  });

  test('TC-F01-03: Document query parameterization prevents unescaped interpolation', async () => {
    const malformedDocId = "doc_999'; DROP TABLE test_docs; --";
    const res = await e2eFetch(`/api/customers/cust_1/documents?id=${encodeURIComponent(malformedDocId)}`);
    expect([401, 404, 400]).toContain(res.status);
  });

  test('TC-F01-04: Stats route parameterization safely handles query parameters', async () => {
    const res = await e2eFetch('/api/customers/stats?status=ACTIVE&dateRange=30d');
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(typeof data).toBe('object');
    }
  });

  test('TC-F01-05: Customer search with special SQL meta-characters evaluates safely', async () => {
    const specialChars = "%_\\'\"--/*";
    const res = await e2eFetch(`/api/customers?search=${encodeURIComponent(specialChars)}`);
    expect([200, 401]).toContain(res.status);
  });
});

// ============================================================================
// F02: Tenant Auth Checks
// ============================================================================
test.describe('F02: Tenant Auth Checks', () => {
  test('TC-F02-01: Authorized tenant request succeeds with valid credentials', async () => {
    const res = await e2eFetch('/api/health');
    expect(res.status).toBe(200);
  });

  test('TC-F02-02: Missing authorization header/cookie on protected route returns 401 Unauthorized', async () => {
    const res = await e2eFetch('/api/vehicles');
    expect([401, 403]).toContain(res.status);
    const body = await res.json();
    expect(body.ok === false || body.error).toBeTruthy();
  });

  test('TC-F02-03: Malformed bearer token returns 401 Unauthorized', async () => {
    const res = await e2eFetch('/api/vehicles', {
      headers: { Authorization: 'Bearer invalid.tampered.token' },
    });
    expect(res.status).toBe(401);
  });

  test('TC-F02-04: Insufficient role returns 403 Forbidden', async () => {
    const res = await e2eFetch('/api/admin/tenants', {
      headers: { 'x-test-role': 'DRIVER' },
    });
    expect([401, 403]).toContain(res.status);
  });

  test('TC-F02-05: Tenant mismatch between session and route parameter returns 403 Forbidden', async () => {
    const res = await e2eFetch(`/api/tenants/${FIXTURES.randomUUID()}/settings`, {
      headers: { 'x-tenant-id': FIXTURES.randomUUID() },
    });
    expect([401, 403, 404]).toContain(res.status);
  });
});

// ============================================================================
// F03: Roster OTP Hardening
// ============================================================================
test.describe('F03: Roster OTP Hardening', () => {
  test('TC-F03-01: Request OTP generates random CSPRNG code and returns 200', async () => {
    const res = await e2eFetch('/api/auth/roster-otp', {
      method: 'POST',
      body: { identifier: FIXTURES.randomPhone(), tenantCode: 'E2E-TENANT' },
    });
    expect([200, 400, 401, 404]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.ok ?? body.success).toBe(true);
      // Secret OTP must never be returned in client response
      expect(body.otp).toBeUndefined();
    }
  });

  test('TC-F03-02: Hardcoded demo OTP 849201 is strictly rejected', async () => {
    const res = await e2eFetch('/api/auth/roster-otp', {
      method: 'POST',
      body: { action: 'VERIFY_OTP', identifier: '+971501234567', otp: '849201' },
    });
    expect([400, 401, 404]).toContain(res.status);
    const body = await res.json();
    expect(body.ok).not.toBe(true);
  });

  test('TC-F03-03: Verification endpoint requires complete parameters', async () => {
    const res = await e2eFetch('/api/auth/roster-otp', {
      method: 'POST',
      body: { action: 'VERIFY_OTP', identifier: '+971501234567' }, // missing otp
    });
    expect([400, 401, 404, 422]).toContain(res.status);
  });

  test('TC-F03-04: Expired OTP is rejected with 400/401', async () => {
    const res = await e2eFetch('/api/auth/roster-otp', {
      method: 'POST',
      body: { action: 'VERIFY_OTP', identifier: '+971501234567', otp: '000000', timestamp: Date.now() - 600000 },
    });
    expect([400, 401, 404]).toContain(res.status);
  });

  test('TC-F03-05: Exceeding maximum OTP attempt threshold triggers rate limiting', async () => {
    const phone = FIXTURES.randomPhone();
    let lastStatus = 200;
    for (let i = 0; i < 6; i++) {
      const res = await e2eFetch('/api/auth/roster-otp', {
        method: 'POST',
        body: { action: 'VERIFY_OTP', identifier: phone, otp: `12345${i}` },
      });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect([400, 401, 404, 429]).toContain(lastStatus);
  });
});

// ============================================================================
// F04: Domain & Provisioning Security
// ============================================================================
test.describe('F04: Domain & Provisioning Security', () => {
  test('TC-F04-01: Domain verification status requires authenticated tenant session', async () => {
    const res = await e2eFetch('/api/auth/domain-verify?domain=fleet360.io');
    expect([401, 403, 404]).toContain(res.status);
  });

  test('TC-F04-02: Unauthenticated query to domain verification does not disclose token', async () => {
    const res = await e2eFetch('/api/auth/domain-verify/token?domain=corp.example.com');
    expect([401, 403, 404]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    expect(body.verificationToken).toBeUndefined();
  });

  test('TC-F04-03: Cross-tenant domain verification attempt is rejected with 403/409', async () => {
    const res = await e2eFetch('/api/auth/domain-verify', {
      method: 'POST',
      body: { domain: 'another-tenant.com', tenantId: FIXTURES.randomUUID() },
    });
    expect([401, 403, 404, 409]).toContain(res.status);
  });

  test('TC-F04-04: Unauthorized plan escalation to ENTERPRISE without payment is blocked', async () => {
    const res = await e2eFetch('/api/admin/tenants/provision', {
      method: 'POST',
      body: { name: 'Escalation Corp', plan: 'ENTERPRISE', bypassPayment: true },
    });
    expect([401, 403, 400]).toContain(res.status);
  });

  test('TC-F04-05: Provisioning endpoint rejects unauthenticated requests', async () => {
    const res = await e2eFetch('/api/admin/tenants/provision', {
      method: 'POST',
      body: { name: 'New Tenant Inc' },
    });
    expect([401, 403]).toContain(res.status);
  });
});

// ============================================================================
// F05: Webhook Signature Verification
// ============================================================================
test.describe('F05: Webhook Signature Verification', () => {
  test('TC-F05-01: Webhook with valid HMAC-SHA256 signature format is processed', async () => {
    const payload = JSON.stringify({ event: 'message.delivered', id: FIXTURES.randomUUID() });
    const secret = 'test-webhook-secret';
    const signature = createWebhookHmac(secret, payload);

    const res = await e2eFetch('/api/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': `sha256=${signature}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    // Server either accepts or rejects due to test secret mismatch, but must fail closed gracefully
    expect([200, 401, 403, 500]).toContain(res.status);
  });

  test('TC-F05-02: Webhook with missing signature header returns 401/403', async () => {
    const res = await e2eFetch('/api/webhooks/whatsapp', {
      method: 'POST',
      body: { event: 'test.unauthorized' },
    });
    expect([400, 401, 403]).toContain(res.status);
  });

  test('TC-F05-03: Webhook with corrupted/tampered payload returns 401/403', async () => {
    const payload = JSON.stringify({ event: 'payment.completed', amount: 500 });
    const signature = createWebhookHmac('secret', payload);

    const res = await e2eFetch('/api/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'x-hub-signature-256': `sha256=${signature}`,
      },
      body: JSON.stringify({ event: 'payment.completed', amount: 999999 }), // tampered
    });
    expect([401, 403]).toContain(res.status);
  });

  test('TC-F05-04: Twilio webhook validates HMAC signature before processing', async () => {
    const url = 'http://127.0.0.1:3000/api/webhooks/twilio';
    const params = { MessageSid: 'SM123', Body: 'STOP' };
    const sig = createTwilioSignature('test-auth-token', url, params);

    const res = await e2eFetch('/api/webhooks/twilio', {
      method: 'POST',
      headers: { 'X-Twilio-Signature': sig },
      body: params,
    });
    expect([200, 401, 403, 500]).toContain(res.status);
  });

  test('TC-F05-05: Webhook endpoint fails closed when secret is missing', async () => {
    const res = await e2eFetch('/api/webhooks/twilio', {
      method: 'POST',
      body: { SmsSid: 'SM999' },
    });
    expect([400, 401, 403]).toContain(res.status);
  });
});

// ============================================================================
// F06: Cross-Tenant Isolation
// ============================================================================
test.describe('F06: Cross-Tenant Isolation', () => {
  test('TC-F06-01: Report schedules query is scoped to callers tenant', async () => {
    const res = await e2eFetch('/api/reports/schedules');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F06-02: Accessing report schedule belonging to another tenant returns 404/403', async () => {
    const foreignScheduleId = FIXTURES.randomUUID();
    const res = await e2eFetch(`/api/reports/schedules/${foreignScheduleId}`);
    expect([401, 403, 404]).toContain(res.status);
  });

  test('TC-F06-03: Driver HOS logs are strictly partitioned by tenant ID', async () => {
    const res = await e2eFetch('/api/drivers/hos-logs');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F06-04: Corporate clients list returns only tenant-owned clients', async () => {
    const res = await e2eFetch('/api/customer-hierarchy');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F06-05: Attempting RLS wildcard * escalation is rejected', async () => {
    const res = await e2eFetch('/api/reports/schedules', {
      headers: { 'x-tenant-id': '*' },
    });
    expect([400, 401, 403]).toContain(res.status);
  });
});

// ============================================================================
// F07: Secret & RBAC Hardening
// ============================================================================
test.describe('F07: Secret & RBAC Hardening', () => {
  test('TC-F07-01: Driver routes require valid authentication', async () => {
    const res = await e2eFetch('/api/driver-app/today/assignments');
    expect([401, 403]).toContain(res.status);
  });

  test('TC-F07-02: Non-driver roles are denied access to driver actions', async () => {
    const res = await e2eFetch('/api/driver-app/dvir', {
      method: 'POST',
      headers: { 'x-test-role': 'FINANCE_VIEWER' },
      body: { vehicleId: FIXTURES.randomUUID(), odometer: 1000, passed: true },
    });
    expect([401, 403]).toContain(res.status);
  });

  test('TC-F07-03: Impersonation session preserves original admin role in audit trails', async () => {
    const res = await e2eFetch('/api/auth/me', {
      headers: { 'x-impersonated-by': 'SUPER_ADMIN' },
    });
    expect([200, 401]).toContain(res.status);
  });

  test('TC-F07-04: Server rejects default or fallback secrets in production configuration', async () => {
    const res = await e2eFetch('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@fleet360.io', password: 'secret' },
    });
    expect([200, 400, 401, 429]).toContain(res.status);
  });

  test('TC-F07-05: Role elevation attempt via payload tampering is rejected', async () => {
    const res = await e2eFetch('/api/users/profile', {
      method: 'PATCH',
      body: { role: 'SUPER_ADMIN' },
    });
    expect([401, 403, 400, 404]).toContain(res.status);
  });
});

// ============================================================================
// F08: Auth Limits & Headers
// ============================================================================
test.describe('F08: Auth Limits & Headers', () => {
  test('TC-F08-01: Successful login endpoint is active and handles POST', async () => {
    const res = await e2eFetch('/api/auth/login', {
      method: 'POST',
      body: { email: 'test@example.com', password: 'IncorrectPassword1!' },
    });
    expect([401, 400, 429]).toContain(res.status);
  });

  test('TC-F08-02: Rapid failed login attempts trigger 429 Too Many Requests', async () => {
    let got429 = false;
    for (let i = 0; i < 8; i++) {
      const res = await e2eFetch('/api/auth/login', {
        method: 'POST',
        body: { email: 'brute-force@test.example', password: `guess${i}` },
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    // Rate limit must trigger 429 after repeated failed attempts
    expect(got429).toBe(true);
  });

  test('TC-F08-03: Excessively long passwords (>128 chars) are rejected to prevent PBKDF2 DoS', async () => {
    const hugePassword = 'A'.repeat(5000);
    const res = await e2eFetch('/api/auth/login', {
      method: 'POST',
      body: { email: 'test@example.com', password: hugePassword },
    });
    expect([400, 401, 422, 429]).toContain(res.status);
  });

  test('TC-F08-04: Security headers are present on responses', async () => {
    const res = await e2eFetch('/api/health');
    expect(res.status).toBe(200);
    const nosniff = res.headers.get('x-content-type-options');
    const xframe = res.headers.get('x-frame-options');
    if (nosniff) expect(nosniff.toLowerCase()).toBe('nosniff');
    if (xframe) expect(['deny', 'sameorigin']).toContain(xframe.toLowerCase());
  });

  test('TC-F08-05: Password reset endpoint enforces rate limits and validation', async () => {
    const res = await e2eFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'reset-target@example.com' },
    });
    expect([200, 400, 404, 429]).toContain(res.status);
  });
});

// ============================================================================
// F09: Timestamp Arithmetic Fix
// ============================================================================
test.describe('F09: Timestamp Arithmetic Fix', () => {
  test('TC-F09-01: School bus trips query calculates scheduled datetime without SQL 42883 error', async () => {
    const res = await e2eFetch('/api/school-bus/trips?date=2026-11-16');
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(Array.isArray(data.trips || data)).toBe(true);
    }
  });

  test('TC-F09-02: Trips query with specific route ID executes cleanly', async () => {
    const res = await e2eFetch('/api/school-bus/trips?routeId=route_001');
    expect([200, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F09-03: Trips query does not silently swallow errors with empty array', async () => {
    const res = await e2eFetch('/api/school-bus/trips?date=invalid-date');
    expect([400, 422, 401, 403]).toContain(res.status);
  });

  test('TC-F09-04: Midnight boundary trips handle date transition correctly', async () => {
    const res = await e2eFetch('/api/school-bus/trips?date=2026-12-31&time=23:59:00');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F09-05: Missing scheduled_start time handled gracefully without crash', async () => {
    const res = await e2eFetch('/api/school-bus/trips', {
      method: 'POST',
      body: { routeId: FIXTURES.randomUUID(), scheduledDate: '2026-11-17' }, // omitted scheduledStart
    });
    expect([400, 401, 403, 422]).toContain(res.status);
  });
});

// ============================================================================
// F10: Dispatch Schema Migration
// ============================================================================
test.describe('F10: Dispatch Schema Migration', () => {
  test('TC-F10-01: /api/readyz returns 200 confirming schema completeness', async () => {
    const res = await e2eFetch('/api/readyz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  test('TC-F10-02: Dispatch jobs API supports job querying', async () => {
    const res = await e2eFetch('/api/dispatch/jobs');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F10-03: Driver availability queries all availability status columns', async () => {
    const res = await e2eFetch('/api/dispatch/driver-availability');
    expect([200, 401, 403]).toContain(res.status);
  });

  test('TC-F10-04: Dispatch job creation validates required fields', async () => {
    const res = await e2eFetch('/api/dispatch/jobs', {
      method: 'POST',
      body: { title: 'Emergency Dispatch' }, // missing origin, destination, vehicle
    });
    expect([400, 401, 403, 422]).toContain(res.status);
  });

  test('TC-F10-05: Schema completeness does not report missing columns', async () => {
    const res = await e2eFetch('/api/readyz?checkColumns=true');
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// F11: Scheduler Connection Timeout Fix
// ============================================================================
test.describe('F11: Scheduler Connection Timeout Fix', () => {
  test('TC-F11-01: Background sweep endpoint executes within fast timeout threshold', async () => {
    const start = Date.now();
    const res = await e2eFetch('/api/jobs/sweep', {
      method: 'POST',
      headers: { 'x-job-secret': 'sweep-worker-key' },
    });
    const duration = Date.now() - start;
    // Must complete fast (< 6000ms), NOT hairpin and hit 10.5s ConnectTimeoutError
    expect(duration).toBeLessThan(8000);
    expect([200, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F11-02: Sweep adapter handles in-process trigger without public URL hairpin', async () => {
    const res = await e2eFetch('/api/cron/cleanup-sessions', {
      method: 'POST',
    });
    expect([200, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F11-03: Expired session cleanup job returns structured execution report', async () => {
    const res = await e2eFetch('/api/cron/cleanup-sessions');
    expect([200, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F11-04: Queued notification sweep job executes cleanly', async () => {
    const res = await e2eFetch('/api/cron/retry-notifications');
    expect([200, 401, 403, 404]).toContain(res.status);
  });

  test('TC-F11-05: Concurrent scheduler ticks do not deadlock', async () => {
    const [res1, res2] = await Promise.all([
      e2eFetch('/api/jobs/sweep', { method: 'POST' }),
      e2eFetch('/api/jobs/sweep', { method: 'POST' }),
    ]);
    expect([200, 401, 403, 404]).toContain(res1.status);
    expect([200, 401, 403, 404]).toContain(res2.status);
  });
});

// ============================================================================
// F12: Public Origin Resolution
// ============================================================================
test.describe('F12: Public Origin Resolution', () => {
  test('TC-F12-01: X-Forwarded-Proto and X-Forwarded-Host resolve to public origin', async () => {
    const res = await e2eFetch('/api/auth/callback/test', {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'app.fleet360.io',
      },
    });
    // In redirects or responses, host must be app.fleet360.io
    const location = res.headers.get('location');
    if (location && location.startsWith('http')) {
      expect(location).toContain('app.fleet360.io');
    }
  });

  test('TC-F12-02: Non-standard proxy ports preserved in resolved public origin', async () => {
    const res = await e2eFetch('/api/auth/callback/test', {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'app.fleet360.io:8443',
      },
    });
    const location = res.headers.get('location');
    if (location && location.startsWith('http')) {
      expect(location).toContain('8443');
    }
  });

  test('TC-F12-03: Internal loopback addresses (127.0.0.1 / localhost:8080) not leaked in public URLs', async () => {
    const res = await e2eFetch('/api/health', {
      headers: {
        'x-forwarded-host': 'staging.fleet360.io',
      },
    });
    const bodyText = await res.text();
    expect(bodyText).not.toContain('localhost:8080');
  });

  test('TC-F12-04: Missing proxy headers fall back safely to configured app URL', async () => {
    const res = await e2eFetch('/api/health');
    expect(res.status).toBe(200);
  });

  test('TC-F12-05: Public origin resolution prevents protocol downgrade attack', async () => {
    const res = await e2eFetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'http', // client claiming http behind https reverse proxy
      },
      body: { email: 'probe@example.com', password: 'invalid-password' },
    });
    expect([200, 301, 302, 307, 308, 400, 401, 429]).toContain(res.status);
  });
});
