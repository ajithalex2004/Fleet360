/**
 * Passkey step-up before high-impact admin actions: which actions need it,
 * the step-up token's binding to one session, the middleware gate, and the
 * passkey ceremonies end to end against a software authenticator (a real
 * P-256 key pair), with the database faked in memory.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

// ── In-memory database ───────────────────────────────────────────────────────
interface PasskeyRow { id: string; userId: string; rpId: string; publicKey: string; counter: bigint; transports: string[]; deviceName: string; createdAt: Date; lastUsedAt: Date | null }
interface ChallengeRow { challenge: string; userId: string; kind: string; expiresAt: Date }
const db = vi.hoisted(() => ({
  passkeys: [] as PasskeyRow[],
  challenges: [] as ChallengeRow[],
  users: new Map<string, { email: string; username: string; password_hash: string | null; mfa_enabled: boolean; mfa_secret: string | null; mfa_recovery_codes: string[] | null }>(),
  audits: [] as Array<Record<string, unknown>>,
}));

const match = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'lt' in (v as object)) return (row[k] as Date) < (v as { lt: Date }).lt;
    return row[k] === v;
  });

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => {
  const tx = {
    staffPasskey: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => db.passkeys.filter((p) => match(p as never, where)),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => db.passkeys.find((p) => match(p as never, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => db.passkeys.find((p) => p.id === where.id) ?? null,
      count: async ({ where }: { where: Record<string, unknown> }) => db.passkeys.filter((p) => match(p as never, where)).length,
      create: async ({ data }: { data: Omit<PasskeyRow, 'createdAt' | 'lastUsedAt'> }) => { db.passkeys.push({ ...data, createdAt: new Date(), lastUsedAt: null }); return data; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PasskeyRow> }) => Object.assign(db.passkeys.find((p) => p.id === where.id)!, data),
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = db.passkeys.length;
        db.passkeys = db.passkeys.filter((p) => !match(p as never, where));
        return { count: before - db.passkeys.length };
      },
    },
    stepUpChallenge: {
      create: async ({ data }: { data: ChallengeRow }) => { db.challenges.push(data); return data; },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        db.challenges = db.challenges.filter((c) => !match(c as never, where));
        return { count: 0 };
      },
    },
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
      if (sql.includes('DELETE FROM step_up_challenges')) {
        const [challenge, userId, kind] = args;
        const hit = db.challenges.find((c) => c.challenge === challenge && c.userId === userId && c.kind === kind && c.expiresAt > new Date());
        db.challenges = db.challenges.filter((c) => c !== hit);
        return hit ? [{ challenge: hit.challenge }] : [];
      }
      if (sql.includes('FROM "User"')) {
        const u = db.users.get(args[0] as string);
        return u ? [u] : [];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    $executeRawUnsafe: async (sql: string, codes: string, userId: string) => {
      if (sql.includes('mfa_recovery_codes')) db.users.get(userId)!.mfa_recovery_codes = JSON.parse(codes);
      return 1;
    },
  };
  return { withPlatformAdmin: async (_p: unknown, fn: (t: typeof tx) => unknown) => fn(tx) };
});
vi.mock('@/lib/audit', () => ({ logAudit: async (a: Record<string, unknown>) => { db.audits.push(a); } }));

import { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/password-policy';
import { generateRecoveryCodes, totpNow } from '@/lib/totp';
import { ADMIN_ROUTE_POLICY } from '@/lib/admin-access';
import { STEP_UP_ROUTES, STEP_UP_TTL_MS, stepUpMode, stepUpRouteFor } from '@/lib/auth/step-up-policy';

// Modules that read the mocks above must be imported after them: setup
// preloads the session module, so import fresh copies.
let signSession: typeof import('@/lib/tenant-session').signSession;
let verifySession: typeof import('@/lib/tenant-session').verifySession;
let signStepUp: typeof import('@/lib/auth/step-up-token').signStepUp;
let verifyStepUp: typeof import('@/lib/auth/step-up-token').verifyStepUp;
let middleware: typeof import('@/middleware').middleware;
let passkeys: typeof import('@/lib/auth/passkeys');
let routes: {
  stepUpOptions: typeof import('@/app/api/auth/step-up/options/route');
  stepUpVerify: typeof import('@/app/api/auth/step-up/verify/route');
  regOptions: typeof import('@/app/api/auth/passkeys/register/options/route');
  regVerify: typeof import('@/app/api/auth/passkeys/register/verify/route');
  removeOwn: typeof import('@/app/api/auth/passkeys/[id]/route');
  list: typeof import('@/app/api/auth/passkeys/route');
};

beforeAll(async () => {
  vi.resetModules();
  ({ signSession, verifySession } = await import('@/lib/tenant-session'));
  ({ signStepUp, verifyStepUp } = await import('@/lib/auth/step-up-token'));
  ({ middleware } = await import('@/middleware'));
  passkeys = await import('@/lib/auth/passkeys');
  routes = {
    stepUpOptions: await import('@/app/api/auth/step-up/options/route'),
    stepUpVerify: await import('@/app/api/auth/step-up/verify/route'),
    regOptions: await import('@/app/api/auth/passkeys/register/options/route'),
    regVerify: await import('@/app/api/auth/passkeys/register/verify/route'),
    removeOwn: await import('@/app/api/auth/passkeys/[id]/route'),
    list: await import('@/app/api/auth/passkeys/route'),
  };
});

const TENANT = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple 42';

beforeEach(() => {
  db.passkeys = [];
  db.challenges = [];
  db.audits = [];
  db.users.clear();
  db.users.set('admin-1', { email: 'admin@example.test', username: 'admin', password_hash: hashPassword(PASSWORD), mfa_enabled: false, mfa_secret: null, mfa_recovery_codes: null });
  db.users.set('root', { email: 'root@example.test', username: 'root', password_hash: hashPassword(PASSWORD), mfa_enabled: false, mfa_secret: null, mfa_recovery_codes: null });
  vi.stubEnv('WEBAUTHN_RP_ID', 'localhost');
  vi.stubEnv('WEBAUTHN_ORIGINS', ORIGIN);
});
afterEach(() => { vi.unstubAllEnvs(); });

// ── Software authenticator ───────────────────────────────────────────────────
function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const s = Buffer.from(value); return Buffer.concat([head(3, s.length), s]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) {
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  }
  throw new Error('unsupported');
}
const b64u = (b: Buffer) => b.toString('base64url');
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest();

class SoftAuthenticator {
  readonly keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly credId = crypto.randomBytes(16);
  counter = 0;
  constructor(readonly rpId = 'localhost', readonly origin = ORIGIN) {}
  get id() { return b64u(this.credId); }

  register(options: { challenge: string }, { userVerified = true } = {}) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const len = Buffer.alloc(2); len.writeUInt16BE(this.credId.length);
    const authData = Buffer.concat([
      sha256(this.rpId), Buffer.from([0x41 | (userVerified ? 0x04 : 0)]), Buffer.alloc(4),
      Buffer.alloc(16), len, this.credId, cose,
    ]);
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    return {
      id: this.id, rawId: this.id, type: 'public-key' as const, clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientData),
        attestationObject: b64u(cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))),
        transports: ['internal' as const],
      },
    };
  }

  assert(options: { challenge: string }, { userVerified = true } = {}) {
    this.counter += 1;
    const count = Buffer.alloc(4); count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([0x01 | (userVerified ? 0x04 : 0)]), count]);
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.keys.privateKey);
    return {
      id: this.id, rawId: this.id, type: 'public-key' as const, clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature) },
    };
  }
}

// ── Request helpers ──────────────────────────────────────────────────────────
async function session(userId = 'admin-1', extra: { impersonatedBy?: string; role?: string } = {}) {
  const token = await signSession({ userId, tenantId: TENANT, plan: 'ENTERPRISE', role: extra.role ?? 'SUPER_ADMIN', impersonatedBy: extra.impersonatedBy });
  const verified = (await verifySession(token))!;
  return { token, verified, subject: { userId, tenantId: TENANT, issuedAt: verified.issuedAt, ...(extra.impersonatedBy ? { impersonatedBy: extra.impersonatedBy } : {}) } };
}

function req(url: string, method: string, cookies: Record<string, string>, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
      'content-type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const stepUpCookieOf = (res: Response) => /xl-step-up=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];

/** Register a passkey for the session's user through the real routes. */
async function enroll(s: Awaited<ReturnType<typeof session>>, auth: SoftAuthenticator) {
  const opts = await routes.regOptions.POST(req('/api/auth/passkeys/register/options', 'POST', { 'xl-session': s.token }, { password: PASSWORD }));
  expect(opts.status).toBe(200);
  const res = await routes.regVerify.POST(req('/api/auth/passkeys/register/verify', 'POST', { 'xl-session': s.token }, { response: auth.register(await opts.json()), deviceName: 'Test key' }));
  expect(res.status).toBe(200);
  return res;
}

