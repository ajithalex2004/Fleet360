import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  membership: vi.fn(), staff: vi.fn(), existing: vi.fn(), upsert: vi.fn(),
  revoke: vi.fn(), subscriptions: vi.fn(), scope: vi.fn(), tick: vi.fn(),
  reminders: vi.fn(), sendPush: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { $disconnect: db.disconnect } }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_: unknown, tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
    db.scope(tenantId);
    return fn({
      userTenant: { findFirst: db.membership }, staffMember: { findFirst: db.staff },
      pushSubscription: { findUnique: db.existing, upsert: db.upsert, updateMany: db.revoke, findMany: db.subscriptions },
    });
  },
}));
vi.mock('@prisma/client', async importOriginal => ({
  ...await importOriginal<typeof import('@prisma/client')>(),
  PrismaClient: class { constructor() { db.connect(); } $disconnect = db.disconnect; },
}));
vi.mock('@/lib/session-blocklist', () => ({ isSessionRevoked: async () => false }));
vi.mock('@/lib/jobs/outbox-publisher', () => ({ runOutboxPublisher: db.tick }));
vi.mock('@/lib/push/scheduler', () => ({ runTripReminders: db.reminders }));
vi.mock('@/lib/push/server', () => ({ sendPush: db.sendPush, getPublicVapidKey: () => 'public-vapid-key' }));

import { signSession } from '@/lib/tenant-session';
import { POST as subscribe, DELETE as unsubscribe } from '@/app/api/push/subscribe/route';
import { POST as testPush } from '@/app/api/push/test/route';
import { POST as outbox, GET as outboxGet } from '@/app/api/cron/outbox-publish/route';
import { POST as schedule } from '@/app/api/push/run-scheduler/route';
import { GET as publicKey } from '@/app/api/push/public-key/route';
import { verifyJobAuthorization } from '@/lib/jobs/registry';

