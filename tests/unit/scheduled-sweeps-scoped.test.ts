/**
 * Scheduled sweeps read in each tenant's RLS scope.
 *
 * alert-trip-overdue and bus-ops-generate-schedule-templates queried
 * RLS-protected tables on the bare client. A scheduled run has no request
 * tenant, so RLS returned no rows: no TRIP_OVERDUE alert was ever raised and
 * no trip was generated from a template. A manual run only saw the caller's
 * tenant. They now read through runSweep (every tenant, or the caller's on a
 * manual run) and act per tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobContext } from '@/lib/jobs/registry';

const st = vi.hoisted(() => ({
  log: [] as string[],
  inTenantTx: null as string | null,
  sweepOpts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma-sweep', () => ({
  runSweep: async (fn: (ctx: { tx: unknown; tenantId: string }) => Promise<unknown>, opts: Record<string, unknown>) => {
    st.sweepOpts.push(opts);
    const tenants = opts.tenantHeader ? [opts.tenantHeader as string] : ['tenant-a', 'tenant-b'];
    const out = [];
    for (const tenantId of tenants) {
      const tx = {
        $queryRaw: async () => [{
          id: `trip-${tenantId}`, tenant_id: tenantId, trip_number: 'T1', vehicle_id: null, driver_id: null,
          departure_time: new Date(Date.now() - 3 * 3600_000), arrival_time: new Date(Date.now() - 3600_000),
          status: 'DEPARTED', route_variant_version_id: null,
        }],
        busOpsScheduleTemplate: { findMany: async () => [{ id: `tpl-${tenantId}`, tenantId, name: 'Morning' }] },
      };
      st.log.push(`read:${tenantId}`);
      out.push({ tenantId, result: await fn({ tx, tenantId }) });
    }
    return out;
  },
}));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, tenantId: string, fn: () => Promise<unknown>) => {
    st.inTenantTx = tenantId;
    try { return await fn(); } finally { st.inTenantTx = null; }
  },
}));
vi.mock('@/lib/alerts/raise', () => ({
  raiseAlert: async (a: { tenantId: string }) => { st.log.push(`alert:${a.tenantId}`); },
}));
vi.mock('@/lib/bus-ops/generate-schedule-template', () => ({
  generateScheduleTemplate: async (a: { templateId: string; tenantId: string }) => {
    st.log.push(`generate:${a.templateId}@tx=${st.inTenantTx}`);
    return { generated: 2, skippedAlreadyExisted: 0, skippedOutOfWindow: 0, skippedInactiveOrException: 0, errors: 0 };
  },
}));

import { runAlertTripOverdue } from '@/lib/jobs/alert-trip-overdue';
import { runBusOpsGenerateScheduleTemplates } from '@/lib/jobs/bus-ops-generate-schedule-templates';

const ctx = (tenantId: string | null): JobContext =>
  ({ tenantId, userId: 'system:cron', searchParams: new URLSearchParams(), request: {} as never });

beforeEach(() => {
  st.log.length = 0;
  st.sweepOpts.length = 0;
  st.inTenantTx = null;
});

describe('alert-trip-overdue', () => {
  it('a scheduled run reads every tenant and raises their alerts after the reads', async () => {
    const r = await runAlertTripOverdue(ctx(null));
    expect(r.data).toMatchObject({ scanned: 2, raised: 2 });
    expect(st.log).toEqual(['read:tenant-a', 'read:tenant-b', 'alert:tenant-a', 'alert:tenant-b']);
  });

  it('a manual run covers only the caller’s tenant', async () => {
    await runAlertTripOverdue(ctx('tenant-b'));
    expect(st.sweepOpts[0]).toMatchObject({ tenantHeader: 'tenant-b' });
    expect(st.log).toEqual(['read:tenant-b', 'alert:tenant-b']);
  });
});

describe('bus-ops-generate-schedule-templates', () => {
  it('generates each tenant’s templates inside that tenant’s transaction', async () => {
    const r = await runBusOpsGenerateScheduleTemplates(ctx(null));
    expect(r.data).toMatchObject({ templateCount: 2 });
    expect(st.log.filter((l) => l.startsWith('generate:'))).toEqual([
      'generate:tpl-tenant-a@tx=tenant-a',
      'generate:tpl-tenant-b@tx=tenant-b',
    ]);
  });
});
