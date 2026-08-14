/**
 * Unit tests for src/middleware.ts — computeRateLimit() routing.
 *
 * What is tested:
 *  - Normal API paths use per-tenant + per-path bucket with the plan
 *    limit (documents the invariant tenants pay for)
 *  - Driver telemetry paths (heartbeat, behavior-events) route to a
 *    per-driver + per-category bucket with a category-specific limit
 *  - Prefix matching (path with trailing segments still routes to the
 *    telemetry bucket)
 *  - Driver A's flood doesn't touch Driver B's bucket (key isolation)
 *
 * These tests focus on the ROUTING decision — the sliding-window
 * counting behaviour of RateLimiter itself is covered in
 * rate-limiter.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { computeRateLimit } from '@/lib/rate-limit-scope';

const tenantA = 'tenant-A';
const tenantB = 'tenant-B';
const driverA = 'driver-A';
const driverB = 'driver-B';
const plan    = 'ENTERPRISE';

describe('computeRateLimit — normal API paths', () => {
  it('routes to a per-tenant + per-path bucket', () => {
    const out = computeRateLimit('/api/bus-ops/schedules', {
      tenantId: tenantA, userId: driverA, plan,
    });
    expect(out.scope).toBe('tenant-path');
    expect(out.key).toBe(`${tenantA}:/api/bus-ops/schedules`);
  });

  it('uses the plan-derived limit (ENTERPRISE = 1000/min)', () => {
    const out = computeRateLimit('/api/finance/invoices', {
      tenantId: tenantA, userId: driverA, plan: 'ENTERPRISE',
    });
    expect(out.limit).toBe(1000);
  });

  it('lower plans get lower limits', () => {
    const trial = computeRateLimit('/api/finance/invoices', {
      tenantId: tenantA, userId: driverA, plan: 'TRIAL',
    });
    expect(trial.limit).toBe(60);
  });
});

describe('computeRateLimit — driver telemetry paths', () => {
  it('/api/driver-app/heartbeat → per-driver telemetry bucket with 60/min', () => {
    const out = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantA, userId: driverA, plan,
    });
    expect(out.scope).toBe('telemetry');
    expect(out.key).toBe(`telemetry:${tenantA}:${driverA}:heartbeat`);
    expect(out.limit).toBe(60);
  });

  it('/api/driver-app/behavior-events → per-driver telemetry bucket with 120/min', () => {
    const out = computeRateLimit('/api/driver-app/behavior-events', {
      tenantId: tenantA, userId: driverA, plan,
    });
    expect(out.scope).toBe('telemetry');
    expect(out.key).toBe(`telemetry:${tenantA}:${driverA}:behavior-events`);
    expect(out.limit).toBe(120);
  });

  it('matches sub-paths under a telemetry prefix', () => {
    // e.g. /api/driver-app/heartbeat/foo — still telemetry.
    const out = computeRateLimit('/api/driver-app/heartbeat/echo', {
      tenantId: tenantA, userId: driverA, plan,
    });
    expect(out.scope).toBe('telemetry');
    expect(out.key).toBe(`telemetry:${tenantA}:${driverA}:heartbeat`);
  });

  it('telemetry limits do NOT depend on plan (device-scoped, not billing)', () => {
    const enterprise = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantA, userId: driverA, plan: 'ENTERPRISE',
    });
    const trial = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantA, userId: driverA, plan: 'TRIAL',
    });
    expect(enterprise.limit).toBe(trial.limit);
    expect(enterprise.limit).toBe(60);
  });
});

describe('computeRateLimit — isolation properties (R2 acceptance criteria)', () => {
  it('Driver A and Driver B in the same tenant get different keys', () => {
    const a = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantA, userId: driverA, plan,
    });
    const b = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantA, userId: driverB, plan,
    });
    expect(a.key).not.toBe(b.key);
  });

  it('same driver across tenants gets different keys', () => {
    const t1 = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantA, userId: driverA, plan,
    });
    const t2 = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantB, userId: driverA, plan,
    });
    expect(t1.key).not.toBe(t2.key);
  });

  it('heartbeat and behavior-events for the same driver are separate buckets', () => {
    const hb = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantA, userId: driverA, plan,
    });
    const bh = computeRateLimit('/api/driver-app/behavior-events', {
      tenantId: tenantA, userId: driverA, plan,
    });
    expect(hb.key).not.toBe(bh.key);
    // Different categories can have different limits
    expect(hb.limit).not.toBe(bh.limit);
  });

  it('driver-app telemetry does NOT consume the normal tenant/path budget', () => {
    // A driver hammering /api/driver-app/heartbeat should not collide with
    // an admin call to /api/finance/invoices in the same tenant.
    const hb    = computeRateLimit('/api/driver-app/heartbeat', {
      tenantId: tenantA, userId: driverA, plan,
    });
    const admin = computeRateLimit('/api/finance/invoices', {
      tenantId: tenantA, userId: 'admin-user', plan,
    });
    expect(hb.key).not.toBe(admin.key);
    expect(hb.scope).toBe('telemetry');
    expect(admin.scope).toBe('tenant-path');
  });
});
