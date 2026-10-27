/**
 * Trip reminders are planned inside the tenant transaction and sent outside it.
 *
 * runTripReminders sent up to 2,000 Web Push calls from inside runSweep's
 * per-tenant transaction (30 s timeout); a timeout rolled back the
 * lastSentAt updates of pushes already delivered. lastSentAt was also never
 * read, so each passenger was pushed on every cron run inside the 4-minute
 * reminder window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  log: [] as string[],
  inSweepTx: false,
  subsWhere: null as unknown,
}));

const tripTime = vi.hoisted(() => new Date(Date.now() + 10 * 60_000));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma-sweep', () => ({
  runSweep: async (fn: (ctx: { tx: unknown; tenantId: string }) => Promise<unknown>) => {
    const tx = {
      tripPassenger: { findMany: async () => [{
        staffMemberId: 'staff-1', tripId: 'trip-1',
        trip: { departureTime: tripTime, route: { name: 'Line 1', origin: 'Gate', destination: 'HQ' } },
      }] },
      staffMember: { findMany: async () => [{ id: 'staff-1' }] },
      pushSubscription: { findMany: async (args: { where: unknown }) => {
        st.subsWhere = args.where;
        return [{ id: 'sub-1', endpoint: 'https://push', p256dh: 'k', auth: 'a', staffMemberId: 'staff-1' }];
      } },
    };
    st.inSweepTx = true;
    st.log.push('sweep:begin');
    try {
      return [{ tenantId: 'tenant-a', result: await fn({ tx, tenantId: 'tenant-a' }) }];
    } finally {
      st.inSweepTx = false;
      st.log.push('sweep:end');
    }
  },
}));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => fn({
    pushSubscription: { updateMany: async (a: { data: Record<string, unknown> }) => {
      st.log.push(`update:${Object.keys(a.data).join(',')}`);
      return {};
    } },
  }),
}));
vi.mock('@/lib/push/server', () => ({
  sendPush: async () => {
    st.log.push(`send:inTx=${st.inSweepTx}`);
    return { ok: true };
  },
}));

import { runTripReminders } from '@/lib/push/scheduler';

beforeEach(() => {
  st.log.length = 0;
  st.subsWhere = null;
});

describe('runTripReminders', () => {
  it('sends after the sweep’s transactions end, then records lastSentAt', async () => {
    const r = await runTripReminders(null);
    expect(r).toMatchObject({ tenantsScanned: 1, tripsMatched: 1, pushesSent: 1, errors: 0 });
    expect(st.log).toEqual(['sweep:begin', 'sweep:end', 'send:inTx=false', 'update:lastSentAt']);
  });

  it('skips subscriptions reminded in the last few minutes', async () => {
    await runTripReminders(null);
    expect(st.subsWhere).toMatchObject({
      revokedAt: null,
      optInTripReminder: true,
      OR: [{ lastSentAt: null }, { lastSentAt: { lt: expect.any(Date) } }],
    });
  });
});