// ── Policy ───────────────────────────────────────────────────────────────────
describe('which actions need a step-up', () => {
  it('covers role, user, tenant and platform changes; not reads or protective actions', () => {
    expect(stepUpRouteFor('/api/admin/roles/r1/permissions', 'PUT')).toBe('roles/[id]/permissions');
    expect(stepUpRouteFor(`/api/admin/tenants/${TENANT}/users`, 'POST')).toBe('tenants/[id]/users');
    expect(stepUpRouteFor('/api/admin/impersonate', 'POST')).toBe('impersonate');
    expect(stepUpRouteFor('/api/admin/roles/r1/permissions', 'GET')).toBeNull();
    expect(stepUpRouteFor('/api/admin/users/u1/revoke-sessions', 'POST')).toBeNull();
    expect(stepUpRouteFor(`/api/admin/tenants/${TENANT}/api-keys/k1/revoke`, 'POST')).toBeNull();
    expect(stepUpRouteFor('/api/fleet/vehicles', 'DELETE')).toBeNull();
  });

  it('never lets an [id] template shadow a literal one', () => {
    expect(stepUpRouteFor('/api/admin/users/set-password', 'POST')).toBe('users/set-password');
    expect(stepUpRouteFor('/api/admin/roles/override', 'POST')).toBe('roles/override');
  });

  it('lists only admin routes and methods that exist', () => {
    const dir = path.resolve(__dirname, '../../src/app/api/admin');
    for (const [template, methods] of Object.entries(STEP_UP_ROUTES)) {
      expect(ADMIN_ROUTE_POLICY[template], template).toBeDefined();
      const file = path.join(dir, template, 'route.ts');
      const src = fs.readFileSync(file, 'utf8');
      for (const m of methods) {
        expect(ADMIN_ROUTE_POLICY[template][m], `${m} ${template} in ADMIN_ROUTE_POLICY`).toBeDefined();
        expect(new RegExp(`export (async )?function ${m}\\b|export const ${m}\\b`).test(src), `${m} exported by ${template}`).toBe(true);
      }
    }
  });

  it('enforces by default', () => {
    expect(stepUpMode(undefined)).toBe('enforce');
    expect(stepUpMode('report')).toBe('report');
    expect(stepUpMode('OFF')).toBe('off');
    expect(stepUpMode('nonsense')).toBe('enforce');
  });
});