const body = { endpoint: 'https://push.example/sub', keys: { p256dh: 'key', auth: 'key' }, employeeId: 'employee-a' };
function request(path: string, headers: Record<string, string> = {}, payload: unknown = body, method = 'POST') {
  return new NextRequest(`https://fleet.example${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
  });
}
async function cookie(role = 'TENANT_ADMIN', ttlMs?: number) {
  return 'xl-session=' + await signSession({ userId: 'user-a', tenantId: 'tenant-a', plan: 'ENTERPRISE', role, ttlMs });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SESSION_SECRET', 'A7mQ9xLp2RsV5nKt8WbE4zYh6DcF3jUg0PaS');
  vi.stubEnv('CRON_SECRET', 'cron-regression');
  vi.stubEnv('PUSH_CRON_SECRET', 'push-regression');
  db.membership.mockResolvedValue({ user: { employeeId: 'employee-a' } });
  db.staff.mockResolvedValue({ id: 'staff-a', tenantId: 'tenant-a', employeeId: 'employee-a' });
  db.existing.mockResolvedValue(null);
  db.upsert.mockResolvedValue({ id: 'sub-a' });
  db.revoke.mockResolvedValue({ count: 0 });
  db.subscriptions.mockResolvedValue([]);
  db.tick.mockResolvedValue({ status: 'ok', summary: 'No unpublished events' });
  db.reminders.mockResolvedValue({ sent: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('public handler credential boundary (real signed sessions, mocked effects)', () => {
  it('rejects forged headers on every mutation before data access', async () => {
    const forged = { 'x-tenant-id': 'tenant-b', 'x-user-id': 'admin', 'x-user-role': 'SUPER_ADMIN', 'x-role': 'SUPER_ADMIN' };
    for (const route of [subscribe, testPush, outbox, schedule]) {
      expect((await route(request('/api/probe', forged))).status).toBe(401);
    }
    expect((await unsubscribe(request('/api/push/subscribe?endpoint=x', forged, null, 'DELETE'))).status).toBe(401);
    expect(db.scope).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
    expect(db.reminders).not.toHaveBeenCalled();
  });
  it.each(['garbage', 'sess-roster-employee-a-123'])('rejects invalid session %s', async token => {
    expect((await subscribe(request('/api/push/subscribe', { cookie: `xl-session=${token}` }))).status).toBe(401);
    expect(db.scope).not.toHaveBeenCalled();
  });
  it('rejects expired and duplicate session cookies', async () => {
    expect((await subscribe(request('/api/push/subscribe', { cookie: await cookie('TENANT_ADMIN', -1000) }))).status).toBe(401);
    const valid = await cookie();
    expect((await subscribe(request('/api/push/subscribe', { cookie: `${valid}; ${valid}` }))).status).toBe(401);
  });
  it('binds subscription ownership to verified account, ignoring forged tenant/body ownership', async () => {
    const res = await subscribe(request('/api/push/subscribe', { cookie: await cookie(), 'x-tenant-id': 'tenant-b' }, { ...body, tenantId: 'tenant-b' }));
    expect(res.status).toBe(201);
    expect(db.scope).toHaveBeenCalledWith('tenant-a');
    expect(db.membership).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-a', tenantId: 'tenant-a', isActive: true, user: { isActive: true }, tenant: { isActive: true } }) }));
    expect(db.staff).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', employeeId: 'employee-a', deletedAt: null, isActive: true } }));
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { endpoint: body.endpoint, tenantId: 'tenant-a', staffMemberId: 'staff-a' },
      create: expect.objectContaining({ tenantId: 'tenant-a', staffMemberId: 'staff-a' }),
    }));
    expect(db.upsert.mock.calls[0][0].update).not.toHaveProperty('staffMemberId');
  });
  it('rejects a guessed employee even within the same tenant', async () => {
    const headers = { cookie: await cookie() };
    expect((await subscribe(request('/api/push/subscribe', headers, { ...body, employeeId: 'victim' }))).status).toBe(403);
    expect((await testPush(request('/api/push/test', headers, { employeeId: 'victim' }))).status).toBe(403);
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.sendPush).not.toHaveBeenCalled();
  });
  it('rejects inactive/unlinked membership and deleted staff', async () => {
    const headers = { cookie: await cookie() };
    db.membership.mockResolvedValueOnce(null);
    expect((await subscribe(request('/api/push/subscribe', headers))).status).toBe(403);
    db.staff.mockResolvedValueOnce(null);
    expect((await subscribe(request('/api/push/subscribe', headers))).status).toBe(403);
    expect(db.upsert).not.toHaveBeenCalled();
  });
  it('cannot take over another staff subscription', async () => {
    db.existing.mockResolvedValue({ staffMemberId: 'staff-b', tenantId: 'tenant-a' });
    expect((await subscribe(request('/api/push/subscribe', { cookie: await cookie() }))).status).toBe(403);
    expect(db.upsert).not.toHaveBeenCalled();
  });
  it('revokes only subscriptions belonging to the verified staff', async () => {
    expect((await unsubscribe(request('/api/push/subscribe?endpoint=victim', { cookie: await cookie() }, null, 'DELETE'))).status).toBe(200);
    expect(db.revoke).toHaveBeenCalledWith({ where: { endpoint: 'victim', tenantId: 'tenant-a', staffMemberId: 'staff-a' }, data: { revokedAt: expect.any(Date) } });
  });
  it('keeps the public key anonymous and legitimate self-test working', async () => {
    expect((await publicKey()).status).toBe(200);
    expect((await testPush(request('/api/push/test', { cookie: await cookie() }))).status).toBe(200);
    expect(db.subscriptions).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', staffMemberId: 'staff-a', revokedAt: null } }));
  });
  it('rejects ordinary tenant admins for the global outbox, accepts platform admin', async () => {
    expect((await outbox(request('/api/cron/outbox-publish', { cookie: await cookie() }))).status).toBe(403);
    expect(db.tick).not.toHaveBeenCalled();
    expect((await outbox(request('/api/cron/outbox-publish', { cookie: await cookie('SUPER_ADMIN') }))).status).toBe(200);
    expect(db.tick).toHaveBeenCalledOnce();
  });
  it('accepts legitimate scheduler credentials for GET and POST', async () => {
    expect((await outboxGet(request('/api/cron/outbox-publish', { authorization: 'Bearer cron-regression' }, null, 'GET'))).status).toBe(200);
    expect((await schedule(request('/api/push/run-scheduler?tenantId=tenant-b', { authorization: 'Bearer push-regression' }))).status).toBe(200);
    expect(db.reminders).toHaveBeenCalledWith('tenant-b');
  });
  it('tenant admins cannot widen push scheduler scope', async () => {
    const headers = { cookie: await cookie() };
    expect((await schedule(request('/api/push/run-scheduler?tenantId=tenant-b', headers))).status).toBe(403);
    expect((await schedule(request('/api/push/run-scheduler', headers))).status).toBe(200);
    expect(db.reminders).toHaveBeenCalledWith('tenant-a');
  });
  it('fails closed with no scheduler configuration even in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CRON_SECRET', ''); vi.stubEnv('PUSH_CRON_SECRET', '');
    expect((await outbox(request('/api/cron/outbox-publish'))).status).toBe(401);
    expect((await schedule(request('/api/push/run-scheduler'))).status).toBe(401);
    expect((await verifyJobAuthorization(request('/api/jobs/run'), 'outbox-publisher')).authorized).toBe(false);
    expect(db.tick).not.toHaveBeenCalled(); expect(db.reminders).not.toHaveBeenCalled();
  });
  it('legacy job dispatcher also restricts the global outbox to platform admins', async () => {
    expect((await verifyJobAuthorization(request('/api/jobs/run', { cookie: await cookie() }), 'outbox-publisher')).status).toBe(403);
    expect((await verifyJobAuthorization(request('/api/jobs/run', { cookie: await cookie('SUPER_ADMIN') }), 'outbox-publisher')).authorized).toBe(true);
  });
  it('authenticated schedulers retain an explicit tenant selector after middleware', async () => {
    const headers = { authorization: 'Bearer cron-regression', 'x-requested-tenant-id': 'tenant-b' };
    expect((await verifyJobAuthorization(request('/api/jobs/run', headers), 'push-scheduler')).tenantId).toBe('tenant-b');
    expect((await schedule(request('/api/push/run-scheduler', { ...headers, authorization: 'Bearer push-regression' }))).status).toBe(200);
    expect(db.reminders).toHaveBeenCalledWith('tenant-b');
  });
});
