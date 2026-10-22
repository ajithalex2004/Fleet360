/**
 * Rule-based notifications are delivered, not parked as 'Pending'.
 *
 * NotificationDispatchConsumer and AlertEngineConsumer wrote 'Pending'
 * NotificationLog rows for a channel worker that does not exist, so nothing
 * was ever sent. Delivery now happens in the event's tenant: role
 * recipients resolve to that tenant's users, email goes through the
 * platform sender, and what cannot be sent is recorded as such.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  sent: [] as string[],
  logged: [] as Array<{ recipient: string; type: string; status: string }>,
  roleQueries: [] as Array<[string, string]>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationLog: {
      create: async ({ data }: { data: { recipient: string; type: string; status: string } }) => {
        st.logged.push({ recipient: data.recipient, type: data.type, status: data.status });
        return data;
      },
    },
  },
}));
vi.mock('@/lib/notifications', () => ({
  sendServerEmail: async (to: string) => { st.sent.push(to); return !to.startsWith('bounce'); },
}));
vi.mock('@/lib/workflow-db', () => ({
  getRoleHolders: async (tenantId: string, role: string) => {
    st.roleQueries.push([tenantId, role]);
    return role === 'TENANT_ADMIN' ? [{ email: 'ann@t.example' }, { email: 'bob@t.example' }] : [];
  },
  // Only user-1 is an active member of tenant-a.
  getMemberEmailById: async (tenantId: string, userId: string) =>
    tenantId === 'tenant-a' && userId === 'user-0000001' ? 'carol@t.example' : null,
}));

import { deliverNotification } from '@/lib/notification-delivery';

const base = { tenantId: 'tenant-a', subject: 'S', body: 'B', triggerReason: 'R' };

beforeEach(() => {
  st.sent.length = 0;
  st.logged.length = 0;
  st.roleQueries.length = 0;
});

describe('deliverNotification', () => {
  it('emails an address directly', async () => {
    expect(await deliverNotification({ ...base, channel: 'EMAIL', recipient: 'Ops@X.example' })).toEqual(['Sent']);
    expect(st.sent).toEqual(['ops@x.example']);
  });

  it('resolves a role to the users holding it in the event’s tenant', async () => {
    expect(await deliverNotification({ ...base, channel: 'Email', recipient: 'ADMIN' })).toEqual(['Sent', 'Sent']);
    expect(st.roleQueries).toEqual([['tenant-a', 'TENANT_ADMIN']]);
    expect(st.sent).toEqual(['ann@t.example', 'bob@t.example']);
  });

  it('reads a CUSTOM {"email": …} recipient', async () => {
    await deliverNotification({ ...base, channel: 'EMAIL', recipient: '{"email":"c@x.example"}' });
    expect(st.sent).toEqual(['c@x.example']);
  });

  it('records a recipient that resolves to nobody as Undeliverable, not Pending', async () => {
    expect(await deliverNotification({ ...base, channel: 'EMAIL', recipient: 'FLEET_MANAGER' })).toEqual(['Undeliverable']);
    expect(st.logged).toEqual([{ recipient: 'FLEET_MANAGER', type: 'EMAIL', status: 'Undeliverable' }]);
    expect(st.sent).toEqual([]);
  });

  it('records a channel with no sender as Unsupported, not Pending', async () => {
    expect(await deliverNotification({ ...base, channel: 'SMS', recipient: 'ADMIN' })).toEqual(['Unsupported']);
    expect(st.logged).toEqual([{ recipient: 'ADMIN', type: 'SMS', status: 'Unsupported' }]);
  });

  it('reports a failed send without throwing', async () => {
    expect(await deliverNotification({ ...base, channel: 'EMAIL', recipient: 'bounce@x.example' })).toEqual(['Failed']);
  });

  it('never writes a Pending row', async () => {
    for (const recipient of ['ops@x.example', 'ADMIN', 'FLEET_MANAGER', 'nonsense']) {
      for (const channel of ['EMAIL', 'SMS', 'WHATSAPP']) await deliverNotification({ ...base, channel, recipient });
    }
    expect(st.logged.some((l) => l.status === 'Pending')).toBe(false);
  });

  it('resolves a specific-recipient user id to that member of the event’s tenant', async () => {
    expect(await deliverNotification({ ...base, channel: 'EMAIL', recipient: 'user-0000001' })).toEqual(['Sent']);
    expect(st.sent).toEqual(['carol@t.example']);
  });

  it('records an unknown or other-tenant user id as Undeliverable', async () => {
    expect(await deliverNotification({ ...base, tenantId: 'tenant-b', channel: 'EMAIL', recipient: 'user-0000001' })).toEqual(['Undeliverable']);
    expect(st.sent).toEqual([]);
  });
});