// ── Token ────────────────────────────────────────────────────────────────────
describe('step-up token', () => {
  const subject = { userId: 'admin-1', tenantId: TENANT, issuedAt: 1_000 };

  it('is valid for the same session only, for 5 minutes', async () => {
    const now = 1_700_000_000_000;
    const token = await signStepUp(subject, now);
    expect(await verifyStepUp(token, subject, now + 1)).toBe(true);
    expect(await verifyStepUp(token, subject, now + STEP_UP_TTL_MS + 1)).toBe(false);
    expect(await verifyStepUp(token, { ...subject, issuedAt: 2_000 }, now)).toBe(false);   // signed in again
    expect(await verifyStepUp(token, { ...subject, tenantId: 'other' }, now)).toBe(false);  // switched tenant
    expect(await verifyStepUp(token, { ...subject, userId: 'someone' }, now)).toBe(false);
    expect(await verifyStepUp(token, { ...subject, impersonatedBy: 'root' }, now)).toBe(false);
  });

  it('rejects tampering, and never stands in for a session or the reverse', async () => {
    const token = await signStepUp(subject);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), uid: 'root' })).toString('base64url');
    expect(await verifyStepUp(`${forged}.${sig}`, { ...subject, userId: 'root' })).toBe(false);
    expect(await verifySession(token)).toBeNull();
    const s = await session();
    expect(await verifyStepUp(s.token, s.subject)).toBe(false);
  });
});

