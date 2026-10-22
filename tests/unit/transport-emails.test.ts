/**
 * tests/unit/transport-emails.test.ts
 *
 * School bus and staff transport messages sent through the tenant email
 * templates.
 *
 * Covered:
 *  - guardian alerts: the event's template, the same text on WhatsApp and
 *    email, escalation to guardian2, the log row; run under the tenant and
 *    never on the caller's transaction
 *  - trip notices: the notice's template per passenger, sent after the
 *    transaction; the summary to Transport Managers (not OPERATIONS_EMAIL);
 *    a cancellation recorded; nothing sent in a dry run
 *  - waitlist sweep: seat confirmations sent after the transaction with the
 *    seat-confirmed template
 *  - trip events: the trip is looked up under the session tenant
 *  - the notice values
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-a';

const state = vi.hoisted(() => ({
  inTx: false,
  sentInTx: 0,
  acting: [] as string[],
  whatsapp: [] as Array<{ to: string; body: string }>,
  emails: [] as Array<{ to: string | string[]; subject: string; html?: string; text?: string }>,
  sms: [] as Array<{ to: string; body: string }>,
  whatsappOk: true,
  emailOk: true,
  templateKeys: [] as string[],
  sql: [] as Array<{ sql: string; args: unknown[] }>,
  students: {} as Record<string, Record<string, unknown>>,
  managers: ['tm@acme.test'] as string[],
  schedule: null as null | Record<string, unknown>,
  staff: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  callerTxUsed: 0,
}));

vi.mock('@/lib/whatsapp', () => ({
  sendWhatsApp: async (m: { to: string; body: string }) => {
    if (state.inTx) state.sentInTx += 1;
    state.whatsapp.push(m);
    return state.whatsappOk ? { sent: true } : { sent: false, reason: 'twilio_error' };
  },
}));
vi.mock('@/lib/email', () => ({
  sendEmail: async (m: { to: string; subject: string; html?: string; text?: string }) => {
    if (state.inTx) state.sentInTx += 1;
    state.emails.push(m);
    return state.emailOk ? { sent: true } : { sent: false, reason: 'smtp_error' };
  },
}));
vi.mock('@/lib/sms', () => ({
  sendSms: async (m: { to: string; body: string }) => { state.sms.push(m); return { sent: true }; },
}));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => {} }));
vi.mock('@/lib/session-user', () => ({ sessionUser: async () => ({ email: 'disp@acme.test', name: 'Dana Dispatcher' }) }));
// The Bus Ops access policy (verified session, tenant, module, permission)
// has its own tests; here the caller is allowed, as in the other Bus Ops
// route tests. Without this the notify route answered 401: these requests
// carry identity headers but no signed session cookie.
vi.mock('@/lib/bus-ops/access', () => ({ requireBusOpsRequest: async () => null }));
vi.mock('@/lib/staff-recipients', () => ({ staffRecipients: async () => state.managers }));

// The catalogue's built-in wording, rendered as the tenant "Acme".
vi.mock('@/lib/email-templates', async () => {
  const { getTemplateDef, templateVariables } = await import('@/lib/email-templates/catalogue');
  const { renderEmailContent } = await import('@/lib/email-templates/render');
  const context = { companyName: 'Acme', locale: 'en', productName: null, logoUrl: null, primaryColor: null };
  return {
    tenantEmailContext: async () => context,
    loadEmailTemplate: async ({ key }: { key: string }) => {
      state.templateKeys.push(key);
      const def = getTemplateDef(key)!;
      // Empty values take the variable's fallback, as the real loader does.
      const withFallbacks = (v: Record<string, string>) => Object.fromEntries(
        templateVariables(def).map((tv) => [tv.name, v[tv.name] || tv.fallback?.en || v[tv.name] || '']),
      );
      return {
        locale: 'en',
        render: ({ values, blocks }: { values: Record<string, string> | ((l: string) => Record<string, string>); blocks?: Record<string, { html: string; text: string }> }) => ({
          ...renderEmailContent({
            ...def.defaults.en,
            values: withFallbacks({ companyName: 'Acme', ...(typeof values === 'function' ? values('en') : values) }),
            blocks, locale: 'en', branding: { companyName: 'Acme' },
          }),
          locale: 'en', source: 'default',
        }),
      };
    },
  };
});

vi.mock('@/lib/rls-scope', async () => {
  const { AsyncLocalStorage } = await import('async_hooks');
  const scope = new AsyncLocalStorage<{ tx: unknown }>();
  const acting = new AsyncLocalStorage<string>();
  return {
    activeRlsScope: () => scope.getStore(),
    runWithRlsScope: <T>(s: { tx: unknown }, fn: () => Promise<T>) => scope.run(s, fn),
    runOutsideRlsScope: <T>(fn: () => Promise<T>) => new Promise<T>((res, rej) => scope.exit(() => { fn().then(res, rej); })),
    runAsTenant: <T>(t: string, fn: () => Promise<T>) => acting.run(t, async () => await fn()),
    actingTenantId: () => acting.getStore(),
  };
});

// Global client: raw calls record the tenant they run under, and flag use
// of a caller's transaction (an active scope).
vi.mock('@/lib/prisma', async () => {
  const scopeMod = await import('@/lib/rls-scope');
  const raw = (kind: 'q' | 'e') => async (sql: string, ...args: unknown[]) => {
    if ((scopeMod as unknown as { activeRlsScope: () => unknown }).activeRlsScope()) state.callerTxUsed += 1;
    state.acting.push(String((scopeMod as unknown as { actingTenantId: () => string | undefined }).actingTenantId()));
    state.sql.push({ sql, args });
    if (kind === 'q' && sql.includes('FROM school_bus_students')) {
      const s = state.students[String(args[0])];
      return s ? [s] : [];
    }
    return kind === 'q' ? [] : 1;
  };
  return { prisma: { $queryRawUnsafe: raw('q'), $executeRawUnsafe: raw('e') } };
});

// withTenantRls runs the callback on a fake transaction and flags it.
const tripTx = vi.hoisted(() => ({
  tripSchedule: {
    findUnique: async () => state.schedule,
    update: async (a: Record<string, unknown>) => { state.updates.push(a); return {}; },
    findMany: async (): Promise<Array<{ id: string }>> => [],
  },
  staffMember: {
    findMany: async () => state.staff,
    findUnique: async ({ where }: { where: { id: string } }) => state.staff.find((s) => s.id === where.id) ?? null,
  },
  staffTransportRequest: { findMany: async () => [], update: async () => ({}) },
  tripPassenger: {
    findMany: async ({ where }: { where: { status?: string } }) =>
      where.status === 'WAITLISTED' ? [{ id: 'p-w1', staffMemberId: 's2' }] : [],
    count: async () => 1,
    update: async (a: Record<string, unknown>) => { state.updates.push(a); return {}; },
  },
  $queryRawUnsafe: async (sql: string, ...args: unknown[]) => { state.sql.push({ sql, args }); return []; },
  $executeRawUnsafe: async () => 1,
}));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.inTx = true;
    try { return await fn(tripTx); } finally { state.inTx = false; }
  },
}));

import { NextRequest } from 'next/server';
import { notifyGuardians } from '@/lib/school-bus-notify';
import { runWithRlsScope } from '@/lib/rls-scope';
import { tripNoticeValues } from '@/lib/bus-ops/trip-notices';
import { POST as notifyTrip } from '@/app/api/bus-ops/schedules/[id]/notify/route';
import { POST as sweepWaitlist } from '@/app/api/bus-ops/schedules/sweep-waitlist/route';
import { POST as tripEvent } from '@/app/api/school-bus/trips/[id]/events/route';

const headers = { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };

const student = (id: string, extra: Record<string, unknown> = {}) => ({
  id, student_code: 'S1', first_name: 'Layla', last_name: 'Haddad',
  guardian1_name: 'Mona', guardian1_phone: '+971500000001', guardian1_email: 'mona@home.test',
  guardian2_name: 'Omar', guardian2_phone: null, guardian2_email: 'omar@home.test',
  ...extra,
});

beforeEach(() => {
  Object.assign(state, {
    inTx: false, sentInTx: 0, acting: [], whatsapp: [], emails: [], sms: [], whatsappOk: true, emailOk: true,
    templateKeys: [], sql: [], students: {}, managers: ['tm@acme.test'], schedule: null, staff: [], updates: [], callerTxUsed: 0,
  });
  delete process.env.OPERATIONS_EMAIL;
  delete process.env.OPERATIONS_PHONE;
});

describe('guardian alerts', () => {
  it('sends the boarded template on WhatsApp and email, logs it, under the tenant', async () => {
    state.students.st1 = student('st1');
    const [r] = await notifyGuardians(TENANT, 'BOARDED', [{ studentId: 'st1', stopName: 'Gate 3', time: '06:52' }]);

    expect(state.templateKeys).toEqual(['school_bus.boarded']);
    expect(r.ok).toBe(true);
    expect(state.whatsapp).toEqual([{ to: '+971500000001', body: expect.stringContaining('Layla boarded the bus at Gate 3 at 06:52.') }]);
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0]).toMatchObject({ to: 'mona@home.test', subject: 'Layla is on the bus' });
    expect(state.emails[0].html).toContain('Acme');
    const log = state.sql.find((q) => q.sql.includes('INSERT INTO school_bus_guardian_notifications'))!;
    expect(log.args.slice(0, 3)).toEqual(['st1', 'BOARDED', 'Layla is on the bus']);
    expect(new Set(state.acting)).toEqual(new Set([TENANT]));
  });

  it('escalates to guardian2 when guardian1 is not reached', async () => {
    state.students.st1 = student('st1');
    state.whatsappOk = false;
    state.emailOk = false;
    const [r] = await notifyGuardians(TENANT, 'NO_SHOW', [{ studentId: 'st1', stopName: 'Gate 3', time: '07:10' }]);
    expect(state.emails.map((e) => e.to)).toEqual(['mona@home.test', 'omar@home.test']);
    expect(state.emails[1].subject).toBe('Layla did not board the bus today');
    expect(r).toMatchObject({ ok: false, reachedGuardian1: false, reachedGuardian2: false });
  });

  it("never runs on the caller's transaction", async () => {
    state.students.st1 = student('st1');
    state.students.st2 = student('st2', { first_name: 'Sami' });
    await runWithRlsScope({ tx: {} } as never, () =>
      notifyGuardians(TENANT, 'DEPARTURE', [{ studentId: 'st1' }, { studentId: 'st2' }]));
    expect(state.callerTxUsed).toBe(0);
    expect(state.emails.map((e) => e.subject)).toEqual(['Bus departed - Layla', 'Bus departed - Sami']);
  });
});

describe('staff transport trip notices', () => {
  const schedule = () => ({
    id: 'trip-1', tripNumber: 'TRP-0412', status: 'SCHEDULED', notes: null,
    departureTime: new Date('2026-10-01T06:30:00'),
    route: { name: 'JAFZA Shift A' },
    passengers: [
      { id: 'p1', staffMemberId: 's1', status: 'CONFIRMED', employeeName: 'Ahmed Khan' },
      { id: 'p2', staffMemberId: 's2', status: 'WAITLISTED', employeeName: 'Not Sent' },
    ],
  });
  const post = (body: Record<string, unknown>) => notifyTrip(
    new NextRequest('http://localhost/api/bus-ops/schedules/trip-1/notify', { method: 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'trip-1' }) },
  );

  it('sends the delay template to each passenger after the transaction, and the summary to Transport Managers', async () => {
    state.schedule = schedule();
    state.staff = [{ id: 's1', name: 'Ahmed Khan', email: 'ahmed@acme.test', contactNumber: '+971500000009' }];
    process.env.OPERATIONS_EMAIL = 'ops@platform.test';

    const res = await post({ kind: 'DELAY', delayMinutes: 15, reason: 'Traffic on E11', channels: ['EMAIL', 'WHATSAPP'] });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(state.sentInTx).toBe(0);
    expect(state.templateKeys).toEqual(['staff_transport.trip_delay', 'staff_transport.ops_summary']);
    expect(json).toMatchObject({ recipients: 1, sentEmail: 1, sentWhatsApp: 1 });

    const [passenger, summary] = state.emails;
    expect(passenger).toMatchObject({ to: 'ahmed@acme.test', subject: 'Your bus is running late - trip TRP-0412' });
    expect(passenger.text).toContain('Dear Ahmed,');
    expect(passenger.text).toContain('about 15 minutes late');
    expect(passenger.text).toContain('Reason: Traffic on E11');
    expect(state.whatsapp[0].body).toBe(passenger.text);

    expect(summary.to).toEqual(['tm@acme.test']);
    expect(summary.subject).toBe('Delay sent for trip TRP-0412: 1/1 reached');
    expect(summary.text).toContain('Dana Dispatcher');
    expect(summary.text).toContain('> Dear colleague,');
    expect(state.emails.some((e) => e.to === 'ops@platform.test')).toBe(false);
  });

  it('records a cancellation and sends the cancelled template', async () => {
    state.schedule = schedule();
    state.staff = [{ id: 's1', name: 'Ahmed Khan', email: 'ahmed@acme.test', contactNumber: null }];
    const res = await post({ kind: 'CANCELLED', reason: 'Breakdown', includeDispatcher: false });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ where: { id: 'trip-1' }, data: { status: 'CANCELLED' } });
    expect(state.emails.map((e) => e.subject)).toEqual(['Trip TRP-0412 is cancelled']);
  });

  it('sends nothing in a dry run but returns the preview', async () => {
    state.schedule = schedule();
    state.staff = [{ id: 's1', name: 'Ahmed Khan', email: 'ahmed@acme.test', contactNumber: '+971500000009' }];
    const res = await post({ kind: 'CANCELLED', dryRun: true });
    const json = await res.json();
    expect(state.emails).toHaveLength(0);
    expect(state.whatsapp).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
    expect(json.recipients).toBe(1);
    expect(json.preview.subject).toBe('Trip TRP-0412 is cancelled');
  });

  it('rejects an unknown kind and a missing trip', async () => {
    expect((await post({ kind: 'NOPE' })).status).toBe(400);
    expect((await post({ kind: 'DELAY' })).status).toBe(404);
  });
});

describe('waitlist sweep', () => {
  it('confirms promoted seats with the seat-confirmed template after the transaction', async () => {
    state.staff = [{ id: 's2', name: 'Sara Ali', email: 'sara@acme.test', contactNumber: '+971500000010' }];
    tripTx.tripSchedule.findMany = async () => [{ id: 'trip-2' }];
    (tripTx.tripSchedule as Record<string, unknown>).findUnique = async () => ({
      id: 'trip-2', tripNumber: 'TRP-0500', departureTime: new Date('2026-10-01T07:15:00'), capacity: 2, confirmedCount: 1,
      route: { name: 'Downtown Loop' },
    });
    const res = await sweepWaitlist(new NextRequest('http://localhost/api/bus-ops/schedules/sweep-waitlist?forDate=2026-10-01', { method: 'POST', headers }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(state.sentInTx).toBe(0);
    expect(state.templateKeys).toEqual(['staff_transport.seat_confirmed']);
    expect(state.emails[0]).toMatchObject({ to: 'sara@acme.test', subject: 'Seat confirmed - trip TRP-0500' });
    expect(state.emails[0].text).toContain('Dear Sara,');
    expect(json.promotions[0]).toMatchObject({ whatsappSent: true, emailSent: true });
  });
});

describe('school bus trip events', () => {
  it("looks the trip up under the session's tenant, not 'default'", async () => {
    await tripEvent(
      new NextRequest('http://localhost/api/school-bus/trips/t1/events', {
        method: 'POST', headers, body: JSON.stringify({ eventType: 'STOP_ARRIVAL', tenantId: 'other' }),
      }),
      { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }) },
    );
    const lookup = state.sql.find((q) => q.sql.includes('FROM school_bus_trips WHERE id'))!;
    expect(lookup.args[1]).toBe(TENANT);
  });
});

describe('trip notice values', () => {
  it('fills the new departure for a delay and falls back for a route change', () => {
    const trip = { tripNumber: 'T1', routeName: null, departure: new Date('2026-10-01T06:30:00') };
    expect(tripNoticeValues('DELAY', { ...trip, delayMinutes: 10, newDeparture: '2026-10-01T06:40:00' }))
      .toMatchObject({ delayMinutes: '10', newDepartureTime: '06:40', departureTime: '06:30', routeName: '', reason: '' });
    expect(tripNoticeValues('ROUTE_CHANGE', trip).newDepartureTime).toBe('06:30');
    expect(tripNoticeValues('CUSTOM', { ...trip, message: 'Rear door today' }).message).toBe('Rear door today');
  });
});
