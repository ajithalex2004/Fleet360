/**
 * tests/unit/dunning-sweep-timeout.test.ts
 *
 * The dunning sweep runs each tenant's invoices inside one transaction.
 * With withSystemJob's generic 30s default, a slow database closed that
 * transaction mid-sweep and the next statement failed with P2028
 * ("Transaction not found") — seen in the Phase 0 dunning integration suite.
 * runDunningSweep now passes its own, longer budget to runSweep.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma-sweep', () => ({ runSweep: vi.fn(async () => []) }));

import { runSweep } from '@/lib/prisma-sweep';
import {
  DEFAULT_DUNNING_SWEEP_TENANT_TIMEOUT_MS,
  dunningSweepTenantTimeoutMs,
  runDunningSweep,
} from '@/lib/jobs/dunning-sweep';
import type { JobContext } from '@/lib/jobs/registry';

const saved = process.env.DUNNING_SWEEP_TENANT_TIMEOUT_MS;
afterEach(() => {
  if (saved === undefined) delete process.env.DUNNING_SWEEP_TENANT_TIMEOUT_MS;
  else process.env.DUNNING_SWEEP_TENANT_TIMEOUT_MS = saved;
  vi.mocked(runSweep).mockClear();
});

function ctx(tenantId: string | null): JobContext {
  return {
    tenantId,
    userId: 'system:cron',
    searchParams: new URLSearchParams(),
    request: {} as JobContext['request'],
  };
}

describe('dunningSweepTenantTimeoutMs', () => {
  it('defaults to 120s, well above the generic 30s', () => {
    delete process.env.DUNNING_SWEEP_TENANT_TIMEOUT_MS;
    expect(dunningSweepTenantTimeoutMs()).toBe(DEFAULT_DUNNING_SWEEP_TENANT_TIMEOUT_MS);
    expect(DEFAULT_DUNNING_SWEEP_TENANT_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it('honours a positive DUNNING_SWEEP_TENANT_TIMEOUT_MS', () => {
    process.env.DUNNING_SWEEP_TENANT_TIMEOUT_MS = '300000';
    expect(dunningSweepTenantTimeoutMs()).toBe(300_000);
  });

  it('ignores invalid values', () => {
    for (const bad of ['', '0', '-5', 'abc']) {
      process.env.DUNNING_SWEEP_TENANT_TIMEOUT_MS = bad;
      expect(dunningSweepTenantTimeoutMs()).toBe(DEFAULT_DUNNING_SWEEP_TENANT_TIMEOUT_MS);
    }
  });
});

describe('runDunningSweep', () => {
  it('passes the dunning budget and the tenant scope to runSweep', async () => {
    delete process.env.DUNNING_SWEEP_TENANT_TIMEOUT_MS;
    await runDunningSweep(ctx('tenant-a'));
    expect(runSweep).toHaveBeenCalledWith(expect.any(Function), {
      tenantHeader: 'tenant-a',
      timeoutMs: DEFAULT_DUNNING_SWEEP_TENANT_TIMEOUT_MS,
    });
  });
});