// ── Middleware gate ──────────────────────────────────────────────────────────
describe('middleware', () => {
  const action = (cookies: Record<string, string>) =>
    middleware(req('/api/admin/users/set-password', 'POST', cookies, { userId: 'u2', password: 'x' }));

  it('answers 403 step_up_required without a passkey check, and lets it through with one', async () => {
    const s = await session();
    const denied = await action({ 'xl-session': s.token });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'step_up_required', action: 'users/set-password' });
    expect((await action({ 'xl-session': s.token, 'xl-step-up': await signStepUp(s.subject) })).status).toBe(200);
  });

  it('does not accept a step-up from an earlier session', async () => {
    const old = await session();
    await new Promise((r) => setTimeout(r, 2));
    const current = await session();
    expect((await action({ 'xl-session': current.token, 'xl-step-up': await signStepUp(old.subject) })).status).toBe(403);
  });

  it('requires the impersonating platform admin\'s own check', async () => {
    const s = await session('admin-1', { impersonatedBy: 'root', role: 'SUPER_ADMIN' });
    const userOnly = await signStepUp({ userId: 'admin-1', tenantId: TENANT, issuedAt: s.verified.issuedAt });
    expect((await action({ 'xl-session': s.token, 'xl-step-up': userOnly })).status).toBe(403);
    expect((await action({ 'xl-session': s.token, 'xl-step-up': await signStepUp(s.subject) })).status).toBe(200);
  });

  it('report mode logs and lets through; off skips; reads never need it', async () => {
    const s = await session();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('STEP_UP_MODE', 'report');
    expect((await action({ 'xl-session': s.token })).status).toBe(200);
    expect(warn.mock.calls.some(([m]) => String(m).includes('"stepUp":"would-require"'))).toBe(true);
    vi.stubEnv('STEP_UP_MODE', 'off');
    expect((await action({ 'xl-session': s.token })).status).toBe(200);
    vi.stubEnv('STEP_UP_MODE', 'enforce');
    expect((await middleware(req('/api/admin/roles/r1/permissions', 'GET', { 'xl-session': s.token }))).status).toBe(200);
    warn.mockRestore();
  });
});

