/**
 * Auth behaviour for POST /api/push/run-scheduler.
 *
 * The endpoint previously wrapped its secret check in `if (secret)`, so an
 * unset PUSH_CRON_SECRET meant no authentication at all — and a call with no
 * tenant makes runTripReminders() iterate every tenant. These tests pin the
 * fail-closed behaviour so that can't silently regress.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const runTripReminders = vi.fn().mockResolvedValue({ sent: 0 });
vi.mock('@/lib/push/scheduler', () => ({
  runTripReminders: (...args: unknown[]) => runTripReminders(...args),
}));

function post(headers: Record<string, string> = {}, url = 'http://localhost/api/push/run-scheduler') {
  return new NextRequest(url, { method: 'POST', headers });
}

async function callRoute(req: NextRequest) {
  // Imported lazily so each test picks up its own process.env.
  const mod = await import('@/app/api/push/run-scheduler/route');
  return mod.POST(req);
}

beforeEach(() => {
  vi.resetModules();
  runTripReminders.mockClear();
  // vi.stubEnv rather than assigning process.env directly — Node refuses
  // Object.defineProperty on process.env, and a plain reassignment doesn't
  // survive vi.resetModules().
  vi.stubEnv('PUSH_CRON_SECRET', '');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('run-scheduler auth', () => {
  it('refuses to run in production when the secret is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await callRoute(post());
    expect(res.status).toBe(503);
    // 503, not 401/403 — the deployment is misconfigured, not the caller.
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('PUSH_CRON_SECRET') });
    expect(runTripReminders).not.toHaveBeenCalled();
  });

  it('still allows an unset secret outside production', async () => {
    const res = await callRoute(post());
    expect(res.status).toBe(200);
    expect(runTripReminders).toHaveBeenCalledOnce();
  });

  it('rejects a wrong secret even outside production', async () => {
    vi.stubEnv('PUSH_CRON_SECRET', 'right');
    const res = await callRoute(post({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(403);
    expect(runTripReminders).not.toHaveBeenCalled();
  });

  it('rejects a missing secret when one is configured', async () => {
    vi.stubEnv('PUSH_CRON_SECRET', 'right');
    const res = await callRoute(post());
    expect(res.status).toBe(403);
    expect(runTripReminders).not.toHaveBeenCalled();
  });

  it('accepts the Authorization: Bearer form', async () => {
    vi.stubEnv('PUSH_CRON_SECRET', 'right');
    const res = await callRoute(post({ authorization: 'Bearer right' }));
    expect(res.status).toBe(200);
  });

  it('accepts the x-push-cron-secret header', async () => {
    vi.stubEnv('PUSH_CRON_SECRET', 'right');
    const res = await callRoute(post({ 'x-push-cron-secret': 'right' }));
    expect(res.status).toBe(200);
  });

  it('accepts ?secret= for compatibility with existing cron config', async () => {
    vi.stubEnv('PUSH_CRON_SECRET', 'right');
    const res = await callRoute(post({}, 'http://localhost/api/push/run-scheduler?secret=right'));
    expect(res.status).toBe(200);
  });

  it('lets an operator session through without the secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await callRoute(post({ 'x-tenant-id': 'tenant-1' }));
    expect(res.status).toBe(200);
    // Scoped to that tenant, not an all-tenant sweep.
    expect(runTripReminders).toHaveBeenCalledWith('tenant-1');
  });

  it('passes null tenantId for an all-tenant sweep when authorised by secret', async () => {
    vi.stubEnv('PUSH_CRON_SECRET', 'right');
    const res = await callRoute(post({ authorization: 'Bearer right' }));
    expect(res.status).toBe(200);
    expect(runTripReminders).toHaveBeenCalledWith(null);
  });
});