// ── Ceremonies end to end ────────────────────────────────────────────────────
describe('passkey registration and step-up', () => {
  it('first passkey: password required; registering grants a step-up the middleware accepts', async () => {
    const s = await session();
    const wrong = await routes.regOptions.POST(req('/api/auth/passkeys/register/options', 'POST', { 'xl-session': s.token }, { password: 'nope' }));
    expect(wrong.status).toBe(401);
    expect(db.audits.at(-1)).toMatchObject({ entityType: 'Passkey', details: expect.stringMatching(/refused/) });

    const res = await enroll(s, new SoftAuthenticator());
    expect(db.passkeys).toHaveLength(1);
    expect(db.passkeys[0]).toMatchObject({ userId: 'admin-1', rpId: 'localhost', deviceName: 'Test key' });
    const cookie = stepUpCookieOf(res)!;
    expect(res.headers.get('set-cookie')).toMatch(/Path=\/api;.*HttpOnly|HttpOnly.*Path=\/api/i);
    expect((await middleware(req('/api/admin/users/set-password', 'POST', { 'xl-session': s.token, 'xl-step-up': cookie }, {}))).status).toBe(200);
  });

  it('step-up with a registered passkey; a challenge is single use', async () => {
    const s = await session();
    const auth = new SoftAuthenticator();
    await enroll(s, auth);

    const opts = await (await routes.stepUpOptions.POST(req('/api/auth/step-up/options', 'POST', { 'xl-session': s.token }))).json();
    const assertion = auth.assert(opts);
    const ok = await routes.stepUpVerify.POST(req('/api/auth/step-up/verify', 'POST', { 'xl-session': s.token }, { response: assertion }));
    expect(ok.status).toBe(200);
    expect(await verifyStepUp(stepUpCookieOf(ok), s.subject)).toBe(true);
    expect(Number(db.passkeys[0].counter)).toBe(1);
    expect(db.audits.at(-1)).toMatchObject({ entityType: 'StepUp', details: expect.stringMatching(/passed/) });

    const replay = await routes.stepUpVerify.POST(req('/api/auth/step-up/verify', 'POST', { 'xl-session': s.token }, { response: assertion }));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'challenge_invalid' });
  });

  it('rejects an assertion without user verification, from another origin, or by another key', async () => {
    const s = await session();
    const auth = new SoftAuthenticator();
    await enroll(s, auth);
    const attempt = async (make: (o: { challenge: string }) => unknown) => {
      const opts = await (await routes.stepUpOptions.POST(req('/api/auth/step-up/options', 'POST', { 'xl-session': s.token }))).json();
      return routes.stepUpVerify.POST(req('/api/auth/step-up/verify', 'POST', { 'xl-session': s.token }, { response: make(opts) }));
    };
    expect((await attempt((o) => auth.assert(o, { userVerified: false }))).status).toBe(401);
    expect((await attempt((o) => new SoftAuthenticator('localhost', 'https://evil.example').assert(o))).status).toBe(400); // unknown credential
    const phish = Object.assign(new SoftAuthenticator('localhost', 'https://evil.example'), {});
    Object.defineProperty(phish, 'credId', { value: auth.credId });
    Object.defineProperty(phish, 'keys', { value: auth.keys });
    expect((await attempt((o) => phish.assert(o))).status).toBe(401);                                      // wrong origin
    const impostor = new SoftAuthenticator();
    Object.defineProperty(impostor, 'credId', { value: auth.credId });
    expect((await attempt((o) => impostor.assert(o))).status).toBe(401);                                   // wrong key
    expect(db.audits.filter((a) => String(a.details).includes('failed')).length).toBeGreaterThanOrEqual(3);
  });

  it('no passkey yet: step-up answers 409 no_passkey', async () => {
    const s = await session();
    const res = await routes.stepUpOptions.POST(req('/api/auth/step-up/options', 'POST', { 'xl-session': s.token }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'no_passkey', canEnroll: true });
  });

  it('a second passkey needs a step-up, not the password', async () => {
    const s = await session();
    await enroll(s, new SoftAuthenticator());
    const withPassword = await routes.regOptions.POST(req('/api/auth/passkeys/register/options', 'POST', { 'xl-session': s.token }, { password: PASSWORD }));
    expect(withPassword.status).toBe(403);
    expect(await withPassword.json()).toMatchObject({ error: 'step_up_required' });
    const stepped = await routes.regOptions.POST(req('/api/auth/passkeys/register/options', 'POST', { 'xl-session': s.token, 'xl-step-up': await signStepUp(s.subject) }, {}));
    expect(stepped.status).toBe(200);
  });

  it('passkeys only for another domain: asks for a reset instead of looping', async () => {
    const s = await session();
    db.passkeys.push({ id: 'old', userId: 'admin-1', rpId: 'old.example', publicKey: '', counter: 0n, transports: [], deviceName: 'Old', createdAt: new Date(), lastUsedAt: null });
    const res = await routes.regOptions.POST(req('/api/auth/passkeys/register/options', 'POST', { 'xl-session': s.token }, { password: PASSWORD }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'passkey_reset_required' });
  });

  it('during impersonation: checks the platform admin\'s passkeys and refuses passkey management', async () => {
    const own = await session('root');
    const auth = new SoftAuthenticator();
    await enroll(own, auth);

    const s = await session('admin-1', { impersonatedBy: 'root' });
    expect((await routes.regOptions.POST(req('/api/auth/passkeys/register/options', 'POST', { 'xl-session': s.token }, { password: PASSWORD }))).status).toBe(403);
    const opts = await (await routes.stepUpOptions.POST(req('/api/auth/step-up/options', 'POST', { 'xl-session': s.token }))).json();
    const ok = await routes.stepUpVerify.POST(req('/api/auth/step-up/verify', 'POST', { 'xl-session': s.token }, { response: auth.assert(opts) }));
    expect(ok.status).toBe(200);
    expect(await verifyStepUp(stepUpCookieOf(ok), s.subject)).toBe(true);
  });

  it('removing your own passkey needs a step-up', async () => {
    const s = await session();
    const auth = new SoftAuthenticator();
    await enroll(s, auth);
    const del = (cookies: Record<string, string>) =>
      routes.removeOwn.DELETE(req(`/api/auth/passkeys/${auth.id}`, 'DELETE', cookies), { params: Promise.resolve({ id: auth.id }) });
    expect((await del({ 'xl-session': s.token })).status).toBe(403);
    expect((await del({ 'xl-session': s.token, 'xl-step-up': await signStepUp(s.subject) })).status).toBe(200);
    expect(db.passkeys).toHaveLength(0);
  });

  it('lists the passkeys and what a first one needs', async () => {
    const s = await session();
    const body = await (await routes.list.GET(req('/api/auth/passkeys', 'GET', { 'xl-session': s.token }))).json();
    expect(body).toMatchObject({ configured: true, rpId: 'localhost', passkeys: [], firstPasskeyReauth: 'password' });
  });
});

// ── Re-authentication and configuration ──────────────────────────────────────
describe('re-authentication for a first passkey', () => {
  it('with MFA on: needs the authenticator code or a recovery code, which is consumed', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const { plaintext, hashed } = generateRecoveryCodes(2);
    Object.assign(db.users.get('admin-1')!, { mfa_enabled: true, mfa_secret: secret, mfa_recovery_codes: hashed });
    expect(await passkeys.reauthMethod('admin-1')).toBe('password+mfa');
    await expect(passkeys.reauthenticate('admin-1', { password: PASSWORD }, Date.now())).rejects.toMatchObject({ code: 'mfa_required' });
    await expect(passkeys.reauthenticate('admin-1', { password: PASSWORD, mfaCode: totpNow(secret) }, Date.now())).resolves.toBeUndefined();
    await expect(passkeys.reauthenticate('admin-1', { password: PASSWORD, recoveryCode: plaintext[0] }, Date.now())).resolves.toBeUndefined();
    await expect(passkeys.reauthenticate('admin-1', { password: PASSWORD, recoveryCode: plaintext[0] }, Date.now())).rejects.toMatchObject({ code: 'mfa_required' });
  });

  it('without a password (SSO): a sign-in within the last 10 minutes', async () => {
    db.users.get('admin-1')!.password_hash = null;
    const now = Date.now();
    expect(await passkeys.reauthMethod('admin-1')).toBe('recent-sign-in');
    await expect(passkeys.reauthenticate('admin-1', {}, now - 60_000, now)).resolves.toBeUndefined();
    await expect(passkeys.reauthenticate('admin-1', {}, now - 11 * 60_000, now)).rejects.toMatchObject({ code: 'recent_sign_in_required' });
  });
});

describe('relying party configuration', () => {
  it('comes from configuration, never the request', () => {
    expect(passkeys.relyingParty({ WEBAUTHN_RP_ID: 'fleet.example', WEBAUTHN_ORIGINS: 'https://fleet.example, https://www.fleet.example', NODE_ENV: 'production' } as never))
      .toEqual({ rpID: 'fleet.example', rpName: 'Fleet360', origins: ['https://fleet.example', 'https://www.fleet.example'] });
    expect(passkeys.relyingParty({ NEXT_PUBLIC_APP_URL: 'https://app.fleet.example/x', NODE_ENV: 'production' } as never))
      .toMatchObject({ rpID: 'app.fleet.example', origins: ['https://app.fleet.example'] });
    expect(passkeys.relyingParty({ NODE_ENV: 'production' } as never)).toBeNull();
    expect(passkeys.relyingParty({ NODE_ENV: 'development' } as never)).toMatchObject({ rpID: 'localhost' });
  });
});
